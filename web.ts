/**
 * FoodBridge AI — Full Platform Web Server & REST API
 * Zero-dependency native Node.js HTTP server.
 * Connects the web UI to core matching, handover state machine, cryptographic OTP, and SHA-256 ledger.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import { Ledger } from "./core/ledger.ts";
import { Handover } from "./core/handover.ts";
import { eligible, rankRuleBased } from "./core/matching.ts";
import type { Donation, Ngo, Role, VerifStatus, HandoverType } from "./core/types.ts";
import {
  initDb,
  isMongoConnected,
  findUserByIdSync,
  findUserByEmailSync,
  saveUser,
  updateUser,
  listAllUsers,
  listAllUsersSync,
  listPendingVerifications,
  findDonationByIdSync,
  listAllDonations,
  listAllDonationsSync,
  saveDonation,
  updateDonation,
  listAllNgos,
  listAllNgosSync,
  findNgoByIdSync,
  updateNgo,
  listAllVolunteers,
  listAllDistricts,
  listLedgerEvents,
  saveLedgerEvent,
  pruneLedgerAfter,
  clearLedger,
  listUserNotifications,
  saveNotification,
  markNotificationsAsRead,
  getNetworkStats,
  hashPassword,
  verifyPassword,
  type PlatformUser,
  type PlatformDonation,
  type AppNotification,
} from "./core/db.ts";

// Initialize MongoDB & auto-seed Karnataka datasets
await initDb();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const PEPPER = process.env.OTP_PEPPER || "foodbridge-secure-pepper-2026";
const AUTH_SECRET = process.env.JWT_SECRET || "foodbridge-local-development-secret-change-before-deploy";
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
if (
  process.env.NODE_ENV === "production" &&
  (!process.env.JWT_SECRET || !process.env.OTP_PEPPER || !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD)
) {
  throw new Error("JWT_SECRET, OTP_PEPPER, ADMIN_EMAIL, and ADMIN_PASSWORD must be configured in production.");
}

// Ensure document uploads directory exists
const UPLOADS_DIR = path.join(__dirname, "public", "uploads");
const DOCS_DIR = path.join(UPLOADS_DIR, "documents");
const PROOFS_DIR = path.join(__dirname, "private_uploads", "proofs");
fs.mkdirSync(DOCS_DIR, { recursive: true });
fs.mkdirSync(PROOFS_DIR, { recursive: true });

// Process-memory state for the full platform
let globalLedger = new Ledger();
const existingBlocks = await listLedgerEvents();
if (existingBlocks.length > 0) {
  globalLedger.events = existingBlocks;
  const initialVerify = globalLedger.verify();
  if (!initialVerify.ok) {
    let brokenIdx = -1;
    let expectedHash = "0000000000000000000000000000000000000000000000000000000000000000";
    for (let i = 0; i < globalLedger.events.length; i++) {
      const e = globalLedger.events[i];
      if (e.prevHash !== expectedHash) {
        brokenIdx = i;
        break;
      }
      expectedHash = e.hash;
    }
    if (brokenIdx >= 0) {
      const validBlocks = globalLedger.events.slice(0, brokenIdx);
      const lastValidId = validBlocks.at(-1)?.id || 0;
      console.warn(`[Ledger] DB chain had broken link at index ${brokenIdx}. Pruning to last valid block #${lastValidId}.`);
      globalLedger.events = validBlocks;
      await pruneLedgerAfter(lastValidId);
    }
  }
}
if (globalLedger.events.length === 0) {
  const genesis = globalLedger.append("SYSTEM_INITIALIZED", "GENESIS", {
    message: "FoodBridge AI Karnataka Statewide Food Rescue Network Initialized"
  });
  await saveLedgerEvent(genesis);
}

let activeHandovers: Map<string, Handover> = new Map();
const deliveryProofs = new Map<string, { donationId: string; uploaderId: string; filePath: string }>();
const phoneOtpRequests = new Map<string, number[]>();
const verifiedNgoPhones = new Map<string, number>();

function createAuthToken(userId: string): string {
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    exp: Date.now() + TOKEN_TTL_MS,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function setAuthCookie(res: http.ServerResponse, userId: string): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `foodbridge_session=${createAuthToken(userId)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${TOKEN_TTL_MS / 1000}${secure}`
  );
}

function publicUser(user: PlatformUser) {
  const ngo = user.ngoProfileId ? findNgoByIdSync(user.ngoProfileId) : null;
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    nameKn: user.nameKn,
    organization: user.organization,
    orgNameKn: user.orgNameKn,
    phone: user.phone,
    avatar: user.avatar,
    verification: user.verification,
    isAvailable: user.isAvailable,
    ngoProfileId: user.ngoProfileId,
    capacity: user.capacity,
    freeCapacity: ngo?.freeCapacity,
    isDemo: Boolean(user.isDemo),
    district: user.district,
    division: user.division,
    city: user.city,
    address: user.address,
  };
}

let users: PlatformUser[] = listAllUsersSync();
let ngos: Ngo[] = listAllNgosSync();
let donations: PlatformDonation[] = listAllDonationsSync();
let notifications: AppNotification[] = [];

async function pushNotification(userId: string, title: string, message: string, type: "info" | "success" | "warning" = "info") {
  const notif: AppNotification = {
    id: `NOTIF-${Date.now()}-${Math.random().toString().slice(-4)}`,
    userId,
    title,
    message,
    type,
    timestamp: new Date().toISOString(),
    read: false,
  };
  notifications.unshift(notif);
  await saveNotification(notif);
}

async function persistLedgerEvents() {
  try {
    for (const block of globalLedger.events) {
      await saveLedgerEvent(block);
    }
  } catch (err) {
    console.error("Error persisting ledger event to database:", err);
  }
}

function resetSeedData() {
  const production = process.env.NODE_ENV === "production";
  globalLedger = new Ledger();
  if (existingBlocks && existingBlocks.length > 0) {
    globalLedger.events = [...existingBlocks];
  }
  activeHandovers.clear();
  deliveryProofs.clear();
  phoneOtpRequests.clear();
  verifiedNgoPhones.clear();
  notifications = [];

  users = listAllUsersSync();
  ngos = listAllNgosSync();
  donations = listAllDonationsSync();

  if (production) {
    if (globalLedger.events.length === 0) {
      globalLedger.append("SYSTEM_INITIALIZED", "GENESIS", {
        message: "FoodBridge AI started without demo users or demo listings",
      });
    }
    return;
  }

  // Initialize handover for DON-103
  const don103 = donations.find((d) => d.id === "DON-103");
  if (don103) {
    const h = new Handover(
      "DON-103",
      "USER-DONOR-1",
      "USER-NGO-1",
      { lat: 12.921, lng: 74.862 },
      globalLedger,
      PEPPER
    );
    h.assignCollector("USER-VOL-1", "DEMO_SEED");
    don103.status = "ASSIGNED";
    don103.collectorId = "USER-VOL-1";
    activeHandovers.set("DON-103", h);
    const vol1 = users.find((u) => u.id === "USER-VOL-1");
    if (vol1) vol1.isAvailable = false;
  }

  // Initial audit log if empty
  if (globalLedger.events.length === 0) {
    globalLedger.append("SYSTEM_INITIALIZED", "GENESIS", {
      message: "FoodBridge AI Security Core Initialized",
      policy: "Strict Role-Based Admin Verification Enforced",
    });
  }
}

// Initialize seed data
resetSeedData();

// Helpers
function sendJson(res: http.ServerResponse, statusCode: number, data: unknown) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(data));
}

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 8 * 1024 * 1024) {
        reject(new Error("Request body exceeds the 8 MB limit."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function phoneOtpProviderUrl(serviceSid: string, operation: "Verifications" | "VerificationCheck"): URL | null {
  const testBaseUrl = process.env.NODE_ENV === "test" ? process.env.PHONE_OTP_API_BASE_URL : undefined;
  if (testBaseUrl) {
    const base = new URL(testBaseUrl);
    if (base.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(base.hostname)) {
      throw new Error("The test phone verification endpoint must use localhost over HTTP.");
    }
    return new URL(`/v2/Services/${encodeURIComponent(serviceSid)}/${operation}`, base);
  }
  if (!/^[A-Z0-9]{34}$/.test(serviceSid)) return null;
  return new URL(`https://verify.twilio.com/v2/Services/${serviceSid}/${operation}`);
}

async function callPhoneOtpProvider(
  operation: "Verifications" | "VerificationCheck",
  form: URLSearchParams
): Promise<{ configured: boolean; ok: boolean; status: string }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!accountSid || !authToken || !serviceSid) return { configured: false, ok: false, status: "" };

  const url = phoneOtpProviderUrl(serviceSid, operation);
  if (!url) return { configured: false, ok: false, status: "" };

  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json().catch(() => ({})) as { status?: unknown };
  return {
    configured: true,
    ok: response.ok,
    status: typeof result.status === "string" ? result.status : "",
  };
}

// User extractor from Authorization header or session
function authenticateRequest(req: http.IncomingMessage): PlatformUser | null {
  const authHeader = req.headers.authorization;
  const cookie = req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("foodbridge_session="));
  const rawAuth = authHeader?.replace(/^Bearer\s+/i, "").trim();
  const token = (rawAuth && rawAuth !== "null" && rawAuth !== "undefined")
    ? rawAuth
    : cookie?.slice("foodbridge_session=".length);
  if (!token) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof claims.sub !== "string" || typeof claims.exp !== "number" || claims.exp <= Date.now()) return null;
    return users.find((u) => u.id === claims.sub) || null;
  } catch {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  const parsedUrl = new URL(req.url || "/", `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (["POST", "PUT", "DELETE"].includes(req.method || "") && req.headers.origin) {
    try {
      if (new URL(req.headers.origin).host !== req.headers.host) {
        sendJson(res, 403, { error: "Cross-origin requests are not allowed." });
        return;
      }
    } catch {
      sendJson(res, 403, { error: "Invalid request origin." });
      return;
    }
  }

  // ==========================================
  // 1. AUTHENTICATION & REGISTRATION ENDPOINTS
  // ==========================================

  // User Registration (Donor, NGO, Volunteer. Admin registration is FORBIDDEN!)
  if (pathname === "/api/ngo-phone-otp/send" && req.method === "POST") {
    try {
      const { phone } = await parseBody(req);
      if (typeof phone !== "string" || !/^\+[1-9]\d{7,14}$/.test(phone)) {
        sendJson(res, 400, { error: "Enter a valid phone number with country code, such as +919876543210." });
        return;
      }

      const providerConfigured = Boolean(
        process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        process.env.TWILIO_VERIFY_SERVICE_SID
      );
      if (!providerConfigured) {
        sendJson(res, 503, { error: "Phone OTP delivery is not configured. Contact the platform administrator." });
        return;
      }

      const now = Date.now();
      const recentRequests = (phoneOtpRequests.get(phone) || []).filter((sentAt) => now - sentAt < 60 * 60 * 1000);
      if (recentRequests.length >= 5 || (recentRequests.length > 0 && now - recentRequests[recentRequests.length - 1] < 60 * 1000)) {
        sendJson(res, 429, { error: "Please wait before requesting another code." });
        return;
      }

      const result = await callPhoneOtpProvider("Verifications", new URLSearchParams({ To: phone, Channel: "sms" }));
      if (!result.configured) {
        sendJson(res, 503, { error: "Phone OTP delivery is not configured. Contact the platform administrator." });
        return;
      }
      if (!result.ok || result.status !== "pending") {
        sendJson(res, 502, { error: "The SMS provider could not send a verification code. Please try again later." });
        return;
      }

      verifiedNgoPhones.delete(phone);
      phoneOtpRequests.set(phone, [...recentRequests, now]);
      sendJson(res, 200, { success: true, message: "Verification code sent by SMS." });
    } catch (error) {
      console.error("NGO phone OTP send failed:", error);
      sendJson(res, 502, { error: "Unable to send the verification code right now. Please try again later." });
    }
    return;
  }

  if (pathname === "/api/ngo-phone-otp/verify" && req.method === "POST") {
    try {
      const { phone, code } = await parseBody(req);
      if (typeof phone !== "string" || !/^\+[1-9]\d{7,14}$/.test(phone) || typeof code !== "string" || !/^\d{6}$/.test(code)) {
        sendJson(res, 400, { error: "Enter the registered phone number and its 6-digit verification code." });
        return;
      }

      const result = await callPhoneOtpProvider(
        "VerificationCheck",
        new URLSearchParams({ To: phone, Code: code })
      );
      if (!result.configured) {
        sendJson(res, 503, { error: "Phone OTP verification is not configured. Contact the platform administrator." });
        return;
      }
      if (!result.ok || result.status !== "approved") {
        sendJson(res, 400, { error: "The code was not verified. Check the SMS and try again." });
        return;
      }

      verifiedNgoPhones.set(phone, Date.now() + 10 * 60 * 1000);
      sendJson(res, 200, { success: true, message: "Phone number verified." });
    } catch (error) {
      console.error("NGO phone OTP verification failed:", error);
      sendJson(res, 502, { error: "Unable to verify the code right now. Please try again later." });
    }
    return;
  }

  if (pathname === "/api/auth/register" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const { email, password, name, organization, role, phone, licenseDoc, capacity, vehicleType } = body;

      if (!email || !password || !name || !role) {
        sendJson(res, 400, { error: "Missing required fields: email, password, name, role" });
        return;
      }
      if (typeof role === "string" && role.toUpperCase() === "ADMIN") {
        sendJson(res, 403, { error: "Public registration for Administrator is strictly prohibited." });
        return;
      }
      if (
        typeof email !== "string" ||
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
        typeof password !== "string" ||
        password.length < 10 ||
        password.length > 128 ||
        typeof name !== "string" ||
        name.trim().length < 2 ||
        name.length > 120 ||
        typeof phone !== "string" ||
        phone.trim().length < 7 ||
        phone.length > 40 ||
        (organization !== undefined && (typeof organization !== "string" || organization.trim().length > 180))
      ) {
        sendJson(res, 400, { error: "Enter a valid email, name, and password (10-128 characters)." });
        return;
      }

      // STRICT RULE: Never allow public admin registration
      if (typeof role !== "string") {
        sendJson(res, 403, { error: "Public registration for Administrator is strictly prohibited." });
        return;
      }
      if (!["DONOR", "NGO", "VOLUNTEER"].includes(role.toUpperCase())) {
        sendJson(res, 400, { error: "Role must be DONOR, NGO, or VOLUNTEER." });
        return;
      }
      const phoneVerifiedUntil = typeof phone === "string" ? verifiedNgoPhones.get(phone.trim()) : undefined;
      if (
        role.toUpperCase() === "NGO" &&
        (!phoneVerifiedUntil || phoneVerifiedUntil < Date.now())
      ) {
        sendJson(res, 403, { error: "Verify this phone number by SMS before creating an NGO account." });
        return;
      }

      // Check duplicate email
      if (users.some((u) => u.email.toLowerCase() === email.trim().toLowerCase())) {
        sendJson(res, 409, { error: "An account with this email address already exists." });
        return;
      }

      // NGO Registration Requirement: License / Registration Document Upload
      if (role.toUpperCase() === "NGO" && (
        typeof organization !== "string" ||
        organization.trim().length < 3 ||
        !licenseDoc ||
        !Number.isInteger(capacity) ||
        capacity < 1 ||
        capacity > 1000 ||
        typeof body.lat !== "number" ||
        typeof body.lng !== "number" ||
        !Number.isFinite(body.lat) ||
        !Number.isFinite(body.lng) ||
        Math.abs(body.lat) > 90 ||
        Math.abs(body.lng) > 180
      )) {
        sendJson(res, 400, {
          error: "NGO registration requires organization details, location coordinates, and an official registration document (PDF/JPG/PNG).",
        });
        return;
      }

      const assignedRole = role.toUpperCase() as Role;
      const newUserId = `USER-${assignedRole}-${crypto.randomUUID()}`;
      const ngoProfileId = assignedRole === "NGO" ? `NGO-${crypto.randomUUID()}` : undefined;

      let savedDocPath: string | undefined;
      if (assignedRole === "NGO") {
        if (typeof licenseDoc !== "string") {
          sendJson(res, 400, { error: "Registration document is required." });
          return;
        }
        const docMatch = licenseDoc.match(/^data:(application\/pdf|image\/png|image\/jpeg);base64,([A-Za-z0-9+/=]+)$/);
        if (!docMatch) {
          sendJson(res, 400, { error: "Document must be a valid PDF, JPG, or PNG upload." });
          return;
        }
        const mime = docMatch[1];
        const base64Data = docMatch[2];
        const documentBytes = Buffer.from(base64Data, "base64");
        if (documentBytes.length === 0 || documentBytes.length > 5 * 1024 * 1024) {
          sendJson(res, 400, { error: "Document must be no larger than 5 MB." });
          return;
        }
        const validSignature =
          (mime === "application/pdf" && documentBytes.subarray(0, 5).toString() === "%PDF-") ||
          (mime === "image/png" && documentBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
          (mime === "image/jpeg" && documentBytes[0] === 0xff && documentBytes[1] === 0xd8 && documentBytes[2] === 0xff);
        if (!validSignature) {
          sendJson(res, 400, { error: "The uploaded file contents do not match its PDF/JPG/PNG type." });
          return;
        }
        const ext = mime === "application/pdf" ? ".pdf" : mime === "image/png" ? ".png" : ".jpg";
        const docFileName = `doc_${newUserId}_${Date.now()}${ext}`;
        const docFilePath = path.join(DOCS_DIR, docFileName);
        fs.writeFileSync(docFilePath, documentBytes, { flag: "wx", mode: 0o600 });
        savedDocPath = `uploads/documents/${docFileName}`;
      }

      const newUser: PlatformUser = {
        id: newUserId,
        email: email.trim().toLowerCase(),
        passwordHash: hashPassword(password),
        role: assignedRole,
        name: name.trim(),
        organization: typeof organization === "string" ? organization.trim() : name.trim(),
        phone: phone.trim(),
        avatar: assignedRole === "DONOR" ? "👨‍🍳" : assignedRole === "NGO" ? "🏢" : "🚴",
        verification: "PENDING", // MUST BE VERIFIED BY ADMIN BEFORE ACTIONS
        isAvailable: assignedRole === "VOLUNTEER",
        licenseDoc: savedDocPath,
        capacity: assignedRole === "NGO" && Number.isInteger(capacity) && capacity > 0 ? capacity : undefined,
        vehicleType: vehicleType || "Standard Vehicle",
        ngoProfileId,
        createdAt: new Date().toISOString(),
      };

      users.push(newUser);
      await saveUser(newUser);
      if (assignedRole === "NGO") verifiedNgoPhones.delete(phone.trim());

      // If registered as NGO, also add to NGO candidate registry with pending status
      if (assignedRole === "NGO") {
        const newNgoRecord = {
          id: ngoProfileId!,
          verified: false, // NOT verified until admin approves
          location: { lat: body.lat, lng: body.lng },
          freeCapacity: newUser.capacity || 50,
          acceptsCategories: ["cooked_meals", "packaged", "bakery"],
          excludedAllergens: [],
          maxKm: 10,
          isDemo: false,
        };
        ngos.push(newNgoRecord);
        await updateNgo(newNgoRecord.id, newNgoRecord);
      }

      // Log to cryptographic audit ledger
      const regBlock = globalLedger.append("USER_REGISTERED", newUserId, {
        role: assignedRole,
        name: newUser.name,
        organization: newUser.organization,
        verificationStatus: "PENDING",
      });
      await saveLedgerEvent(regBlock);

      // Push notification to Admin
      pushNotification("USER-ADMIN-1", "New Verification Request", `${newUser.name} (${assignedRole}) submitted registration for admin review.`, "warning");

      setAuthCookie(res, newUser.id);
      sendJson(res, 201, {
        success: true,
        message: "Registration submitted successfully! Your account is pending admin verification.",
        user: {
          ...publicUser(newUser),
          verification: newUser.verification,
        },
      });
    } catch (err: any) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // User Login (Validates credentials, role & password)
  if (pathname === "/api/auth/login" && req.method === "POST") {
    try {
      const { email, password, role } = await parseBody(req);
      if (
        typeof email !== "string" ||
        typeof password !== "string" ||
        email.length > 254 ||
        password.length < 1 ||
        password.length > 128
      ) {
        sendJson(res, 400, { error: "Enter a valid email and password." });
        return;
      }
      const trimmedEmail = email.trim().toLowerCase();

      const user = users.find(
        (u) =>
          u.email.toLowerCase() === trimmedEmail &&
          (!role || u.role.toLowerCase() === role.toLowerCase())
      );

      if (!user) {
        sendJson(res, 401, {
          error: "Account not found for this role. Check your credentials or use the 1-Click Demo Login button.",
        });
        return;
      }

      if (!verifyPassword(password, user.passwordHash)) {
        sendJson(res, 401, { error: "Incorrect email or password." });
        return;
      }

      setAuthCookie(res, user.id);
      sendJson(res, 200, {
        success: true,
        user: publicUser(user),
      });
    } catch (err: any) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // Get Current Session User
  if (pathname === "/api/auth/me" && req.method === "GET") {
    const user = authenticateRequest(req);
    if (!user) {
      sendJson(res, 401, { error: "Unauthenticated" });
      return;
    }
    sendJson(res, 200, { user: publicUser(user) });
    return;
  }

  if (pathname === "/api/auth/logout" && req.method === "POST") {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader("Set-Cookie", `foodbridge_session=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${secure}`);
    sendJson(res, 200, { success: true });
    return;
  }

  // ==========================================
  // 2. ADMIN DASHBOARD & VERIFICATION ENDPOINTS
  // ==========================================

  // List all pending verification applications (Admin only)
  if (pathname === "/api/admin/verifications" && req.method === "GET") {
    const user = authenticateRequest(req);
    if (!user || user.role !== "ADMIN") {
      sendJson(res, 403, { error: "Admin authorization required." });
      return;
    }

    const pendingUsers = users.filter((u) => u.verification === "PENDING");
    const verifiedUsers = users.filter((u) => u.verification === "APPROVED");
    const rejectedUsers = users.filter((u) => u.verification === "REJECTED");

    sendJson(res, 200, {
      pending: pendingUsers.map((u) => ({
        ...publicUser(u),
        licenseDoc: u.licenseDoc,
        capacity: u.capacity,
        vehicleType: u.vehicleType,
        createdAt: u.createdAt,
      })),
      approvedCount: verifiedUsers.length,
      rejectedCount: rejectedUsers.length,
    });
    return;
  }

  // Admin Approve or Reject user application
  if (pathname === "/api/admin/verify" && req.method === "POST") {
    try {
      const user = authenticateRequest(req);
      if (!user || user.role !== "ADMIN") {
        sendJson(res, 403, { error: "Admin authorization required." });
        return;
      }

      const { userId, action, reason } = await parseBody(req);
      const targetUser = users.find((u) => u.id === userId);

      if (!targetUser) {
        sendJson(res, 404, { error: "User not found" });
        return;
      }
      if (targetUser.role === "ADMIN" || targetUser.verification !== "PENDING") {
        sendJson(res, 409, { error: "Only pending non-admin applications can be reviewed." });
        return;
      }

      if (action !== "APPROVE" && action !== "REJECT") {
        sendJson(res, 400, { error: "Action must be APPROVE or REJECT" });
        return;
      }
      if (reason !== undefined && (typeof reason !== "string" || reason.length > 500)) {
        sendJson(res, 400, { error: "Review reason must be plain text with at most 500 characters." });
        return;
      }
      const matchingNgo = targetUser.role === "NGO"
        ? ngos.find((ngo) => ngo.id === targetUser.ngoProfileId)
        : undefined;
      if (targetUser.role === "NGO" && !matchingNgo) {
        sendJson(res, 409, { error: "Registered NGO matching profile could not be found." });
        return;
      }

      targetUser.verification = action === "APPROVE" ? "APPROVED" : "REJECTED";
      await updateUser(targetUser.id, { verification: targetUser.verification });

      // If this is an NGO, update its verified status in the matching candidate registry
      if (targetUser.role === "NGO" && matchingNgo) {
        matchingNgo.verified = action === "APPROVE";
        await updateNgo(matchingNgo.id, { verified: action === "APPROVE" });
      }

      // Append to cryptographic audit ledger
      const verifBlock = globalLedger.append(
        action === "APPROVE" ? "USER_VERIFIED" : "USER_REJECTED",
        targetUser.id,
        {
          targetUserId: targetUser.id,
          role: targetUser.role,
          approvedBy: user.name,
          reason: reason || (action === "APPROVE" ? "Documents & eligibility verified" : "Application declined"),
        }
      );
      await saveLedgerEvent(verifBlock);

      // Push notification to applicant
      pushNotification(
        targetUser.id,
        `Verification ${action === "APPROVE" ? "Approved" : "Rejected"}`,
        action === "APPROVE"
          ? "Congratulations! Your account has been verified by the administrator. You now have full access."
          : `Your verification request was rejected. Reason: ${reason || "Does not meet platform requirements."}`,
        action === "APPROVE" ? "success" : "warning"
      );

      sendJson(res, 200, {
        success: true,
        message: `User ${targetUser.name} marked as ${targetUser.verification}`,
        user: publicUser(targetUser),
      });
    } catch (err: any) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // Admin: Get all system users
  if (pathname === "/api/admin/users" && req.method === "GET") {
    const user = authenticateRequest(req);
    if (!user || user.role !== "ADMIN") {
      sendJson(res, 403, { error: "Admin authorization required." });
      return;
    }

    sendJson(res, 200, {
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        nameKn: u.nameKn,
        organization: u.organization,
        orgNameKn: u.orgNameKn,
        role: u.role,
        verification: u.verification,
        isAvailable: u.isAvailable,
        hasLicenseDoc: Boolean(u.licenseDoc),
        capacity: u.capacity,
        vehicleType: u.vehicleType,
        district: u.district,
        city: u.city,
        createdAt: u.createdAt,
      })),
    });
    return;
  }

  const documentMatch = pathname.match(/^\/api\/admin\/documents\/([A-Za-z0-9-]+)$/);
  if (documentMatch && req.method === "GET") {
    const user = authenticateRequest(req);
    if (!user || user.role !== "ADMIN") {
      sendJson(res, 403, { error: "Admin authorization required." });
      return;
    }
    const applicant = users.find((u) => u.id === documentMatch[1]);
    if (!applicant?.licenseDoc) {
      sendJson(res, 404, { error: "Verification document not found." });
      return;
    }
    const fileName = path.basename(applicant.licenseDoc);
    const filePath = path.join(DOCS_DIR, fileName);
    fs.readFile(filePath, (err, content) => {
      if (err) {
        sendJson(res, 404, { error: "Verification document is unavailable." });
        return;
      }
      const mime = path.extname(fileName).toLowerCase() === ".pdf"
        ? "application/pdf"
        : path.extname(fileName).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
      res.writeHead(200, {
        "Content-Type": mime,
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      });
      res.end(content);
    });
    return;
  }

  // ==========================================
  // 3. DELIVERY COURIER AVAILABILITY STATUS
  // ==========================================

  // Toggle Delivery Partner Availability Status (AVAILABLE vs OFF_DUTY)
  if (pathname === "/api/delivery/status" && req.method === "POST") {
    try {
      const authUser = authenticateRequest(req);
      if (!authUser || authUser.role !== "VOLUNTEER" || authUser.verification !== "APPROVED") {
        sendJson(res, 403, { error: "A verified delivery partner account is required." });
        return;
      }
      const body = await parseBody(req);
      if (typeof body.isAvailable !== "boolean") {
        sendJson(res, 400, { error: "isAvailable must be a boolean." });
        return;
      }
      const targetUser = authUser;
      const isAvailable = body.isAvailable;
      const hasActiveAssignment = Array.from(activeHandovers.values()).some(
        (handover) => handover.collectorId === targetUser.id && handover.status !== "DELIVERED" && handover.status !== "CANCELLED"
      );
      if (isAvailable && hasActiveAssignment) {
        sendJson(res, 409, { error: "You cannot become available while an assigned mission is active." });
        return;
      }

      targetUser.isAvailable = isAvailable;
      await updateUser(targetUser.id, { isAvailable });

      // Log to audit ledger
      const volBlock = globalLedger.append("VOLUNTEER_AVAILABILITY_CHANGED", targetUser.id, {
        courier: targetUser.name,
        isAvailable,
        status: isAvailable ? "AVAILABLE" : "OFF_DUTY",
      });
      await saveLedgerEvent(volBlock);

      sendJson(res, 200, {
        success: true,
        isAvailable: targetUser.isAvailable,
        message: `Status updated: You are now ${targetUser.isAvailable ? "Available for deliveries" : "Off Duty"}`,
      });
    } catch (err: any) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // ==========================================
  // 4. DONATIONS (With Admin Verification Gate)
  // ==========================================

  // List all donations
  if (pathname === "/api/donations" && req.method === "GET") {
    const user = authenticateRequest(req);
    const districtFilter = parsedUrl.searchParams.get("district");
    let visibleDonations = donations.filter((donation) => donation.status === "LISTED");
    if (user?.role === "DONOR") {
      visibleDonations = donations.filter((donation) => donation.donorId === user.id);
    } else if (user?.role === "NGO") {
      visibleDonations = donations.filter(
        (donation) =>
          donation.status === "LISTED" ||
          donation.status === "REQUESTED" ||
          donation.assignedNgoId === user.ngoProfileId ||
          donation.assignedNgoId === user.id ||
          donation.requestedByNgoId === user.ngoProfileId ||
          donation.requestedByNgoId === user.id
      );
    } else if (user?.role === "VOLUNTEER") {
      visibleDonations = donations.filter(
        (donation) =>
          donation.collectorId === user.id ||
          donation.status === "LISTED" ||
          donation.status === "REQUESTED"
      );
    } else if (user?.role === "ADMIN") {
      visibleDonations = donations;
    }

    if (districtFilter && districtFilter !== "all") {
      visibleDonations = visibleDonations.filter(
        (d) => d.district?.toLowerCase() === districtFilter.toLowerCase()
      );
    }
    sendJson(res, 200, {
      donations: visibleDonations.map((donation) => {
        // Privacy guard: Only disclose exact pickup address and precise GPS coordinates to the donor,
        // the assigned/requesting shelter, assigned courier, or system admin.
        const canSeeExactDetails = Boolean(user && (
          user.role === "ADMIN" ||
          (user.role === "DONOR" && donation.donorId === user.id) ||
          (user.role === "NGO" && (
            donation.assignedNgoId === user.ngoProfileId ||
            donation.assignedNgoId === user.id ||
            donation.requestedByNgoId === user.ngoProfileId ||
            donation.requestedByNgoId === user.id
          )) ||
          (user.role === "VOLUNTEER" && donation.collectorId === user.id)
        ));

        if (canSeeExactDetails) {
          return donation;
        }

        const { pickupAddress: _pickupAddress, ...donationWithoutAddress } = donation;
        return {
          ...donationWithoutAddress,
          location: {
            lat: Math.round(donation.location.lat * 100) / 100,
            lng: Math.round(donation.location.lng * 100) / 100,
          },
        };
      }),
    });
    return;
  }

  // Live Zomato-Style Movement & Handover Tracking
  const trackingMatch = pathname.match(/^\/api\/donations\/([A-Za-z0-9-]+)\/tracking$/);
  if (trackingMatch && req.method === "GET") {
    const donationId = trackingMatch[1];
    const don = donations.find((d) => d.id === donationId);
    if (!don) {
      sendJson(res, 404, { error: "Donation not found" });
      return;
    }
    const user = authenticateRequest(req);
    const donorUser = users.find((u) => u.id === don.donorId);
    const requestingNgo = (user?.role === "NGO") ? (ngos.find(n => n.id === user.ngoProfileId) || user) : null;
    const ngoProfile = ngos.find((n) => n.id === don.assignedNgoId) || (requestingNgo as any);
    const ngoUser = users.find((u) => u.ngoProfileId === don.assignedNgoId || u.id === don.assignedNgoId) || requestingNgo;
    const courierUser = users.find((u) => u.id === don.collectorId);

    const donorLoc = don.location || { lat: 12.9234, lng: 74.8643 };
    const ngoLoc = ngoProfile?.location || (requestingNgo as any)?.location || { lat: 12.921, lng: 74.862 };

    // Calculate distance
    const R = 6371;
    const dLat = (ngoLoc.lat - donorLoc.lat) * (Math.PI / 180);
    const dLng = (ngoLoc.lng - donorLoc.lng) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(donorLoc.lat * (Math.PI / 180)) * Math.cos(ngoLoc.lat * (Math.PI / 180)) * Math.sin(dLng / 2) ** 2;
    const distanceKm = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
    const etaMinutes = Math.max(5, Math.round(distanceKm * 3.5 + 4));

    // Courier live movement progress
    let progress = 0;
    if (don.status === "ASSIGNED") progress = 0.2;
    else if (don.status === "PICKED_UP") progress = 0.65;
    else if (don.status === "DELIVERED") progress = 1.0;

    const courierLat = donorLoc.lat + (ngoLoc.lat - donorLoc.lat) * progress;
    const courierLng = donorLoc.lng + (ngoLoc.lng - donorLoc.lng) * progress;

    sendJson(res, 200, {
      donationId: don.id,
      title: don.title,
      status: don.status,
      foodQualityPassed: Boolean(don.foodQualityPassed),
      foodQualityNotes: don.foodQualityNotes || "Fresh banquet meals inspected & verified",
      donor: {
        name: don.donorName,
        address: don.pickupAddress,
        location: donorLoc,
        phone: donorUser?.phone || "+91 98450 12345"
      },
      ngo: {
        name: ngoUser?.organization || don.assignedNgoId || "Receiving Shelter",
        location: ngoLoc,
        phone: ngoUser?.phone || "+91 98450 67890"
      },
      courier: {
        id: don.collectorId,
        name: courierUser?.name || "Eco-Rescue Volunteer Courier",
        vehicleType: courierUser?.vehicleType || "Electric Scooter",
        phone: courierUser?.phone || "+91 98450 99887",
        currentLocation: { lat: courierLat, lng: courierLng }
      },
      tracking: {
        distanceKm: Math.max(0.8, distanceKm),
        etaMinutes,
        progress,
        step: don.status === "DELIVERED" ? 4 : don.status === "PICKED_UP" ? 3 : don.status === "ASSIGNED" ? 2 : 1,
        stepDescription: don.status === "DELIVERED"
          ? "Delivered & verified by receiving NGO"
          : don.status === "PICKED_UP"
          ? "Food Quality Verified · Delivery partner has picked up your food and left donor hotel kitchen"
          : don.status === "ASSIGNED"
          ? "Courier dispatched to donor hotel"
          : "Listed surplus awaiting assignment"
      }
    });
    return;
  }

  // Post new food donation (ENFORCES DONOR VERIFICATION!)
  if (pathname === "/api/donations" && req.method === "POST") {
    try {
      const authUser = authenticateRequest(req);
      if (!authUser || authUser.role !== "DONOR" || authUser.verification !== "APPROVED") {
        sendJson(res, 403, { error: "A verified donor account is required to publish donations." });
        return;
      }
      const body = await parseBody(req);
      const quantity = Number(body.quantity);
      const hours = Number(body.hours);
      const location = body.location;
      if (
        typeof body.title !== "string" ||
        body.title.trim().length < 3 ||
        body.title.length > 120 ||
        typeof body.pickupAddress !== "string" ||
        body.pickupAddress.length > 300 ||
        body.pickupAddress.trim().length < 5 ||
        body.pickupAddress.trim().length > 300 ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 10000 ||
        !Number.isFinite(hours) ||
        hours < 0.25 ||
        hours > 48 ||
        !location ||
        !Number.isFinite(location.lat) ||
        !Number.isFinite(location.lng) ||
        Math.abs(location.lat) > 90 ||
        Math.abs(location.lng) > 180 ||
        !Array.isArray(body.allergens) ||
        body.allergens.some((item: unknown) => typeof item !== "string" || item.length > 40) ||
        !["cooked_meals", "bakery", "packaged", "produce"].includes(body.category) ||
        typeof body.storageOk !== "boolean"
      ) {
        sendJson(res, 400, { error: "Enter a title, pickup address, valid quantity, deadline, confirmed location, allergens, and verified storage status." });
        return;
      }

      const now = Date.now();
      const donor = authUser;
      const id = `DON-${crypto.randomUUID()}`;

      const newDonation: PlatformDonation = {
        id,
        title: body.title.trim(),
        donorId: donor.id,
        donorName: donor.organization || donor.name,
        pickupAddress: body.pickupAddress.trim(),
        quantity,
        location,
        deadline: now + hours * 3.6e6,
        allergens: [...new Set(body.allergens.map((item: string) => item.trim().toLowerCase()))],
        storageOk: body.storageOk,
        category: body.category,
        status: "LISTED",
        handoverType: "VOLUNTEER",
        createdAt: now,
        isDemo: false,
      };

      donations.unshift(newDonation);
      await saveDonation(newDonation);

      const listBlock = globalLedger.append("DONATION_LISTED", id, {
        donorId: donor.id,
        donorName: newDonation.donorName,
        quantity: newDonation.quantity,
        category: newDonation.category,
      });
      await saveLedgerEvent(listBlock);
      const placeInfo = newDonation.pickupAddress ? ` at ${newDonation.pickupAddress}` : "";
      const notifMsg = `🍲 New Surplus Food Available: ${newDonation.title} (${newDonation.quantity} plates) from ${newDonation.donorName}${placeInfo}! Check details to accept or dispatch.`;
      for (const recipient of users.filter((candidate) => (candidate.role === "NGO" || candidate.role === "VOLUNTEER") && candidate.verification === "APPROVED")) {
        pushNotification(recipient.id, "New Surplus Food Available", notifMsg, "info");
      }

      sendJson(res, 201, { success: true, donation: newDonation });
    } catch (err: any) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // ==========================================
  // 5. MATCHING & RESERVATION (With NGO Self-Pickup & Donor Approval)
  // ==========================================

  // NGO Requests Food with portion count & handover preference (Donor will Approve/Reject)
  if (pathname === "/api/ngo/request-food" && req.method === "POST") {
    try {
      const user = authenticateRequest(req);
      if (!user || user.role !== "NGO" || user.verification !== "APPROVED") {
        sendJson(res, 403, { error: "A verified NGO shelter account is required to request food." });
        return;
      }
      const body = await parseBody(req);
      const { donationId, requestedQuantity, handoverType = "VOLUNTEER", notes } = body;
      const don = donations.find((d) => d.id === donationId);

      if (!don) {
        sendJson(res, 404, { error: "Donation not found" });
        return;
      }
      if (don.status !== "LISTED") {
        sendJson(res, 409, { error: `This food listing is currently ${don.status} and cannot be requested.` });
        return;
      }

      const requestedPlates = parseInt(requestedQuantity, 10);
      if (!Number.isInteger(requestedPlates) || requestedPlates <= 0) {
        sendJson(res, 400, { error: "Please specify a valid number of plates." });
        return;
      }

      const claimQuantity = Math.min(requestedPlates, don.quantity);

      don.status = "REQUESTED";
      don.requestedQuantity = claimQuantity;
      don.requestedByNgoId = user.ngoProfileId || user.id;
      don.requestedByNgoName = user.organization || user.name;
      don.requestedHandoverType = handoverType === "NGO_SELF_PICKUP" ? "NGO_SELF_PICKUP" : "VOLUNTEER";
      (don as any).requestNotes = notes || "";

      await updateDonation(don.id, {
        status: "REQUESTED",
        requestedQuantity: don.requestedQuantity,
        requestedByNgoId: don.requestedByNgoId,
        requestedByNgoName: don.requestedByNgoName,
        requestedHandoverType: don.requestedHandoverType,
        requestNotes: (don as any).requestNotes,
      });

      // Log to audit ledger
      const reqBlock = globalLedger.append("FOOD_REQUESTED_BY_NGO", don.id, {
        ngoId: don.requestedByNgoId,
        ngoName: don.requestedByNgoName,
        requestedQuantity: don.requestedQuantity,
        handoverType: don.requestedHandoverType,
      });
      await saveLedgerEvent(reqBlock);

      // Notify donor
      await pushNotification(
        don.donorId,
        "New Shelter Request!",
        `🔔 ${don.requestedByNgoName} has requested ${don.requestedQuantity} plates of ${don.title} (${don.requestedHandoverType === 'NGO_SELF_PICKUP' ? 'NGO Self-Pickup' : 'Volunteer Courier'}). Please review and approve!`,
        "warning"
      );

      sendJson(res, 200, {
        success: true,
        donation: don,
        message: `Request for ${claimQuantity} plates submitted! Awaiting donor approval.`,
      });
    } catch (err: any) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // Donor Approves or Rejects Incoming NGO Food Request
  if (pathname === "/api/donor/request-action" && req.method === "POST") {
    try {
      const user = authenticateRequest(req);
      if (!user || user.role !== "DONOR" || user.verification !== "APPROVED") {
        sendJson(res, 403, { error: "Verified donor authentication required." });
        return;
      }
      const body = await parseBody(req);
      const { donationId, action, reason } = body;
      const don = donations.find((d) => d.id === donationId);

      if (!don) {
        sendJson(res, 404, { error: "Donation not found" });
        return;
      }
      if (don.donorId !== user.id) {
        sendJson(res, 403, { error: "You can only approve or reject requests for your own listings." });
        return;
      }
      if (don.status !== "REQUESTED") {
        sendJson(res, 400, { error: `Donation is not in REQUESTED state (currently ${don.status}).` });
        return;
      }

      const targetNgoId = don.requestedByNgoId!;
      const ngoName = don.requestedByNgoName || "Shelter";
      const approvedQty = don.requestedQuantity || don.quantity;
      const handoverType = don.requestedHandoverType || "VOLUNTEER";

      if (action === "APPROVE") {
        don.quantity = approvedQty;
        don.assignedNgoId = targetNgoId;
        don.handoverType = handoverType;

        let targetNgo = ngos.find((n) => n.id === targetNgoId);
        if (!targetNgo) {
          targetNgo = {
            id: targetNgoId,
            verified: true,
            location: { lat: 12.921, lng: 74.862 },
            freeCapacity: 100,
            acceptsCategories: ["cooked_meals", "bakery", "packaged", "produce"],
            excludedAllergens: [],
            maxKm: 25,
            district: "Dakshina Kannada"
          };
          ngos.push(targetNgo);
        }

        const handover = new Handover(
          don.id,
          don.donorId,
          targetNgoId,
          targetNgo.location,
          globalLedger,
          PEPPER
        );

        if (handoverType === "NGO_SELF_PICKUP") {
          handover.enableSelfPickup(targetNgoId);
          don.status = "ASSIGNED";
          don.collectorId = "NGO_SELF_PICKUP";
        } else {
          // Check for available courier (prioritizing same district)
          let availableCouriers = users.filter(
            (u) => u.role === "VOLUNTEER" && u.verification === "APPROVED" && u.isAvailable === true
          );
          const matchDistrict = don.district || targetNgo.district || "Dakshina Kannada";
          if (matchDistrict) {
            const districtCouriers = availableCouriers.filter(
              (u) => u.district && u.district.toLowerCase() === matchDistrict.toLowerCase()
            );
            if (districtCouriers.length > 0) {
              availableCouriers = districtCouriers;
            }
          }
          if (availableCouriers.length === 0) {
            // Self-pickup fallback if no courier is online
            handover.enableSelfPickup(targetNgoId);
            don.handoverType = "NGO_SELF_PICKUP";
            don.status = "ASSIGNED";
            don.collectorId = "NGO_SELF_PICKUP";
          } else {
            const courier = availableCouriers[0];
            handover.assignCollector(courier.id, "DONOR-APPROVAL");
            don.status = "ASSIGNED";
            don.collectorId = courier.id;
            courier.isAvailable = false;
            await updateUser(courier.id, { isAvailable: false });
            await pushNotification(courier.id, "New Food Rescue Mission", `Deliver ${don.title} from ${don.donorName} to ${ngoName}.`, "info");
          }
        }

        activeHandovers.set(don.id, handover);
        await updateDonation(don.id, {
          status: don.status,
          quantity: don.quantity,
          assignedNgoId: don.assignedNgoId,
          handoverType: don.handoverType,
          collectorId: don.collectorId,
        });

        // Log approval to ledger
        const appBlock = globalLedger.append("FOOD_REQUEST_APPROVED", don.id, {
          donorId: user.id,
          ngoId: targetNgoId,
          quantity: don.quantity,
          handoverType: don.handoverType,
          collectorId: don.collectorId,
        });
        await saveLedgerEvent(appBlock);

        // Notify receiving NGO
        await pushNotification(
          targetNgoId,
          "Food Request Approved!",
          `🎉 ${user.organization || user.name} approved your request for ${don.quantity} plates of ${don.title}! Mode: ${don.handoverType === 'NGO_SELF_PICKUP' ? 'NGO Self-Pickup' : 'Volunteer Courier'}.`,
          "success"
        );

        sendJson(res, 200, {
          success: true,
          action: "APPROVE",
          donation: don,
          message: `Request approved! ${don.quantity} plates assigned for ${don.handoverType === 'NGO_SELF_PICKUP' ? 'Self-Pickup' : 'Volunteer Courier'}.`,
        });
      } else {
        // REJECT
        don.status = "LISTED";
        don.requestedByNgoId = undefined;
        don.requestedByNgoName = undefined;
        don.requestedQuantity = undefined;
        don.requestedHandoverType = undefined;

        await updateDonation(don.id, {
          status: "LISTED",
          requestedByNgoId: null as any,
          requestedByNgoName: null as any,
          requestedQuantity: null as any,
          requestedHandoverType: null as any,
        });

        const rejBlock = globalLedger.append("FOOD_REQUEST_REJECTED", don.id, {
          donorId: user.id,
          ngoId: targetNgoId,
          reason: reason || "Declined by donor",
        });
        await saveLedgerEvent(rejBlock);

        await pushNotification(
          targetNgoId,
          "Request Declined",
          `Food request for ${don.title} was declined by ${user.organization || user.name}. ${reason ? `Reason: ${reason}` : ""}`,
          "warning"
        );

        sendJson(res, 200, {
          success: true,
          action: "REJECT",
          donation: don,
          message: "Request declined. Listing returned to available surplus.",
        });
      }
    } catch (err: any) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // Post-Delivery Food Quality & Service Feedback from NGO Shelter
  if (pathname === "/api/ngo/feedback" && req.method === "POST") {
    try {
      const user = authenticateRequest(req);
      if (!user || user.role !== "NGO" || user.verification !== "APPROVED") {
        sendJson(res, 403, { error: "Verified NGO account required to submit feedback." });
        return;
      }
      const body = await parseBody(req);
      const { donationId, rating, temperatureCondition, freshnessRating, packagingCondition, comments } = body;
      const don = donations.find((d) => d.id === donationId);

      if (!don) {
        sendJson(res, 404, { error: "Donation not found" });
        return;
      }
      if (don.assignedNgoId !== user.ngoProfileId && don.assignedNgoId !== user.id) {
        sendJson(res, 403, { error: "You can only submit feedback for food delivered to your shelter." });
        return;
      }
      if (don.status !== "DELIVERED") {
        sendJson(res, 400, { error: "Feedback can only be submitted for completed, delivered donations." });
        return;
      }

      const numRating = Number(rating);
      if (!Number.isFinite(numRating) || numRating < 1 || numRating > 5) {
        sendJson(res, 400, { error: "Rating must be between 1 and 5 stars." });
        return;
      }

      const feedbackRecord = {
        rating: Math.round(numRating),
        temperatureCondition: temperatureCondition || "Appropriate Temperature",
        freshnessRating: freshnessRating || "Fresh & Good",
        packagingCondition: packagingCondition || "Sealed & Intact",
        comments: typeof comments === "string" ? comments.trim() : "",
        submittedAt: new Date().toISOString(),
        ngoName: user.organization || user.name,
      };

      don.feedback = feedbackRecord;
      await updateDonation(don.id, { feedback: feedbackRecord });

      // Append to ledger
      const fbBlock = globalLedger.append("FOOD_FEEDBACK_SUBMITTED", don.id, {
        ngoId: user.ngoProfileId || user.id,
        rating: feedbackRecord.rating,
        comments: feedbackRecord.comments,
        freshness: feedbackRecord.freshnessRating,
      });
      await saveLedgerEvent(fbBlock);

      // Notify donor
      await pushNotification(
        don.donorId,
        "⭐ Shelter Food Quality Feedback!",
        `${user.organization || user.name} gave ${feedbackRecord.rating}/5 stars for ${don.title}: "${feedbackRecord.comments || 'Inspected, warm, and enjoyed by residents.'}"`,
        "success"
      );

      sendJson(res, 200, {
        success: true,
        feedback: feedbackRecord,
        message: "Thank you! Your food quality feedback has been recorded and shared with the donor.",
      });
    } catch (err: any) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // AI-Assisted Matching with detailed suitability explanation
  if (pathname === "/api/match" && req.method === "POST") {
    try {
      const user = authenticateRequest(req);
      if (!user || user.role !== "NGO" || user.verification !== "APPROVED") {
        sendJson(res, 403, { error: "An approved NGO account is required for matching." });
        return;
      }
      const body = await parseBody(req);
      const donationId = body.donationId;
      const targetDonation = donations.find((d) => d.id === donationId);

      if (!targetDonation) {
        sendJson(res, 404, { error: "Donation not found" });
        return;
      }
      if (targetDonation.status !== "LISTED") {
        sendJson(res, 409, { error: "Only currently listed donations can be matched." });
        return;
      }

      const now = Date.now();
      const candidateNgos = ngos.filter((ngo) => ngo.id === user.ngoProfileId);
      const eligibility = eligible(targetDonation, candidateNgos, now);
      const ranked = rankRuleBased(targetDonation, eligibility.ok, now);
      const {
        pickupAddress: _pickupAddress,
        location: _location,
        ...matchDonationFields
      } = targetDonation;

      sendJson(res, 200, {
        donation: {
          ...matchDonationFields,
          location: {
            lat: Math.round(targetDonation.location.lat * 100) / 100,
            lng: Math.round(targetDonation.location.lng * 100) / 100,
          },
        },
        isDemo: Boolean(targetDonation.isDemo),
        eligibility,
        ranked,
      });
    } catch (err: any) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // NGO Reservation: Supports VOLUNTEER dispatch or NGO_SELF_PICKUP
  if (pathname === "/api/reserve" && req.method === "POST") {
    try {
      const authUser = authenticateRequest(req);
      const body = await parseBody(req);
      const { donationId, ngoId, handoverType = "VOLUNTEER" } = body;
      if (!authUser || authUser.role !== "NGO" || authUser.verification !== "APPROVED") {
        sendJson(res, 403, { error: "A verified NGO account is required to reserve food." });
        return;
      }
      const ngoUser = authUser;

      const don = donations.find((d) => d.id === donationId);
      if (!don) {
        sendJson(res, 404, { error: "Donation not found" });
        return;
      }

      // PREVENT DUPLICATE RESERVATIONS & CONFLICTING ASSIGNMENTS
      if (don.status !== "LISTED") {
        sendJson(res, 409, { error: `Donation is already in ${don.status} state. Duplicate reservations are prevented.` });
        return;
      }
      if (handoverType !== "VOLUNTEER" && handoverType !== "NGO_SELF_PICKUP") {
        sendJson(res, 400, { error: "Handover type must be VOLUNTEER or NGO_SELF_PICKUP." });
        return;
      }

      let targetNgo = ngos.find((n) => n.id === ngoUser.ngoProfileId);
      if (!targetNgo && ngoId) {
        targetNgo = ngos.find((n) => n.id === ngoId);
      }
      if (!targetNgo) {
        targetNgo = {
          id: ngoUser.ngoProfileId || ngoId || `NGO-${ngoUser.id}`,
          verified: true,
          location: { lat: 12.921, lng: 74.862 },
          freeCapacity: ngoUser.capacity || 100,
          acceptsCategories: ["cooked_meals", "bakery", "packaged", "produce"],
          excludedAllergens: [],
          maxKm: 25,
          district: ngoUser.district || "Dakshina Kannada"
        };
        ngos.push(targetNgo);
      }

      // Allow NGO to specify number of plates required
      if (body.requestedQuantity) {
        const plates = parseInt(body.requestedQuantity, 10);
        if (Number.isInteger(plates) && plates > 0) {
          don.quantity = Math.min(plates, don.quantity);
          don.requestedQuantity = don.quantity;
        }
      }

      // Check available delivery couriers
      let availableCouriers = users.filter(
        (u) => u.role === "VOLUNTEER" && u.verification === "APPROVED" && u.isAvailable === true
      );
      const matchDistrict = don.district || targetNgo.district;
      if (matchDistrict) {
        const districtCouriers = availableCouriers.filter(
          (u) => u.district && u.district.toLowerCase() === matchDistrict.toLowerCase()
        );
        if (districtCouriers.length > 0) {
          availableCouriers = districtCouriers;
        }
      }

      // If user requested volunteer, but NO delivery partner is currently available:
      if (handoverType === "VOLUNTEER" && availableCouriers.length === 0) {
        sendJson(res, 200, {
          success: false,
          availableCouriers: 0,
          requiresSelfPickup: true,
          message: "Delivery partners are not available. Please arrange NGO self-pickup.",
        });
        return;
      }

      // Atomic reservation transition
      don.status = "RESERVED";
      don.assignedNgoId = targetNgo.id;
      don.handoverType = handoverType as HandoverType;
      targetNgo.freeCapacity = Math.max(0, targetNgo.freeCapacity - don.quantity);

      const handover = new Handover(
        don.id,
        don.donorId,
        ngoUser.id,
        targetNgo.location,
        globalLedger,
        PEPPER
      );

      if (handoverType === "NGO_SELF_PICKUP") {
        // Direct NGO Self-Pickup
        handover.enableSelfPickup(ngoUser.id);
        don.collectorId = "NGO_SELF_PICKUP";
        don.status = "ASSIGNED";
      } else {
        // Assign first available verified courier
        const assignedCourier = availableCouriers[0];
        handover.assignCollector(assignedCourier.id, "DISPATCH-AI-AUTO");
        don.status = "ASSIGNED";
        don.collectorId = assignedCourier.id;
        assignedCourier.isAvailable = false;
        await updateUser(assignedCourier.id, { isAvailable: false });
        await pushNotification(assignedCourier.id, "New Rescue Mission", `Deliver ${don.title} from ${don.donorName} to ${targetNgo.id}.`, "info");
      }
      await pushNotification(
        don.donorId,
        "Food Reserved by NGO",
        `${ngoUser.organization || ngoUser.name} reserved ${don.title} for ${handoverType === "NGO_SELF_PICKUP" ? "self-pickup" : "verified delivery"}.`,
        "success"
      );
      await pushNotification(ngoUser.id, "Reservation Confirmed", `${don.title} is assigned for ${handoverType === "NGO_SELF_PICKUP" ? "NGO Self-Pickup" : "verified delivery dispatch"}.`, "success");

      activeHandovers.set(don.id, handover);
      await updateDonation(don.id, {
        status: don.status,
        assignedNgoId: don.assignedNgoId,
        handoverType: don.handoverType,
        collectorId: don.collectorId,
      });
      await updateNgo(targetNgo.id, { freeCapacity: targetNgo.freeCapacity });
      await persistLedgerEvents();

      sendJson(res, 200, {
        success: true,
        donation: don,
        handoverType: don.handoverType,
        handoverStatus: handover.status,
        message:
          handoverType === "NGO_SELF_PICKUP"
            ? "Reserved for NGO Self-Pickup. Please proceed to the donor kitchen."
            : `Assigned to volunteer courier: ${don.collectorId}`,
      });
    } catch (err: any) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // ==========================================
  // 6. TWO-STAGE OTP HANDOVER (Pickup & Delivery)
  // ==========================================

  // Donor issues Pickup OTP
  if (pathname === "/api/pickup-otp" && req.method === "POST") {
    try {
      const user = authenticateRequest(req);
      const { donationId } = await parseBody(req);
      const don = donations.find((d) => d.id === donationId);
      const handover = activeHandovers.get(donationId);

      if (!don || !handover) {
        sendJson(res, 404, { error: "Handover session not found" });
        return;
      }
      if (!user || user.role !== "DONOR" || user.id !== don.donorId) {
        sendJson(res, 403, { error: "Only the donation's verified donor can issue its pickup code." });
        return;
      }

      const code = handover.issuePickupOtp(user.id);
      sendJson(res, 200, { success: true, pickupCode: code, issuedTo: handover.donorId });
    } catch (err: any) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // Hotel Food Quality Inspection by Volunteer
  if (pathname === "/api/verify-quality" && req.method === "POST") {
    try {
      const user = authenticateRequest(req);
      if (!user || (user.role !== "VOLUNTEER" && user.role !== "NGO")) {
        sendJson(res, 403, { error: "Only verified volunteers or pickup representatives can verify food quality." });
        return;
      }
      const body = await parseBody(req);
      const { donationId, temperatureOk, freshnessOk, packagingOk, hygieneOk, notes } = body;
      const don = donations.find((d) => d.id === donationId);
      if (!don) {
        sendJson(res, 404, { error: "Donation listing not found." });
        return;
      }

      don.foodQualityPassed = true;
      don.foodQualityCheckedAt = new Date().toISOString();
      don.foodQualityCheckedBy = user.name;
      don.foodQualityNotes = notes || "Passed hotel food sensory smell, temperature, packaging seal and hygiene check";

      await updateDonation(don.id, {
        foodQualityPassed: true,
        foodQualityCheckedAt: don.foodQualityCheckedAt,
        foodQualityCheckedBy: don.foodQualityCheckedBy,
        foodQualityNotes: don.foodQualityNotes,
      });

      const qBlock = globalLedger.append("FOOD_QUALITY_VERIFIED", don.id, {
        inspector: user.name,
        role: user.role,
        notes: don.foodQualityNotes,
        temperatureOk: Boolean(temperatureOk),
        freshnessOk: Boolean(freshnessOk),
        packagingOk: Boolean(packagingOk),
        hygieneOk: Boolean(hygieneOk),
      });
      await saveLedgerEvent(qBlock);

      if (don.assignedNgoId) {
        const ngoUser = users.find((u) => u.ngoProfileId === don.assignedNgoId || u.id === don.assignedNgoId);
        if (ngoUser) {
          await pushNotification(
            ngoUser.id,
            "Hotel Food Quality Verified",
            `Volunteer ${user.name} verified ${don.title} from ${don.donorName}: passed freshness, temperature and hygiene tests!`,
            "success"
          );
        }
      }

      sendJson(res, 200, {
        success: true,
        foodQualityPassed: true,
        message: "✅ Food Quality Test PASSED! Hotel-prepared food has passed freshness & hygiene verification.",
        donation: don,
      });
    } catch (err: any) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // Confirm Pickup OTP (Entered by Volunteer OR Self-Pickup NGO Rep)
  if (pathname === "/api/verify-pickup" && req.method === "POST") {
    try {
      const user = authenticateRequest(req);
      const { donationId, code } = await parseBody(req);
      const don = donations.find((d) => d.id === donationId);
      const handover = activeHandovers.get(donationId);

      if (!don || !handover) {
        sendJson(res, 404, { error: "Handover session not found" });
        return;
      }

      const isSelfPickup = handover.handoverType === "NGO_SELF_PICKUP";
      const isAuthorized = isSelfPickup
        ? Boolean(user && user.role === "NGO" && user.verification === "APPROVED" && (
            user.id === handover.collectorId ||
            user.ngoProfileId === handover.collectorId ||
            don.assignedNgoId === user.ngoProfileId ||
            don.assignedNgoId === user.id ||
            don.requestedByNgoId === user.ngoProfileId ||
            don.requestedByNgoId === user.id
          ))
        : Boolean(user && user.role === "VOLUNTEER" && user.verification === "APPROVED" && user.id === handover.collectorId);

      if (!isAuthorized) {
        sendJson(res, 403, { error: "Only the assigned, verified pickup partner can confirm pickup." });
        return;
      }
      if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
        sendJson(res, 400, { error: "Pickup code must contain exactly 6 digits." });
        return;
      }
      const result = handover.confirmPickup(isSelfPickup ? handover.collectorId : user.id, code);

      if (result === "OK") {
        don.status = "PICKED_UP";
        don.foodQualityPassed = true;
        don.pickedUpAt = new Date().toISOString();
        await updateDonation(don.id, { status: "PICKED_UP", foodQualityPassed: true, pickedUpAt: don.pickedUpAt });
        await pushNotification(don.donorId, "Pickup Confirmed", `${don.title} has been collected.`, "success");
        await pushNotification(
          handover.ngoRepId,
          "Food Picked Up — On The Way!",
          `Delivery partner has verified hotel food quality, picked up your food, and has left from the donor place! Heading towards your shelter.`,
          "success"
        );
        globalLedger.append("DONATION_PICKED_UP", don.id, { collectorId: user.id, handoverType: handover.handoverType });
        await persistLedgerEvents();
      }

      sendJson(res, result === "OK" ? 200 : 400, {
        result,
        status: handover.status,
        donationStatus: don.status,
      });
    } catch (err: any) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // Receiving NGO generates Delivery OTP
  if (pathname === "/api/delivery-otp" && req.method === "POST") {
    try {
      const user = authenticateRequest(req);
      const { donationId } = await parseBody(req);
      const handover = activeHandovers.get(donationId);

      if (!handover) {
        sendJson(res, 404, { error: "Handover session not found" });
        return;
      }
      if (!user || user.role !== "NGO" || user.verification !== "APPROVED" || user.id !== handover.ngoRepId) {
        sendJson(res, 403, { error: "Only the verified receiving NGO can issue the handover code." });
        return;
      }

      const code = handover.issueDeliveryOtp(user.id);
      sendJson(res, 200, { success: true, deliveryCode: code, issuedTo: handover.ngoRepId });
    } catch (err: any) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  if (pathname === "/api/delivery-proof" && req.method === "POST") {
    try {
      const user = authenticateRequest(req);
      const body = await parseBody(req);
      const donationId = body.donationId;
      const handover = activeHandovers.get(donationId);
      if (!user || !handover || user.id !== handover.collectorId || handover.status !== "PICKED_UP") {
        sendJson(res, 403, { error: "Only the assigned delivery partner may upload proof for an active handover." });
        return;
      }
      if (
        user.verification !== "APPROVED" ||
        (handover.handoverType === "NGO_SELF_PICKUP" ? user.role !== "NGO" : user.role !== "VOLUNTEER")
      ) {
        sendJson(res, 403, { error: "A verified assigned delivery partner is required." });
        return;
      }
      if (typeof body.photoData !== "string") {
        sendJson(res, 400, { error: "A JPG or PNG delivery photo is required." });
        return;
      }
      const match = body.photoData.match(/^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/=]+)$/);
      if (!match) {
        sendJson(res, 400, { error: "Delivery evidence must be a JPG or PNG image." });
        return;
      }
      const bytes = Buffer.from(match[2], "base64");
      if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024) {
        sendJson(res, 400, { error: "Delivery photo must be no larger than 5 MB." });
        return;
      }
      const validImage = match[1] === "image/png"
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      if (!validImage) {
        sendJson(res, 400, { error: "The uploaded file contents do not match its image type." });
        return;
      }
      const id = crypto.randomUUID();
      const ext = match[1] === "image/png" ? ".png" : ".jpg";
      const filePath = path.join(PROOFS_DIR, `${id}${ext}`);
      fs.writeFileSync(filePath, bytes, { flag: "wx", mode: 0o600 });
      deliveryProofs.set(id, { donationId, uploaderId: user.id, filePath });
      globalLedger.append("DELIVERY_PROOF_UPLOADED", donationId, { proofId: id, uploaderId: user.id });
      await persistLedgerEvents();
      sendJson(res, 201, { success: true, photoRef: id });
    } catch (err: any) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // Confirm Delivery & Photo Evidence (Never marks delivered without confirmation!)
  if (pathname === "/api/complete-delivery" && req.method === "POST") {
    try {
      const user = authenticateRequest(req);
      const { donationId, code, quantityReceived, photoRef, evidenceLocation } = await parseBody(req);
      const don = donations.find((d) => d.id === donationId);
      const handover = activeHandovers.get(donationId);

      if (!don || !handover) {
        sendJson(res, 404, { error: "Handover session not found" });
        return;
      }
      const selfPickup = handover.handoverType === "NGO_SELF_PICKUP";
      const isAuthorized = selfPickup
        ? Boolean(user && user.role === "NGO" && user.verification === "APPROVED" && (
            user.id === handover.collectorId ||
            user.ngoProfileId === handover.collectorId ||
            don.assignedNgoId === user.ngoProfileId ||
            don.assignedNgoId === user.id ||
            don.requestedByNgoId === user.ngoProfileId ||
            don.requestedByNgoId === user.id
          ))
        : Boolean(user && user.role === "VOLUNTEER" && user.verification === "APPROVED" && user.id === handover.collectorId);

      if (!isAuthorized) {
        sendJson(res, 403, { error: "Only the assigned, verified delivery partner can complete the handover." });
        return;
      }
      if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
        sendJson(res, 400, { error: "Delivery code must contain exactly 6 digits." });
        return;
      }
      const proof = typeof photoRef === "string" ? deliveryProofs.get(photoRef) : undefined;
      if (!proof || proof.donationId !== don.id || proof.uploaderId !== user.id) {
        sendJson(res, 400, { error: "Upload delivery photo evidence before confirming handover." });
        return;
      }
      if (!Number.isInteger(quantityReceived) || quantityReceived < 1 || quantityReceived > don.quantity) {
        sendJson(res, 400, { error: "Received quantity must be a positive whole number no greater than the donation quantity." });
        return;
      }

      const result = handover.completeDelivery({
        collectorId: selfPickup ? handover.collectorId : user.id,
        code,
        ngoRepId: handover.ngoRepId,
        quantityReceived,
        photoRef,
        evidenceLocation,
      });

      if (result === "OK") {
        don.status = "DELIVERED";
        don.deliveredQuantity = quantityReceived;
        const assignedUser = users.find((u) => u.id === user.id);
        if (assignedUser?.role === "VOLUNTEER") {
          assignedUser.isAvailable = true;
          await updateUser(assignedUser.id, { isAvailable: true });
        }
        await updateDonation(don.id, {
          status: "DELIVERED",
          deliveredQuantity: quantityReceived,
        });
        await persistLedgerEvents();
        await pushNotification(don.donorId, "Food Delivered", `${quantityReceived} of ${don.quantity} portions from ${don.title} were confirmed received.`, "success");
        await pushNotification(handover.ngoRepId, "Handover Complete", `${don.title} was received and confirmed.`, "success");
      }

      sendJson(res, result === "OK" ? 200 : 400, {
        result,
        handoverStatus: handover.status,
        donationStatus: don.status,
        flags: handover.flags,
      });
    } catch (err: any) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // NGO Direct Receipt Confirmation ("I have got the parcel" / Received option)
  if (pathname === "/api/ngo/confirm-received" && req.method === "POST") {
    try {
      const user = authenticateRequest(req);
      if (!user || user.role !== "NGO" || user.verification !== "APPROVED") {
        sendJson(res, 403, { error: "A verified NGO account is required to confirm parcel receipt." });
        return;
      }
      const body = await parseBody(req);
      const { donationId, notes, quantityReceived } = body;
      const don = donations.find((d) => d.id === donationId);
      const handover = activeHandovers.get(donationId);

      if (!don) {
        sendJson(res, 404, { error: "Donation not found" });
        return;
      }
      if (don.assignedNgoId !== user.ngoProfileId && don.assignedNgoId !== user.id) {
        sendJson(res, 403, { error: "This donation is not assigned to your shelter." });
        return;
      }
      if (don.status === "DELIVERED") {
        sendJson(res, 200, { success: true, message: "Parcel was already confirmed as delivered." });
        return;
      }

      const receivedQty = Number.isInteger(quantityReceived) && quantityReceived > 0
        ? quantityReceived
        : (don.deliveredQuantity || don.quantity);

      don.status = "DELIVERED";
      don.deliveredQuantity = receivedQty;
      don.deliveredAt = new Date().toISOString();
      await updateDonation(don.id, {
        status: "DELIVERED",
        deliveredQuantity: receivedQty,
        deliveredAt: don.deliveredAt,
      });

      if (handover) {
        handover.status = "DELIVERED";
      }

      if (don.collectorId && don.collectorId !== "NGO_SELF_PICKUP") {
        const assignedCourier = users.find((u) => u.id === don.collectorId);
        if (assignedCourier && assignedCourier.role === "VOLUNTEER") {
          assignedCourier.isAvailable = true;
          await updateUser(assignedCourier.id, { isAvailable: true });
        }
      }

      // Log to cryptographic audit ledger
      const recvBlock = globalLedger.append("NGO_PARCEL_RECEIVED", don.id, {
        ngoId: user.ngoProfileId || user.id,
        ngoName: user.organization || user.name,
        receivedQuantity: receivedQty,
        notes: notes || "Parcel received, inspected, and verified by NGO shelter representative",
      });
      await saveLedgerEvent(recvBlock);

      // Push notification to Donor & Courier
      await pushNotification(
        don.donorId,
        "Parcel Delivered & Received!",
        `🎉 ${user.organization || user.name} has confirmed receipt of ${receivedQty} meals for ${don.title}!`,
        "success"
      );
      if (don.collectorId && don.collectorId !== "NGO_SELF_PICKUP") {
        await pushNotification(
          don.collectorId,
          "Mission Completed!",
          `🎉 NGO Shelter has confirmed receipt of ${receivedQty} meals for ${don.title}. Thank you!`,
          "success"
        );
      }

      sendJson(res, 200, {
        success: true,
        donationStatus: "DELIVERED",
        deliveredQuantity: receivedQty,
        message: "🎉 Parcel confirmed as safely received and verified on ledger!",
      });
    } catch (err: any) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // ==========================================
  // 7. AUDIT LEDGER, STATS & RESET
  // ==========================================

  // Cryptographic Ledger Verification
  if (pathname === "/api/ledger" && req.method === "GET") {
    const verification = globalLedger.verify();
    sendJson(res, 200, {
      events: globalLedger.events,
      verification,
    });
    return;
  }

  // Platform Impact Statistics
  if (pathname === "/api/stats" && req.method === "GET") {
    const netStats = await getNetworkStats();
    const totalDonations = donations.length;
    const mealsRescued = donations
      .filter((d) => d.status === "DELIVERED")
      .reduce((sum, d) => sum + (d.deliveredQuantity || d.quantity), 0);
    const co2SavedKg = Math.round(mealsRescued * 2.5 * 10) / 10;
    const activeDeliveries = donations.filter((d) => d.status === "ASSIGNED" || d.status === "PICKED_UP").length;
    const availableCouriers = users.filter((u) => u.role === "VOLUNTEER" && u.verification === "APPROVED" && u.isAvailable).length;

    sendJson(res, 200, {
      totalDonations,
      mealsRescued,
      co2SavedKg,
      activeDeliveries,
      availableCouriers,
      verifiedNgos: ngos.filter((n) => n.verified).length,
      pendingVerifications: users.filter((u) => u.verification === "PENDING").length,
      ledgerBlocks: globalLedger.events.length,
      ledgerIntegrity: globalLedger.verify().ok,
      districtsCount: netStats.districtsCount,
      totalDailyCapacity: netStats.totalDailyCapacity,
      database: isMongoConnected() ? "mongodb" : "memory",
      demoMode: process.env.NODE_ENV !== "production",
    });
    return;
  }

  // List all Karnataka districts & state network info
  if (pathname === "/api/districts" && req.method === "GET") {
    const districts = await listAllDistricts();
    sendJson(res, 200, {
      districts,
      count: districts.length,
      database: isMongoConnected() ? "mongodb" : "memory",
    });
    return;
  }

  // Notifications endpoint
  if (pathname === "/api/notifications" && req.method === "GET") {
    const authUser = authenticateRequest(req);
    if (!authUser) {
      sendJson(res, 401, { error: "Authentication required." });
      return;
    }
    const userNotifs = await listUserNotifications(authUser.id);
    sendJson(res, 200, { notifications: userNotifs });
    return;
  }

  // Reset Demo State
  if (pathname === "/api/reset" && req.method === "POST") {
    const user = authenticateRequest(req);
    if (process.env.NODE_ENV === "production" || !user || user.role !== "ADMIN") {
      sendJson(res, 403, { error: "Admin authorization required." });
      return;
    }
    resetSeedData();
    sendJson(res, 200, { success: true, message: "Demo data reset successfully" });
    return;
  }

  // ==========================================
  // 8. STATIC FILE SERVING & ROUTE ALIASES
  // ==========================================
  const publicDir = path.join(__dirname, "public");
  let targetFile = pathname;

  if (pathname.startsWith("/uploads/documents/")) {
    sendJson(res, 404, { error: "Not found." });
    return;
  }

  if (targetFile === "/") targetFile = "/index.html";
  else if (targetFile === "/donor") targetFile = "/donor.html";
  else if (targetFile === "/donor-login") targetFile = "/donor-login.html";
  else if (targetFile === "/donor-signup") targetFile = "/donor-login.html";
  else if (targetFile === "/ngo") targetFile = "/ngo.html";
  else if (targetFile === "/ngo-login") targetFile = "/ngo-login.html";
  else if (targetFile === "/ngo-signup") targetFile = "/ngo-signup.html";
  else if (targetFile === "/delivery" || targetFile === "/volunteer") targetFile = "/delivery.html";
  else if (targetFile === "/delivery-login" || targetFile === "/volunteer-login") targetFile = "/delivery-login.html";
  else if (targetFile === "/delivery-signup" || targetFile === "/volunteer-signup") targetFile = "/delivery-login.html";
  else if (targetFile === "/admin") targetFile = "/admin.html";
  else if (targetFile === "/admin-login") targetFile = "/admin-login.html";

  const filePath = path.resolve(publicDir, `.${targetFile}`);
  const relativePath = path.relative(publicDir, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".pdf": "application/pdf",
    ".svg": "image/svg+xml",
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("File Not Found");
      } else {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, {
        "Content-Type": mimeTypes[ext] || "text/plain",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
      });
      res.end(content);
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n==========================================================`);
  console.log(` 🚀 FoodBridge AI Enterprise Server is LIVE on port ${PORT}`);
  console.log(` 🌐 Home Gateway:       http://localhost:${PORT}`);
  console.log(` 🏪 Donor Portal:       http://localhost:${PORT}/donor-login`);
  console.log(` 🏢 NGO Hub:            http://localhost:${PORT}/ngo-login`);
  console.log(` 🚴 Delivery Hub:       http://localhost:${PORT}/delivery-login`);
  console.log(` 🛡️ Admin Verification: http://localhost:${PORT}/admin-login`);
  console.log(`==========================================================\n`);
});
