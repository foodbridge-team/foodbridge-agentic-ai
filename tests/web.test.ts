import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
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
  const phoneOtpPort = await getFreePort();
  const pendingPhoneVerifications = new Set<string>();
  const phoneOtpProvider = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => { body += chunk; });
    req.on("end", () => {
      const form = new URLSearchParams(body);
      const phone = form.get("To") || "";
      if (req.url?.endsWith("/Verifications")) {
        pendingPhoneVerifications.add(phone);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "pending" }));
      } else if (req.url?.endsWith("/VerificationCheck")) {
        const approved = pendingPhoneVerifications.has(phone) && form.get("Code") === "123456";
        if (approved) pendingPhoneVerifications.delete(phone);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: approved ? "approved" : "pending" }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "not-found" }));
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    phoneOtpProvider.once("error", reject);
    phoneOtpProvider.listen(phoneOtpPort, "127.0.0.1", resolve);
  });
  context.after(async () => {
    await new Promise<void>((resolve, reject) => {
      phoneOtpProvider.close((error) => error ? reject(error) : resolve());
    });
  });
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
      TWILIO_ACCOUNT_SID: "ACintegrationtest",
      TWILIO_AUTH_TOKEN: "integration-test-token",
      TWILIO_VERIFY_SERVICE_SID: "VAintegrationtest",
      PHONE_OTP_API_BASE_URL: `http://127.0.0.1:${phoneOtpPort}`,
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
  for (const { route, role } of [
    { route: "/donor-login", role: "DONOR" },
    { route: "/donor-signup", role: "DONOR" },
    { route: "/ngo-login", role: "NGO" },
    { route: "/ngo-signup", role: "NGO" },
    { route: "/delivery-login", role: "VOLUNTEER" },
    { route: "/delivery-signup", role: "VOLUNTEER" },
  ]) {
    const page = await fetch(`${baseUrl}${route}`);
    assert.equal(page.status, 200, `${route} should be a valid role-specific auth page`);
    assert.match(await page.text(), new RegExp(`id="roleIdentifier" value="${role}"`));
  }
  const ngoSignInPage = await (await fetch(`${baseUrl}/ngo-login`)).text();
  assert.match(ngoSignInPage, /id="loginForm"/);
  assert.match(ngoSignInPage, /Dr\. Priya Kamath/);
  assert.doesNotMatch(ngoSignInPage, /id="registerForm"/);

  const ngoSignupPage = await (await fetch(`${baseUrl}/ngo-signup`)).text();
  assert.match(ngoSignupPage, /id="registerForm"/);
  assert.match(ngoSignupPage, /id="regLicenseDoc"/);
  assert.doesNotMatch(ngoSignupPage, /id="loginForm"/);
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
  const donorRoleMismatch = await request("/api/auth/login", {
    method: "POST",
    body: { email: "new-donor@example.org", password: "donor-password-123", role: "NGO" },
  });
  assert.equal(donorRoleMismatch.response.status, 401);
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
      pickupAddress: "18 Market Road, Mangaluru",
      location: { lat: 12.92345, lng: 74.86432 },
    },
  });
  assert.equal(donorBeforeReview.response.status, 403);

  const ngoRegistration = {
    email: "new-ngo@example.org",
    password: "ngo-password-123",
    name: "Test Coordinator",
    organization: "Community Test Shelter",
    phone: "+15550102020",
    role: "NGO",
    capacity: 100,
    lat: 12.92,
    lng: 74.86,
    licenseDoc: imageData,
  };
  const unverifiedNgoSignup = await request("/api/auth/register", {
    method: "POST",
    body: ngoRegistration,
  });
  assert.equal(unverifiedNgoSignup.response.status, 403);
  const phoneOtpSend = await request("/api/ngo-phone-otp/send", {
    method: "POST",
    body: { phone: ngoRegistration.phone },
  });
  assert.equal(phoneOtpSend.response.status, 200, JSON.stringify(phoneOtpSend.data));
  assert.doesNotMatch(JSON.stringify(phoneOtpSend.data), /123456/);
  const invalidPhoneOtp = await request("/api/ngo-phone-otp/verify", {
    method: "POST",
    body: { phone: ngoRegistration.phone, code: "000000" },
  });
  assert.equal(invalidPhoneOtp.response.status, 400);
  const validPhoneOtp = await request("/api/ngo-phone-otp/verify", {
    method: "POST",
    body: { phone: ngoRegistration.phone, code: "123456" },
  });
  assert.equal(validPhoneOtp.response.status, 200);
  const ngoSignup = await request("/api/auth/register", {
    method: "POST",
    body: ngoRegistration,
  });
  assert.equal(ngoSignup.response.status, 201);
  const ngoCookie = ngoSignup.cookie!;
  const ngoId = ngoSignup.data.user.ngoProfileId;
  const deliverySignup = await request("/api/auth/register", {
    method: "POST",
    body: {
      email: "new-courier@example.org",
      password: "courier-password-123",
      name: "Test Courier",
      phone: "+1 555 010 3030",
      role: "VOLUNTEER",
      vehicleType: "Bicycle",
    },
  });
  assert.equal(deliverySignup.response.status, 201);
  const pendingApplications = await request("/api/admin/verifications", { cookie: adminCookie });
  const application = pendingApplications.data.pending.find((user: { id: string }) => user.id === ngoSignup.data.user.id);
  assert.ok(application?.licenseDoc);
  const publicDocument = await fetch(`${baseUrl}/${application.licenseDoc}`);
  assert.equal(publicDocument.status, 404);
  const protectedDocument = await fetch(`${baseUrl}/api/admin/documents/${ngoSignup.data.user.id}`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(protectedDocument.status, 200);

  for (const user of [donorSignup.data.user, ngoSignup.data.user, deliverySignup.data.user]) {
    const approval = await request("/api/admin/verify", {
      method: "POST",
      cookie: adminCookie,
      body: { userId: user.id, action: "APPROVE" },
    });
    assert.equal(approval.response.status, 200);
  }
  const missingPickupAddress = await request("/api/donations", {
    method: "POST",
    cookie: donorCookie,
    body: {
      title: "Address is required",
      category: "cooked_meals",
      quantity: 10,
      hours: 4,
      storageOk: true,
      allergens: [],
      location: { lat: 12.92345, lng: 74.86432 },
    },
  });
  assert.equal(missingPickupAddress.response.status, 400);
  for (const credentials of [
    { email: "new-donor@example.org", password: "donor-password-123", role: "DONOR" },
    { email: "new-ngo@example.org", password: "ngo-password-123", role: "NGO" },
    { email: "new-courier@example.org", password: "courier-password-123", role: "VOLUNTEER" },
  ]) {
    const roleLogin = await request("/api/auth/login", { method: "POST", body: credentials });
    assert.equal(roleLogin.response.status, 200, `${credentials.role} should sign in through its own portal`);
    assert.equal(roleLogin.data.user.role, credentials.role);
  }
  const newCourierLogin = await request("/api/auth/login", {
    method: "POST",
    body: { email: "new-courier@example.org", password: "courier-password-123", role: "VOLUNTEER" },
  });
  assert.equal(newCourierLogin.response.status, 200);
  assert.ok(newCourierLogin.cookie);
  const newCourierAvailability = await request("/api/delivery/status", {
    method: "POST",
    cookie: newCourierLogin.cookie,
    body: { isAvailable: false },
  });
  assert.equal(newCourierAvailability.response.status, 200);

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
        pickupAddress: "18 Market Road, Mangaluru",
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
  assert.equal("pickupAddress" in publicListing, false, "public listings must not expose the exact pickup address");
  const ngoListingsBeforeReservation = await request("/api/donations", { cookie: ngoCookie });
  const ngoListingBeforeReservation = ngoListingsBeforeReservation.data.donations.find(
    (donation: { id: string }) => donation.id === deliveryDonationId
  );
  assert.equal("pickupAddress" in ngoListingBeforeReservation, false);
  assert.equal(ngoListingBeforeReservation.location.lat, 12.92);
  const donorListings = await request("/api/donations", { cookie: donorCookie });
  assert.equal(
    donorListings.data.donations.find((donation: { id: string }) => donation.id === deliveryDonationId).pickupAddress,
    "18 Market Road, Mangaluru"
  );
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
  assert.equal("pickupAddress" in match.data.donation, false, "match previews must not expose the pickup address before reservation");
  assert.equal(match.data.donation.location.lat, 12.92, "match previews must not expose precise pickup coordinates before reservation");

  const courierReservation = await request("/api/reserve", {
    method: "POST",
    cookie: ngoCookie,
    body: { donationId: deliveryDonationId, ngoId, handoverType: "VOLUNTEER" },
  });
  assert.equal(courierReservation.response.status, 200);
  assert.equal(courierReservation.data.donation.status, "ASSIGNED");
  assert.equal(courierReservation.data.donation.handoverType, "VOLUNTEER");
  assert.equal(courierReservation.data.donation.pickupAddress, "18 Market Road, Mangaluru");
  const ngoAssignedListing = await request("/api/donations", { cookie: ngoCookie });
  assert.equal(
    ngoAssignedListing.data.donations.find((donation: { id: string }) => donation.id === deliveryDonationId).pickupAddress,
    "18 Market Road, Mangaluru"
  );
  const courierMissions = await request("/api/donations", { cookie: courierCookie });
  assert.equal(
    courierMissions.data.donations.find((donation: { id: string }) => donation.id === deliveryDonationId).pickupAddress,
    "18 Market Road, Mangaluru"
  );
  const duplicateReservation = await request("/api/reserve", {
    method: "POST",
    cookie: ngoCookie,
    body: { donationId: deliveryDonationId, ngoId, handoverType: "NGO_SELF_PICKUP" },
  });
  assert.equal(duplicateReservation.response.status, 409);

  const advisoryListing = await request("/api/donations", {
    method: "POST",
    cookie: donorCookie,
    body: {
      title: "Pav bajji with dairy warning",
      category: "produce",
      quantity: 200,
      hours: 4,
      storageOk: true,
      allergens: ["dairy"],
      pickupAddress: "18 Market Road, Mangaluru",
      location: { lat: 12.92345, lng: 74.86432 },
    },
  });
  assert.equal(advisoryListing.response.status, 201);
  const advisoryReservation = await request("/api/reserve", {
    method: "POST",
    cookie: ngoCookie,
    body: {
      donationId: advisoryListing.data.donation.id,
      ngoId,
      handoverType: "NGO_SELF_PICKUP",
    },
  });
  assert.equal(advisoryReservation.response.status, 200);
  assert.equal(advisoryReservation.data.donation.status, "ASSIGNED");
  const donorNotifications = await request("/api/notifications", { cookie: donorCookie });
  assert.ok(donorNotifications.data.notifications.some(
    (notification: { title: string; message: string }) =>
      notification.title === "Food Reserved by NGO" && notification.message.includes("Pav bajji")
  ));

  const donorPickupOtp = await request("/api/pickup-otp", {
    method: "POST",
    cookie: donorCookie,
    body: { donationId: deliveryDonationId },
  });
  assert.equal(donorPickupOtp.response.status, 200);
  const malformedPickupOtp = await request("/api/verify-pickup", {
    method: "POST",
    cookie: courierCookie,
    body: { donationId: deliveryDonationId, code: "123" },
  });
  assert.equal(malformedPickupOtp.response.status, 400);
  const incorrectPickupCode = await request("/api/verify-pickup", {
    method: "POST",
    cookie: courierCookie,
    body: {
      donationId: deliveryDonationId,
      code: donorPickupOtp.data.pickupCode === "000000" ? "000001" : "000000",
    },
  });
  assert.equal(incorrectPickupCode.response.status, 400);
  assert.equal(incorrectPickupCode.data.result, "INVALID");
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
  const invalidDeliveryCode = await request("/api/complete-delivery", {
    method: "POST",
    cookie: courierCookie,
    body: {
      donationId: deliveryDonationId,
      code: ngoDeliveryOtp.data.deliveryCode === "000000" ? "000001" : "000000",
      quantityReceived: 9,
      photoRef: courierProof.data.photoRef,
    },
  });
  assert.equal(invalidDeliveryCode.response.status, 400);
  assert.equal(invalidDeliveryCode.data.result, "INVALID");
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
  assert.equal(courierCompletion.response.status, 200);
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
  assert.equal(selfPickupProof.response.status, 201);
  assert.equal(selfPickupCompletion.response.status, 200);
  assert.equal(selfPickupCompletion.data.result, "OK");
  assert.equal(selfPickupCompletion.data.donationStatus, "DELIVERED");

  const audit = await request("/api/ledger");
  assert.equal(audit.data.verification.ok, true);
});
