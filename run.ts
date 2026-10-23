/**
 * FoodBridge AI — Core Execution Demo
 * 
 * Demonstrates the full lifecycle of a food donation:
 * 1. Matching & Eligibility Ranking
 * 2. Volunteer Assignment
 * 3. Two-Stage OTP Handover (Pickup -> Delivery)
 * 4. Tamper-Evident SHA-256 Ledger Audit Verification
 */

import { Ledger } from "./core/ledger.ts";
import { Handover } from "./core/handover.ts";
import { eligible, rankRuleBased } from "./core/matching.ts";
import type { Donation, Ngo } from "./core/types.ts";

const PEPPER = process.env.OTP_PEPPER || "demo-secure-pepper-key-2026";

function printDivider(title: string) {
  console.log("\n" + "=".repeat(60));
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

async function main() {
  printDivider("🌱 FOODBRIDGE AI: SURPLUS FOOD REDISTRIBUTION SYSTEM");

  const now = Date.now();
  const donorCoords = { lat: 12.9141, lng: 74.856 }; // Mangaluru Central
  const ledger = new Ledger();

  // 1. Food Donation Listed
  const donation: Donation = {
    id: "DONATION-001",
    quantity: 35, // 35 meals
    location: donorCoords,
    deadline: now + 3.5 * 3.6e6, // 3.5 hours remaining
    allergens: ["dairy"],
    storageOk: true,
    category: "cooked_meals",
  };

  console.log("\n📦 [1] New Surplus Donation Listed:");
  console.log(`   ID:        ${donation.id}`);
  console.log(`   Quantity:  ${donation.quantity} warm meal packages`);
  console.log(`   Category:  ${donation.category}`);
  console.log(`   Storage:   Verified hot-insulated containers (storageOk: ${donation.storageOk})`);
  console.log(`   Location:  [${donation.location.lat}, ${donation.location.lng}]`);
  console.log(`   Deadline:  In 3.5 hours`);

  // 2. Candidate NGOs in the region
  const ngos: Ngo[] = [
    {
      id: "NGO-SEVA-TRUST",
      verified: true,
      location: { lat: 12.921, lng: 74.862 }, // ~1.0 km away
      freeCapacity: 60,
      acceptsCategories: ["cooked_meals", "packaged"],
      excludedAllergens: [],
      maxKm: 8,
    },
    {
      id: "NGO-CHILD-CARE",
      verified: true,
      location: { lat: 12.935, lng: 74.87 }, // ~2.7 km away
      freeCapacity: 20, // Insufficient capacity (needs 35)
      acceptsCategories: ["cooked_meals"],
      excludedAllergens: [],
      maxKm: 5,
    },
    {
      id: "NGO-COMMUNITY-HOPE",
      verified: false, // Unverified
      location: { lat: 12.918, lng: 74.858 },
      freeCapacity: 50,
      acceptsCategories: ["cooked_meals"],
      excludedAllergens: [],
      maxKm: 10,
    },
    {
      id: "NGO-MEAL-MISSION",
      verified: true,
      location: { lat: 12.925, lng: 74.868 }, // ~1.8 km away
      freeCapacity: 100,
      acceptsCategories: ["cooked_meals"],
      excludedAllergens: [],
      maxKm: 12,
    },
  ];

  printDivider("🔍 [2] Deterministic Eligibility Check & Rule-Based Ranking");

  const eligibility = eligible(donation, ngos, now);

  console.log(`\n✅ Eligible Recipients (${eligibility.ok.length}):`);
  for (const n of eligibility.ok) {
    console.log(`   - ${n.id} (Distance: ~${n.km.toFixed(2)} km, Capacity: ${n.freeCapacity})`);
  }

  if (eligibility.rejected.length > 0) {
    console.log(`\n❌ Ineligible / Rejected Candidates (${eligibility.rejected.length}):`);
    for (const r of eligibility.rejected) {
      console.log(`   - ${r.ngoId}: ${r.reason}`);
    }
  }

  // Ranking eligible NGOs
  const ranked = rankRuleBased(donation, eligibility.ok, now);
  console.log("\n⭐ Ranking Results:");
  ranked.forEach((match, index) => {
    console.log(`   #${index + 1} ${match.ngoId} — Score: ${match.score}/100`);
    console.log(`      Reasons: ${match.reasons.join(" | ")}`);
  });

  const selectedNgo = eligibility.ok.find((n) => n.id === ranked[0].ngoId)!;
  console.log(`\n🎯 Matched with Top Ranked NGO: ${selectedNgo.id}`);

  // 3. Handover Initialization
  printDivider("🤝 [3] Handover Lifecycle & Two-Stage Cryptographic OTP");

  const donorId = "DONOR-RESTAURANT-MGLR";
  const ngoRepId = "NGO-REP-PRIYA";
  const volunteerId = "VOLUNTEER-RAHUL";

  const handover = new Handover(
    donation.id,
    donorId,
    ngoRepId,
    selectedNgo.location,
    ledger,
    PEPPER
  );

  console.log(`\n• Handover Created. Initial Status: ${handover.status}`);

  // Assign volunteer
  handover.assignCollector(volunteerId, "DISPATCH-ADMIN");
  console.log(`• Assigned Collector: ${volunteerId} (Approved by DISPATCH-ADMIN)`);
  console.log(`• Updated Status:     ${handover.status}`);

  // Stage 1: Pickup OTP
  console.log("\n--- STAGE 1: PICKUP VERIFICATION ---");
  const pickupCode = handover.issuePickupOtp(donorId);
  console.log(`• Donor generated Pickup OTP: [${pickupCode}]`);
  console.log(`  (Note: Stored on server only as salted HMAC-SHA256, never plaintext)`);

  console.log(`• Volunteer ${volunteerId} presents code at pickup location...`);
  const pickupResult = handover.confirmPickup(volunteerId, pickupCode);
  console.log(`• Pickup Verification Result: ${pickupResult}`);
  console.log(`• Current Handover Status:     ${handover.status} (In Transit)`);

  // Stage 2: Delivery OTP
  console.log("\n--- STAGE 2: DELIVERY VERIFICATION ---");
  const deliveryCode = handover.issueDeliveryOtp(ngoRepId);
  console.log(`• NGO Rep (${ngoRepId}) generated Delivery OTP: [${deliveryCode}]`);

  const collectorDeliveryLocation = { lat: 12.9211, lng: 74.8621 }; // Within 15 meters of NGO
  console.log(`• Collector delivers 35 meals to NGO...`);
  console.log(`• Submitting Delivery OTP with photo proof & GPS location...`);

  const deliveryResult = handover.completeDelivery({
    collectorId: volunteerId,
    code: deliveryCode,
    ngoRepId: ngoRepId,
    quantityReceived: 35,
    photoRef: "uploads/proofs/delivery-proof-001.jpg",
    evidenceLocation: collectorDeliveryLocation,
  });

  console.log(`• Delivery Verification Result: ${deliveryResult}`);
  console.log(`• Final Handover Status:       ${handover.status} 🎉`);

  // 4. Immutable Ledger Audit
  printDivider("🛡️ [4] Cryptographic SHA-256 Audit Ledger Verification");

  console.log(`\nRecorded ${ledger.events.length} Tamper-Evident Ledger Events:`);
  for (const event of ledger.events) {
    console.log(`\n  [Event #${event.id}] ${event.type}`);
    console.log(`    Timestamp: ${event.ts}`);
    console.log(`    Prev Hash: ${event.prevHash.slice(0, 16)}...`);
    console.log(`    Hash:      ${event.hash.slice(0, 16)}...`);
    console.log(`    Payload:   ${JSON.stringify(event.payload)}`);
  }

  const verification = ledger.verify();
  console.log("\n------------------------------------------------------------");
  if (verification.ok) {
    console.log("🔒 Ledger Hash Chain Integrity: VERIFIED (100% Tamper-Free)");
  } else {
    console.log(`⚠️ Warning: Ledger chain compromised at event #${verification.brokenAt}`);
  }
  console.log("============================================================\n");
}

main().catch((err) => {
  console.error("Execution error:", err);
  process.exit(1);
});
