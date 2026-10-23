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
let activeHandovers: Map<string, Handover> = new Map();
const deliveryProofs = new Map<string, { donationId: string; uploaderId: string; filePath: string }>();

// Secure Password Hasher (Node.js native scryptSync)
function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")): string {
  return `${salt}:${crypto.scryptSync(password, salt, 32).toString("hex")}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

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
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    organization: user.organization,
    phone: user.phone,
    avatar: user.avatar,
    verification: user.verification,
    isAvailable: user.isAvailable,
    ngoProfileId: user.ngoProfileId,
    capacity: user.capacity,
    freeCapacity: ngos.find((ngo) => ngo.id === user.ngoProfileId)?.freeCapacity,
    isDemo: Boolean(user.isDemo),
  };
}

// User Accounts Interface
export interface PlatformUser {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  name: string;
  organization?: string;
  phone: string;
  avatar: string;
  verification: VerifStatus;
  isAvailable: boolean; // For delivery partners
  licenseDoc?: string; // Uploaded registration / license document
  capacity?: number; // For NGOs
  vehicleType?: string; // For delivery couriers
  ngoProfileId?: string;
  isDemo?: boolean;
  createdAt: string;
}

// Initial Seed Users (Pre-populated for instant testing)
const initialUsers: PlatformUser[] = [
  // 1. Administrator (Never public registration!)
  {
    id: "USER-ADMIN-1",
    email: process.env.ADMIN_EMAIL || "admin@foodbridge.org",
    passwordHash: hashPassword(process.env.ADMIN_PASSWORD || "adminSecure2026!"),
    role: "ADMIN",
    name: "Dr. Arvind Rao",
    organization: "FoodBridge AI Governance Board",
    phone: "+91 824 2490001",
    avatar: "🛡️",
    verification: "APPROVED",
    isAvailable: true,
    createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
  },
  // 2. Verified Food Donor
  {
    id: "USER-DONOR-1",
    email: "donor@oceanpearl.com",
    passwordHash: hashPassword("password123"),
    role: "DONOR",
    name: "Vikram Shenoy",
    organization: "Ocean Pearl Banquets",
    phone: "+91 98450 12345",
    avatar: "👨‍🍳",
    verification: "APPROVED",
    isAvailable: true,
    createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
  },
  // 3. Pending Food Donor (Requires Admin Approval)
  {
    id: "USER-DONOR-PENDING",
    email: "donor.pending@kadri.com",
    passwordHash: hashPassword("password123"),
    role: "DONOR",
    name: "Anil Rao",
    organization: "Kadri Caterers (New Applicant)",
    phone: "+91 98450 22334",
    avatar: "🥘",
    verification: "PENDING",
    isAvailable: true,
    createdAt: new Date(Date.now() - 2 * 3600000).toISOString(),
  },
  // 4. Verified NGO
  {
    id: "USER-NGO-1",
    email: "ngo@sevatrust.org",
    passwordHash: hashPassword("password123"),
    role: "NGO",
    name: "Dr. Priya Kamath",
    organization: "Seva Trust Care Foundation",
    phone: "+91 98450 67890",
    avatar: "👩‍⚕️",
    verification: "APPROVED",
    capacity: 80,
    ngoProfileId: "NGO-SEVA-TRUST",
    licenseDoc: "uploads/documents/seva_trust_charity_license.pdf",
    isAvailable: true,
    createdAt: new Date(Date.now() - 15 * 86400000).toISOString(),
  },
  // 5. Pending NGO (Requires Admin Document Review & Approval)
  {
    id: "USER-NGO-PENDING",
    email: "ngo.pending@hope.org",
    passwordHash: hashPassword("password123"),
    role: "NGO",
    name: "Sister Mary D'Souza",
    organization: "Community Hope Kitchen (Pending Verification)",
    phone: "+91 98450 44556",
    avatar: "🏢",
    verification: "PENDING",
    capacity: 50,
    ngoProfileId: "NGO-COMMUNITY-HOPE",
    licenseDoc: "uploads/documents/community_hope_registration_certificate.png",
    isAvailable: true,
    createdAt: new Date(Date.now() - 4 * 3600000).toISOString(),
  },
  // 6. Verified Available Delivery Partner
  {
    id: "USER-VOL-1",
    email: "rider@foodbridge.org",
    passwordHash: hashPassword("password123"),
    role: "VOLUNTEER",
    name: "Rahul Kumar",
    organization: "Eco-Rescue Volunteer Fleet",
    phone: "+91 98450 99887",
    avatar: "🚴",
    verification: "APPROVED",
    vehicleType: "Electric Scooter",
    isAvailable: true, // Available
    createdAt: new Date(Date.now() - 8 * 86400000).toISOString(),
  },
  // 7. Verified Delivery Partner who is OFF DUTY
  {
    id: "USER-VOL-2",
    email: "rider.offduty@foodbridge.org",
    passwordHash: hashPassword("password123"),
    role: "VOLUNTEER",
    name: "Deepak Naik",
    organization: "Eco-Rescue Volunteer Fleet",
    phone: "+91 98450 77889",
    avatar: "🛵",
    verification: "APPROVED",
    vehicleType: "Motorcycle",
    isAvailable: false, // Off duty
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
  },
];

let users: PlatformUser[] = JSON.parse(JSON.stringify(initialUsers));

// Seed NGOs (Karnataka / Mangaluru demo locations)
const initialNgos: Ngo[] = [
  {
    id: "NGO-SEVA-TRUST",
    verified: true,
    location: { lat: 12.921, lng: 74.862 },
    freeCapacity: 80,
    acceptsCategories: ["cooked_meals", "packaged", "bakery"],
    excludedAllergens: [],
    maxKm: 12,
    isDemo: true,
  },
  {
    id: "NGO-KARUNA-MISSION",
    verified: true,
    location: { lat: 12.928, lng: 74.872 },
    freeCapacity: 120,
    acceptsCategories: ["cooked_meals", "produce"],
    excludedAllergens: [],
    maxKm: 15,
    isDemo: true,
  },
  {
    id: "NGO-CHILD-CARE",
    verified: true,
    location: { lat: 12.936, lng: 74.869 },
    freeCapacity: 25,
    acceptsCategories: ["cooked_meals", "bakery"],
    excludedAllergens: ["nuts"],
    maxKm: 6,
    isDemo: true,
  },
  {
    id: "NGO-COMMUNITY-HOPE",
    verified: false, // Unverified
    location: { lat: 12.918, lng: 74.858 },
    freeCapacity: 50,
    acceptsCategories: ["cooked_meals"],
    excludedAllergens: [],
    maxKm: 10,
    isDemo: true,
  },
];

let ngos: Ngo[] = JSON.parse(JSON.stringify(initialNgos));

// Seed Donations
export interface PlatformDonation extends Donation {
  title: string;
  donorId: string;
  donorName: string;
  status: "LISTED" | "RESERVED" | "ASSIGNED" | "PICKED_UP" | "DELIVERED" | "CANCELLED";
  handoverType: HandoverType;
  assignedNgoId?: string;
  collectorId?: string;
  deliveredQuantity?: number;
  photoUrl?: string;
  createdAt: number;
  isDemo?: boolean;
}

let donations: PlatformDonation[] = [];

// Seed initial notifications
interface AppNotification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: "info" | "success" | "warning";
  timestamp: string;
  read: boolean;
}

let notifications: AppNotification[] = [];

function pushNotification(userId: string, title: string, message: string, type: "info" | "success" | "warning" = "info") {
  notifications.unshift({
    id: `NOTIF-${Date.now()}-${Math.random().toString().slice(-4)}`,
    userId,
    title,
    message,
    type,
    timestamp: new Date().toISOString(),
    read: false,
  });
}

function resetSeedData() {
  const production = process.env.NODE_ENV === "production";
  globalLedger = new Ledger();
  activeHandovers.clear();
  deliveryProofs.clear();
  users = (production ? [initialUsers[0]] : initialUsers).map((user) => ({
    ...user,
    isDemo: !production,
  }));
  ngos = production ? [] : JSON.parse(JSON.stringify(initialNgos));
  notifications = [];
  donations = [];

  if (production) {
    globalLedger.append("SYSTEM_INITIALIZED", "GENESIS", {
      message: "FoodBridge AI started without demo users or demo listings",
    });
    return;
  }

  const now = Date.now();
  donations = [
    {
      id: "DON-101",
      title: "Fresh Biryani & Curry Trays",
      donorId: "USER-DONOR-1",
      donorName: "Ocean Pearl Banquets",
      quantity: 45,
      location: { lat: 12.9141, lng: 74.856 },
      deadline: now + 4 * 3.6e6,
      allergens: ["dairy"],
      storageOk: true,
      category: "cooked_meals",
      status: "LISTED",
      handoverType: "VOLUNTEER",
      createdAt: now - 30 * 60000,
      isDemo: true,
    },
    {
      id: "DON-102",
      title: "Assorted Artisan Bread & Pastries",
      donorId: "USER-DONOR-1",
      donorName: "Ocean Pearl Banquets",
      quantity: 30,
      location: { lat: 12.925, lng: 74.851 },
      deadline: now + 8 * 3.6e6,
      allergens: ["gluten"],
      storageOk: true,
      category: "bakery",
      status: "LISTED",
      handoverType: "VOLUNTEER",
      createdAt: now - 15 * 60000,
      isDemo: true,
    },
    {
      id: "DON-103",
      title: "Steamed Rice & Dal Sambar (Bulk)",
      donorId: "USER-DONOR-1",
      donorName: "Ocean Pearl Banquets",
      quantity: 60,
      location: { lat: 12.919, lng: 74.859 },
      deadline: now + 2.5 * 3.6e6,
      allergens: [],
      storageOk: true,
      category: "cooked_meals",
      status: "RESERVED",
      handoverType: "VOLUNTEER",
      assignedNgoId: "NGO-SEVA-TRUST",
      createdAt: now - 60 * 60000,
      isDemo: true,
    },
  ];

  // Initialize handover for DON-103
  const h = new Handover(
    "DON-103",
    "USER-DONOR-1",
    "USER-NGO-1",
    { lat: 12.921, lng: 74.862 },
    globalLedger,
    PEPPER
  );
  h.assignCollector("USER-VOL-1", "DEMO_SEED");
  donations[2].status = "ASSIGNED";
  donations[2].collectorId = "USER-VOL-1";
  users.find((u) => u.id === "USER-VOL-1")!.isAvailable = false;
  activeHandovers.set("DON-103", h);

  // Initial audit log
  globalLedger.append("SYSTEM_INITIALIZED", "GENESIS", {
    message: "FoodBridge AI Security Core Initialized",
    policy: "Strict Role-Based Admin Verification Enforced",
  });
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

// User extractor from Authorization header or session
function authenticateRequest(req: http.IncomingMessage): PlatformUser | null {
  const authHeader = req.headers.authorization;
  const cookie = req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("foodbridge_session="));
  const token = authHeader
    ? authHeader.replace(/^Bearer\s+/i, "")
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

      // If registered as NGO, also add to NGO candidate registry with pending status
      if (assignedRole === "NGO") {
        ngos.push({
          id: ngoProfileId!,
          verified: false, // NOT verified until admin approves
          location: { lat: body.lat, lng: body.lng },
          freeCapacity: newUser.capacity || 50,
          acceptsCategories: ["cooked_meals", "packaged", "bakery"],
          excludedAllergens: [],
          maxKm: 10,
          isDemo: false,
        });
      }

      // Log to cryptographic audit ledger
      globalLedger.append("USER_REGISTERED", newUserId, {
        role: assignedRole,
        name: newUser.name,
        organization: newUser.organization,
        verificationStatus: "PENDING",
      });

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
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          organization: user.organization,
          phone: user.phone,
          avatar: user.avatar,
          verification: user.verification,
          isAvailable: user.isAvailable,
        },
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

      // If this is an NGO, update its verified status in the matching candidate registry
      if (targetUser.role === "NGO") {
        matchingNgo!.verified = action === "APPROVE";
      }

      // Append to cryptographic audit ledger
      globalLedger.append(
        action === "APPROVE" ? "USER_VERIFIED" : "USER_REJECTED",
        targetUser.id,
        {
          targetUserId: targetUser.id,
          role: targetUser.role,
          approvedBy: user.name,
          reason: reason || (action === "APPROVE" ? "Documents & eligibility verified" : "Application declined"),
        }
      );

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
        organization: u.organization,
        role: u.role,
        verification: u.verification,
        isAvailable: u.isAvailable,
        hasLicenseDoc: Boolean(u.licenseDoc),
        capacity: u.capacity,
        vehicleType: u.vehicleType,
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

      // Log to audit ledger
      globalLedger.append("VOLUNTEER_AVAILABILITY_CHANGED", targetUser.id, {
        courier: targetUser.name,
        isAvailable,
        status: isAvailable ? "AVAILABLE" : "OFF_DUTY",
      });

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
    let visibleDonations = donations.filter((donation) => donation.status === "LISTED");
    if (user?.role === "DONOR") {
      visibleDonations = donations.filter((donation) => donation.donorId === user.id);
    } else if (user?.role === "NGO") {
      visibleDonations = donations.filter(
        (donation) => donation.status === "LISTED" || donation.assignedNgoId === user.ngoProfileId
      );
    } else if (user?.role === "VOLUNTEER") {
      visibleDonations = donations.filter((donation) => donation.collectorId === user.id);
    } else if (user?.role === "ADMIN") {
      visibleDonations = donations;
    }
    const canSeeExactLocation =
      user?.role === "ADMIN" ||
      (user?.role === "DONOR" && user.verification === "APPROVED") ||
      (user?.role === "NGO" && user.verification === "APPROVED") ||
      (user?.role === "VOLUNTEER" && user.verification === "APPROVED");
    sendJson(res, 200, {
      donations: visibleDonations.map((donation) => canSeeExactLocation
        ? donation
        : {
            ...donation,
            location: {
              lat: Math.round(donation.location.lat * 100) / 100,
              lng: Math.round(donation.location.lng * 100) / 100,
            },
          }),
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
        sendJson(res, 400, { error: "Enter a title, valid quantity, deadline, location, allergens, and verified storage status." });
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

      globalLedger.append("DONATION_LISTED", id, {
        donorId: donor.id,
        donorName: newDonation.donorName,
        quantity: newDonation.quantity,
        category: newDonation.category,
      });
      for (const recipient of users.filter((candidate) => candidate.role === "NGO" && candidate.verification === "APPROVED")) {
        pushNotification(recipient.id, "New Food Listing", `${newDonation.title} is available for safety and eligibility matching.`, "info");
      }

      sendJson(res, 201, { success: true, donation: newDonation });
    } catch (err: any) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // ==========================================
  // 5. MATCHING & RESERVATION (With NGO Self-Pickup)
  // ==========================================

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

      sendJson(res, 200, {
        donation: targetDonation,
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

      const targetNgo = ngos.find((n) => n.id === ngoUser.ngoProfileId);
      if (!targetNgo || !targetNgo.verified || targetNgo.id !== ngoId) {
        sendJson(res, 403, { error: "Reservation must use the authenticated NGO's verified profile." });
        return;
      }
      const eligibility = eligible(don, [targetNgo]);
      if (!eligibility.ok.length) {
        sendJson(res, 409, {
          error: "This donation is not eligible for your organization.",
          reason: eligibility.donationBlocked || eligibility.rejected[0]?.reason,
        });
        return;
      }

      // Check available delivery couriers
      const availableCouriers = users.filter(
        (u) => u.role === "VOLUNTEER" && u.verification === "APPROVED" && u.isAvailable === true
      );

      // If user requested volunteer, but NO delivery partner is available:
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
      targetNgo.freeCapacity -= don.quantity;

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
        pushNotification(don.donorId, "NGO Self-Pickup Arranged", `${ngoUser.organization || ngoUser.name} will pick up ${don.title} directly.`, "info");
      } else {
        // Assign first available verified courier
        const assignedCourier = availableCouriers[0];
        handover.assignCollector(assignedCourier.id, "DISPATCH-AI-AUTO");
        don.status = "ASSIGNED";
        don.collectorId = assignedCourier.id;
        assignedCourier.isAvailable = false;
        pushNotification(assignedCourier.id, "New Rescue Mission", `Deliver ${don.title} from ${don.donorName} to ${targetNgo.id}.`, "info");
        pushNotification(don.donorId, "Delivery Partner Assigned", `A verified partner has been assigned to ${don.title}.`, "info");
      }
      pushNotification(ngoUser.id, "Reservation Confirmed", `${don.title} is assigned for ${handoverType === "NGO_SELF_PICKUP" ? "NGO Self-Pickup" : "verified delivery dispatch"}.`, "success");

      activeHandovers.set(don.id, handover);

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
      if (
        !user ||
        user.id !== handover.collectorId ||
        (isSelfPickup
          ? user.role !== "NGO" || user.verification !== "APPROVED"
          : user.role !== "VOLUNTEER" || user.verification !== "APPROVED")
      ) {
        sendJson(res, 403, { error: "Only the assigned, verified pickup partner can confirm pickup." });
        return;
      }
      const result = handover.confirmPickup(user.id, code);

      if (result === "OK") {
        don.status = "PICKED_UP";
        pushNotification(don.donorId, "Pickup Confirmed", `${don.title} has been collected.`, "success");
        pushNotification(handover.ngoRepId, "Pickup Confirmed", `${don.title} has been collected and is ready for handover confirmation.`, "success");
        globalLedger.append("DONATION_PICKED_UP", don.id, { collectorId: user.id, handoverType: handover.handoverType });
      }

      sendJson(res, 200, {
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
      if (
        !user ||
        user.id !== handover.collectorId ||
        (selfPickup
          ? user.role !== "NGO" || user.verification !== "APPROVED"
          : user.role !== "VOLUNTEER" || user.verification !== "APPROVED")
      ) {
        sendJson(res, 403, { error: "Only the assigned, verified delivery partner can complete the handover." });
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
        collectorId: user.id,
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
        if (assignedUser?.role === "VOLUNTEER") assignedUser.isAvailable = true;
        pushNotification(don.donorId, "Food Delivered", `${quantityReceived} of ${don.quantity} portions from ${don.title} were confirmed received.`, "success");
        pushNotification(handover.ngoRepId, "Handover Complete", `${don.title} was received and confirmed.`, "success");
      }

      sendJson(res, 200, {
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
      demoMode: process.env.NODE_ENV !== "production",
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
    const userNotifs = notifications.filter((n) => n.userId === authUser.id);
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
  else if (targetFile === "/ngo") targetFile = "/ngo.html";
  else if (targetFile === "/ngo-login") targetFile = "/ngo-login.html";
  else if (targetFile === "/delivery" || targetFile === "/volunteer") targetFile = "/delivery.html";
  else if (targetFile === "/delivery-login" || targetFile === "/volunteer-login") targetFile = "/delivery-login.html";
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
      res.writeHead(200, { "Content-Type": mimeTypes[ext] || "text/plain" });
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
