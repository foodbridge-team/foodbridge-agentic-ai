import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imageData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jOe4AAAAASUVORK5CYII=";

async function getFreePort(): Promise<number> {
  const socket = net.createServer();
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const address = socket.address();
  if (!address || typeof address === "string") throw new Error("Unable to allocate test port.");
  await new Promise<void>((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

test("HTTP workflow enforces verification and confirms courier/self-pickup handovers", async (context) => {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const uploadsDir = path.join(root, "public", "uploads", "documents");
  const originalDocuments = new Set(fs.readdirSync(uploadsDir));
  const proofDir = path.join(root, "private_uploads", "proofs");
  const proofDirExisted = fs.existsSync(proofDir);
  const originalProofs = new Set(proofDirExisted ? fs.readdirSync(proofDir) : []);
  const server: ChildProcess = spawn(process.execPath, ["web.ts"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "test",
      JWT_SECRET: "integration-test-jwt-secret",
      OTP_PEPPER: "integration-test-otp-pepper",
      ADMIN_EMAIL: "admin@foodbridge.org",
      ADMIN_PASSWORD: "adminSecure2026!",
    },
    stdio: "ignore",
  });
  context.after(async () => {
    server.kill();
    await new Promise<void>((resolve) => {
      if (server.exitCode !== null) resolve();
      else server.once("exit", () => resolve());
    });
    for (const fileName of fs.readdirSync(uploadsDir)) {
      if (!originalDocuments.has(fileName)) fs.rmSync(path.join(uploadsDir, fileName));
    }
    if (fs.existsSync(proofDir)) {
      for (const fileName of fs.readdirSync(proofDir)) {
        if (!originalProofs.has(fileName)) fs.rmSync(path.join(proofDir, fileName));
      }
      if (!proofDirExisted && fs.readdirSync(proofDir).length === 0) {
        fs.rmSync(proofDir, { recursive: true });
        const privateDir = path.dirname(proofDir);
        if (fs.readdirSync(privateDir).length === 0) fs.rmdirSync(privateDir);
      }
    }
  });

  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api/stats`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, "web server should start for the integration test");

  async function request(
    endpoint: string,
    options: { method?: string; body?: unknown; cookie?: string } = {}
  ) {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: options.method || "GET",
      headers: {
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(options.cookie ? { Cookie: options.cookie } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const data = await response.json();
    const setCookie = response.headers.get("set-cookie");
    return {
      response,
      data,
      cookie: setCookie?.split(";")[0],
    };
  }

  const anonymousAdmin = await request("/api/admin/verifications");
  assert.equal(anonymousAdmin.response.status, 403);
  const publicAdminSignup = await request("/api/auth/register", {
    method: "POST",
    body: { email: "attacker@example.org", password: "long-test-password", name: "No Admin", role: "ADMIN" },
  });
  assert.equal(publicAdminSignup.response.status, 403);

  const adminLogin = await request("/api/auth/login", {
    method: "POST",
    body: { email: "admin@foodbridge.org", password: "adminSecure2026!", role: "ADMIN" },
  });
  assert.equal(adminLogin.response.status, 200);
  assert.ok(adminLogin.cookie);
  const adminCookie = adminLogin.cookie!;

  const donorSignup = await request("/api/auth/register", {
    method: "POST",
    body: {
      email: "new-donor@example.org",
      password: "donor-password-123",
      name: "Test Donor",
      organization: "Test Kitchen",
      phone: "+1 555 010 1010",
      role: "DONOR",
    },
  });
  assert.equal(donorSignup.response.status, 201);
  const donorCookie = donorSignup.cookie!;
  const donorBeforeReview = await request("/api/donations", {
    method: "POST",
    cookie: donorCookie,
    body: {
      title: "Fresh meal trays",
      category: "cooked_meals",
      quantity: 10,
      hours: 4,
      storageOk: true,
      allergens: [],
      location: { lat: 12.92345, lng: 74.86432 },
    },
  });
  assert.equal(donorBeforeReview.response.status, 403);

  const ngoSignup = await request("/api/auth/register", {
    method: "POST",
    body: {
      email: "new-ngo@example.org",
      password: "ngo-password-123",
      name: "Test Coordinator",
      organization: "Community Test Shelter",
      phone: "+1 555 010 2020",
      role: "NGO",
      capacity: 100,
      lat: 12.92,
      lng: 74.86,
      licenseDoc: "data:application/pdf;base64,JVBERi0xLjQK",
    },
  });
  assert.equal(ngoSignup.response.status, 201);
  const ngoCookie = ngoSignup.cookie!;
  const ngoId = ngoSignup.data.user.ngoProfileId;
  const pendingApplications = await request("/api/admin/verifications", { cookie: adminCookie });
  const application = pendingApplications.data.pending.find((user: { id: string }) => user.id === ngoSignup.data.user.id);
  assert.ok(application?.licenseDoc);
  const publicDocument = await fetch(`${baseUrl}/${application.licenseDoc}`);
  assert.equal(publicDocument.status, 404);
  const protectedDocument = await fetch(`${baseUrl}/api/admin/documents/${ngoSignup.data.user.id}`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(protectedDocument.status, 200);

  for (const user of [donorSignup.data.user, ngoSignup.data.user]) {
    const approval = await request("/api/admin/verify", {
      method: "POST",
      cookie: adminCookie,
      body: { userId: user.id, action: "APPROVE" },
    });
    assert.equal(approval.response.status, 200);
  }

  const courierLogin = await request("/api/auth/login", {
    method: "POST",
    body: { email: "rider.offduty@foodbridge.org", password: "password123", role: "VOLUNTEER" },
  });
  const courierCookie = courierLogin.cookie!;
  const courierAvailability = await request("/api/delivery/status", {
    method: "POST",
    cookie: courierCookie,
    body: { isAvailable: true },
  });
  assert.equal(courierAvailability.response.status, 200);

  async function publishDonation(title: string) {
    const published = await request("/api/donations", {
      method: "POST",
      cookie: donorCookie,
      body: {
        title,
        category: "cooked_meals",
        quantity: 10,
        hours: 4,
        storageOk: true,
        allergens: [],
        location: { lat: 12.92345, lng: 74.86432 },
      },
    });
    assert.equal(published.response.status, 201);
    return published.data.donation.id as string;
  }

  const deliveryDonationId = await publishDonation("Verified courier meal");
  const publicFeed = await request("/api/donations");
  const publicListing = publicFeed.data.donations.find((donation: { id: string }) => donation.id === deliveryDonationId);
  assert.equal(publicListing.location.lat, 12.92);
  const anonymousMatch = await request("/api/match", {
    method: "POST",
    body: { donationId: deliveryDonationId },
  });
  assert.equal(anonymousMatch.response.status, 403);
  const match = await request("/api/match", {
    method: "POST",
    cookie: ngoCookie,
    body: { donationId: deliveryDonationId },
  });
  assert.ok(match.data.ranked.some((entry: { ngoId: string; reasons: string[] }) => entry.ngoId === ngoId && entry.reasons.length > 0));

  const courierReservation = await request("/api/reserve", {
    method: "POST",
    cookie: ngoCookie,
    body: { donationId: deliveryDonationId, ngoId, handoverType: "VOLUNTEER" },
  });
  assert.equal(courierReservation.response.status, 200);
  assert.equal(courierReservation.data.donation.status, "ASSIGNED");
  assert.equal(courierReservation.data.donation.handoverType, "VOLUNTEER");
  const duplicateReservation = await request("/api/reserve", {
    method: "POST",
    cookie: ngoCookie,
    body: { donationId: deliveryDonationId, ngoId, handoverType: "NGO_SELF_PICKUP" },
  });
  assert.equal(duplicateReservation.response.status, 409);
  const donorPickupOtp = await request("/api/pickup-otp", {
    method: "POST",
    cookie: donorCookie,
    body: { donationId: deliveryDonationId },
  });
  assert.equal(donorPickupOtp.response.status, 200);
  const courierPickup = await request("/api/verify-pickup", {
    method: "POST",
    cookie: courierCookie,
    body: { donationId: deliveryDonationId, code: donorPickupOtp.data.pickupCode },
  });
  assert.equal(courierPickup.data.result, "OK");
  const ngoDeliveryOtp = await request("/api/delivery-otp", {
    method: "POST",
    cookie: ngoCookie,
    body: { donationId: deliveryDonationId },
  });
  const unconfirmedCompletion = await request("/api/complete-delivery", {
    method: "POST",
    cookie: courierCookie,
    body: {
      donationId: deliveryDonationId,
      code: ngoDeliveryOtp.data.deliveryCode,
      quantityReceived: 9,
      photoRef: "unverified-proof",
    },
  });
  assert.equal(unconfirmedCompletion.response.status, 400);
  const courierProof = await request("/api/delivery-proof", {
    method: "POST",
    cookie: courierCookie,
    body: { donationId: deliveryDonationId, photoData: imageData },
  });
  assert.equal(courierProof.response.status, 201);
  const courierCompletion = await request("/api/complete-delivery", {
    method: "POST",
    cookie: courierCookie,
    body: {
      donationId: deliveryDonationId,
      code: ngoDeliveryOtp.data.deliveryCode,
      quantityReceived: 9,
      photoRef: courierProof.data.photoRef,
    },
  });
  assert.equal(courierCompletion.data.result, "OK");
  assert.equal(courierCompletion.data.donationStatus, "DELIVERED");

  await request("/api/delivery/status", {
    method: "POST",
    cookie: courierCookie,
    body: { isAvailable: false },
  });
  const selfPickupDonationId = await publishDonation("NGO self-pickup meal");
  const unavailableResponse = await request("/api/reserve", {
    method: "POST",
    cookie: ngoCookie,
    body: { donationId: selfPickupDonationId, ngoId, handoverType: "VOLUNTEER" },
  });
  assert.equal(unavailableResponse.data.success, false);
  assert.equal(unavailableResponse.data.message, "Delivery partners are not available. Please arrange NGO self-pickup.");

  const selfPickupReservation = await request("/api/reserve", {
    method: "POST",
    cookie: ngoCookie,
    body: { donationId: selfPickupDonationId, ngoId, handoverType: "NGO_SELF_PICKUP" },
  });
  assert.equal(selfPickupReservation.data.donation.collectorId, "NGO_SELF_PICKUP");
  const selfPickupCode = await request("/api/pickup-otp", {
    method: "POST",
    cookie: donorCookie,
    body: { donationId: selfPickupDonationId },
  });
  const selfPickupConfirmation = await request("/api/verify-pickup", {
    method: "POST",
    cookie: ngoCookie,
    body: { donationId: selfPickupDonationId, code: selfPickupCode.data.pickupCode },
  });
  assert.equal(selfPickupConfirmation.data.result, "OK");
  const selfPickupDeliveryCode = await request("/api/delivery-otp", {
    method: "POST",
    cookie: ngoCookie,
    body: { donationId: selfPickupDonationId },
  });
  const selfPickupProof = await request("/api/delivery-proof", {
    method: "POST",
    cookie: ngoCookie,
    body: { donationId: selfPickupDonationId, photoData: imageData },
  });
  const selfPickupCompletion = await request("/api/complete-delivery", {
    method: "POST",
    cookie: ngoCookie,
    body: {
      donationId: selfPickupDonationId,
      code: selfPickupDeliveryCode.data.deliveryCode,
      quantityReceived: 10,
      photoRef: selfPickupProof.data.photoRef,
    },
  });
  assert.equal(selfPickupCompletion.data.result, "OK");
  assert.equal(selfPickupCompletion.data.donationStatus, "DELIVERED");

  const audit = await request("/api/ledger");
  assert.equal(audit.data.verification.ok, true);
});
