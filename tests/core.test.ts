import test from "node:test";
import assert from "node:assert/strict";
import { Ledger } from "../core/ledger.ts";
import { Handover } from "../core/handover.ts";
import { issueOtp, verifyOtp, MAX_ATTEMPTS } from "../core/otp.ts";
import { eligible, rankRuleBased, type Donation, type Ngo } from "../core/matching.ts";

const PEPPER = "test-pepper";
const DEMO_LOCATION = { lat: 12.9141, lng: 74.856 }; // Demo coordinates near Mangaluru

/** Helper to instantiate a fresh Handover and Ledger */
function createHandoverFixture() {
  const ledger = new Ledger();
  const handover = new Handover("D1", "donor", "ngoRep", DEMO_LOCATION, ledger, PEPPER);
  return { ledger, handover };
}

/** Helper to simulate pickup completion and return the delivery OTP */
function runPickupFlow(handover: Handover): string {
  handover.assignCollector("vol", "admin");
  const pickupCode = handover.issuePickupOtp("donor");
  assert.equal(handover.confirmPickup("vol", pickupCode), "OK");
  return handover.issueDeliveryOtp("ngoRep");
}

test("full happy path ends DELIVERED and ledger verifies", () => {
  const { ledger, handover } = createHandoverFixture();
  const deliveryCode = runPickupFlow(handover);

  const deliveryResult = handover.completeDelivery({
    collectorId: "vol",
    code: deliveryCode,
    ngoRepId: "ngoRep",
    quantityReceived: 10,
    photoRef: "p1",
    evidenceLocation: DEMO_LOCATION,
  });

  assert.equal(deliveryResult, "OK");
  assert.equal(handover.status, "DELIVERED");
  assert.deepEqual(ledger.verify(), { ok: true });
});

test("unauthorized collector and wrong code rejected; OTP single-use", () => {
  const { handover } = createHandoverFixture();
  handover.assignCollector("vol", "admin");

  const pickupCode = handover.issuePickupOtp("donor");

  // Wrong entrant (unauthorized collector)
  assert.equal(handover.confirmPickup("stranger", pickupCode), "WRONG_ENTRANT");

  // Wrong code
  const wrongCode = pickupCode === "000000" ? "111111" : "000000";
  assert.equal(handover.confirmPickup("vol", wrongCode), "INVALID");

  // Legitimate collector confirms pickup
  assert.equal(handover.confirmPickup("vol", pickupCode), "OK");

  // Cannot reuse same OTP
  assert.equal(handover.confirmPickup("vol", pickupCode), "INVALID");

  // Low-level verifyOtp single-use check
  const { record, code } = issueOtp(PEPPER, {
    donationId: "x",
    stage: "PICKUP",
    issuedTo: "a",
    allowedEntrant: "b",
  });
  assert.equal(verifyOtp(PEPPER, record, "b", code), "OK");
  assert.equal(verifyOtp(PEPPER, record, "b", code), "USED");
});

test("expiry and attempt lockout", () => {
  const baseTime = 1_000_000;
  const otpParams = {
    donationId: "x",
    stage: "PICKUP" as const,
    issuedTo: "a",
    allowedEntrant: "b",
  };

  // Expiration check: after 11 minutes (TTL is 10 minutes)
  const expiredEntry = issueOtp(PEPPER, otpParams, baseTime);
  assert.equal(
    verifyOtp(PEPPER, expiredEntry.record, "b", expiredEntry.code, baseTime + 11 * 60_000),
    "EXPIRED"
  );

  // Lockout check: max 5 failed attempts
  const lockoutEntry = issueOtp(PEPPER, otpParams, baseTime);
  const badCode = lockoutEntry.code === "000000" ? "111111" : "000000";

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    assert.equal(verifyOtp(PEPPER, lockoutEntry.record, "b", badCode, baseTime), "INVALID");
  }

  // 6th attempt with correct code should still be LOCKED
  assert.equal(verifyOtp(PEPPER, lockoutEntry.record, "b", lockoutEntry.code, baseTime), "LOCKED");
});

test("delivery needs evidence, right receiver, right state; cannot skip pickup", () => {
  const { handover: h1 } = createHandoverFixture();
  h1.assignCollector("vol", "admin");

  // Cannot issue delivery OTP before pickup is verified
  assert.throws(() => h1.issueDeliveryOtp("ngoRep"));

  const { handover: h2 } = createHandoverFixture();
  const deliveryCode = runPickupFlow(h2);

  // Missing photo reference
  assert.equal(
    h2.completeDelivery({
      collectorId: "vol",
      code: deliveryCode,
      ngoRepId: "ngoRep",
      quantityReceived: 10,
    }),
    "MISSING_EVIDENCE"
  );

  // Imposter receiver rep
  assert.equal(
    h2.completeDelivery({
      collectorId: "vol",
      code: deliveryCode,
      ngoRepId: "other",
      quantityReceived: 10,
      photoRef: "p",
    }),
    "NOT_RECEIVER"
  );

  assert.notEqual(h2.status, "DELIVERED");
});

test("wrong-location evidence is flagged, not silently accepted", () => {
  const { handover } = createHandoverFixture();
  const deliveryCode = runPickupFlow(handover);

  // Evidence coordinate is far (>0.5 km) from registered NGO location
  handover.completeDelivery({
    collectorId: "vol",
    code: deliveryCode,
    ngoRepId: "ngoRep",
    quantityReceived: 5,
    photoRef: "p",
    evidenceLocation: { lat: 13.1, lng: 74.9 },
  });

  assert.deepEqual(handover.flags, ["EVIDENCE_LOCATION_MISMATCH"]);
});

test("ledger detects tampering and refuses secrets", () => {
  const { ledger, handover } = createHandoverFixture();
  runPickupFlow(handover);

  // Prohibits saving sensitive fields
  assert.throws(() => ledger.append("X", "D1", { otp: "123456" }));

  // Tampering with payload breaks verification
  ledger.events[1].payload = { collectorId: "evil" };
  assert.equal(ledger.verify().ok, false);
});

test("matching hard checks run first; cancelled handover cannot be reassigned", () => {
  const now = Date.now();

  const donation: Donation = {
    id: "D",
    quantity: 20,
    location: DEMO_LOCATION,
    deadline: now + 4 * 3.6e6,
    allergens: ["nuts"],
    storageOk: true,
    category: "cooked",
  };

  const baseNgo: Ngo = {
    id: "n",
    verified: true,
    location: { lat: 12.92, lng: 74.86 },
    freeCapacity: 50,
    acceptsCategories: ["cooked"],
    excludedAllergens: [],
    maxKm: 10,
  };

  const candidates: Ngo[] = [
    baseNgo,
    { ...baseNgo, id: "unverified", verified: false },
    { ...baseNgo, id: "small", freeCapacity: 5 },
    { ...baseNgo, id: "allergy", excludedAllergens: ["nuts"] },
    { ...baseNgo, id: "far", location: { lat: 13.5, lng: 75.5 } },
  ];

  const eligibility = eligible(donation, candidates, now);
  assert.deepEqual(
    eligibility.ok.map((n) => n.id),
    ["n"]
  );
  assert.equal(eligibility.rejected.length, 4);

  const ranked = rankRuleBased(donation, eligibility.ok, now);
  assert.equal(ranked[0].ngoId, "n");

  // Blocked if deadline already expired
  const expiredDonation = { ...donation, deadline: now - 1 };
  assert.ok(eligible(expiredDonation, [baseNgo], now).donationBlocked);

  // Cancelled handover cannot be reassigned
  const { handover } = createHandoverFixture();
  handover.cancel("test");
  assert.equal(handover.status, "CANCELLED");
  assert.throws(() => handover.assignCollector("v", "a"));
});
