/**
 * FoodBridge AI — Enterprise MongoDB Database Service Layer
 * Seamless MongoDB persistence with dataset auto-seeding across Karnataka's 31 districts.
 * Supports transparent in-memory fallback for offline test environments.
 */

import { MongoClient, type Db, type Collection } from "mongodb";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import type { Donation, Ngo, Role, VerifStatus, HandoverType, LedgerEvent, Pt } from "./types.ts";
import { Ledger } from "./ledger.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(path.dirname(__dirname), "data");

export interface PlatformUser {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  name: string;
  nameKn?: string;
  organization?: string;
  orgNameKn?: string;
  phone: string;
  avatar: string;
  verification: VerifStatus;
  isAvailable: boolean;
  licenseDoc?: string;
  capacity?: number;
  vehicleType?: string;
  ngoProfileId?: string;
  isDemo?: boolean;
  district?: string;
  division?: string;
  city?: string;
  address?: string;
  createdAt: string;
}

export interface PlatformDonation extends Donation {
  title: string;
  titleKn?: string;
  donorId: string;
  donorName: string;
  donorOrgKn?: string;
  pickupAddress: string;
  status: "LISTED" | "REQUESTED" | "RESERVED" | "ASSIGNED" | "PICKED_UP" | "DELIVERED" | "CANCELLED";
  handoverType: HandoverType;
  assignedNgoId?: string;
  collectorId?: string;
  deliveredQuantity?: number;
  requestedQuantity?: number;
  requestedByNgoId?: string;
  requestedByNgoName?: string;
  requestedHandoverType?: HandoverType;
  feedback?: {
    rating: number;
    temperatureCondition?: string;
    freshnessRating?: string;
    packagingCondition?: string;
    comments?: string;
    submittedAt?: string;
  };
  photoUrl?: string;
  createdAt: number;
  isDemo?: boolean;
  district?: string;
  city?: string;
  division?: string;
  quantityKg?: number;
  shelfLifeHours?: number;
  urgencyLevel?: string;
  storageCondition?: string;
  temperatureCelsius?: number;
  dietaryType?: string;
  packagingType?: string;
}

export interface DistrictRecord {
  district: string;
  division: string;
  headquarters: string;
  lat: number;
  lng: number;
  donorsCount?: number;
  ngosCount?: number;
  volunteersCount?: number;
  donationsCount?: number;
}

export interface VolunteerRecord {
  id: string;
  name: string;
  nameKn?: string;
  district: string;
  division: string;
  city: string;
  address: string;
  latitude: number;
  longitude: number;
  phone: string;
  email: string;
  vehicleType: string;
  isAvailable: boolean;
  coverageRadiusKm: number;
  regNumber: string;
  verificationStatus: string;
}

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: "info" | "success" | "warning";
  timestamp: string;
  read: boolean;
}

// Password hashing helper
export function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")): string {
  return `${salt}:${crypto.scryptSync(password, salt, 32).toString("hex")}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

// Internal State
let mongoClient: MongoClient | null = null;
let mongoDb: Db | null = null;
let isConnected = false;

// In-Memory mirrors (acts as primary if mongo is offline, or as reactive cache)
let memUsers: PlatformUser[] = [];
let memDonations: PlatformDonation[] = [];
let memNgos: Ngo[] = [];
let memVolunteers: VolunteerRecord[] = [];
let memDistricts: DistrictRecord[] = [];
let memLedger: LedgerEvent[] = [];
let memNotifications: AppNotification[] = [];
const memHandovers: Map<string, any> = new Map();

/**
 * Initializes the MongoDB database and seeds the Karnataka datasets.
 */
export async function initDb(): Promise<{ connected: boolean; source: "mongodb" | "memory" }> {
  const isTest = process.env.NODE_ENV === "test";
  const dbName = isTest ? "foodbridge_test" : (process.env.MONGODB_DB || "foodbridge");
  const uri = process.env.MONGODB_URI || `mongodb://127.0.0.1:27017/${dbName}`;

  try {
    mongoClient = new MongoClient(uri, { serverSelectionTimeoutMS: 2500 });
    await mongoClient.connect();
    mongoDb = mongoClient.db(dbName);
    isConnected = true;
    console.log(`[Database] Connected to MongoDB at ${uri.replace(/\/\/.*@/, "//***@")} (DB: ${dbName})`);

    // Create indexes
    await ensureIndexes(mongoDb);

    // Seed database if needed
    await seedMongoDatabase(mongoDb);

    // Sync in-memory cache from MongoDB
    await refreshMemoryFromMongo(mongoDb);

    return { connected: true, source: "mongodb" };
  } catch (err: any) {
    console.warn(`[Database] MongoDB not reachable (${err.message}). Using in-memory dataset mode.`);
    isConnected = false;
    seedMemoryDatabase();
    return { connected: false, source: "memory" };
  }
}

export function isMongoConnected(): boolean {
  return isConnected;
}

export function getDb(): Db | null {
  return mongoDb;
}

/**
 * Ensures indexes exist on collections
 */
async function ensureIndexes(db: Db): Promise<void> {
  try {
    await db.collection("users").createIndex({ email: 1 }, { unique: true });
    await db.collection("users").createIndex({ role: 1 });
    await db.collection("users").createIndex({ verification: 1 });

    await db.collection("donations").createIndex({ id: 1 }, { unique: true });
    await db.collection("donations").createIndex({ status: 1 });
    await db.collection("donations").createIndex({ district: 1 });
    await db.collection("donations").createIndex({ donorId: 1 });
    await db.collection("donations").createIndex({ assignedNgoId: 1 });

    await db.collection("ngos").createIndex({ id: 1 }, { unique: true });
    await db.collection("ngos").createIndex({ district: 1 });

    await db.collection("volunteers").createIndex({ id: 1 }, { unique: true });
    await db.collection("volunteers").createIndex({ district: 1 });

    await db.collection("districts").createIndex({ district: 1 }, { unique: true });
    await db.collection("ledger").createIndex({ id: 1 }, { unique: true });
  } catch (err: any) {
    console.warn("[Database] Index creation note:", err.message);
  }
}

/**
 * Reads the Karnataka dataset files from /data
 */
function loadDatasetFiles() {
  const datasetFile = path.join(DATA_DIR, "karnataka_complete_dataset.json");
  if (fs.existsSync(datasetFile)) {
    try {
      return JSON.parse(fs.readFileSync(datasetFile, "utf8"));
    } catch (e) {
      console.warn("[Database] Failed to parse karnataka_complete_dataset.json:", e);
    }
  }

  // Fallback to individual files if complete file is missing
  const districts = fs.existsSync(path.join(DATA_DIR, "karnataka_districts.json"))
    ? JSON.parse(fs.readFileSync(path.join(DATA_DIR, "karnataka_districts.json"), "utf8"))
    : [];
  const donors = fs.existsSync(path.join(DATA_DIR, "karnataka_donors.json"))
    ? JSON.parse(fs.readFileSync(path.join(DATA_DIR, "karnataka_donors.json"), "utf8"))
    : [];
  const ngos = fs.existsSync(path.join(DATA_DIR, "karnataka_ngos.json"))
    ? JSON.parse(fs.readFileSync(path.join(DATA_DIR, "karnataka_ngos.json"), "utf8"))
    : [];
  const volunteers = fs.existsSync(path.join(DATA_DIR, "karnataka_volunteers.json"))
    ? JSON.parse(fs.readFileSync(path.join(DATA_DIR, "karnataka_volunteers.json"), "utf8"))
    : [];
  const donations = fs.existsSync(path.join(DATA_DIR, "karnataka_donations.json"))
    ? JSON.parse(fs.readFileSync(path.join(DATA_DIR, "karnataka_donations.json"), "utf8"))
    : [];

  return { districts, donors, ngos, volunteers, donations };
}

/**
 * Builds the initial seed users, NGOs, and donations
 */
function buildSeedData() {
  const dataset = loadDatasetFiles();
  const defaultPasswordHash = hashPassword("password123");
  const now = Date.now();

  // 1. Initial Core Users
  const initialUsers: PlatformUser[] = [
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
      createdAt: new Date(now - 30 * 86400000).toISOString(),
    },
    {
      id: "USER-DONOR-1",
      email: "donor@oceanpearl.com",
      passwordHash: defaultPasswordHash,
      role: "DONOR",
      name: "Vikram Shenoy",
      organization: "Ocean Pearl Banquets",
      phone: "+91 98450 12345",
      avatar: "👨‍🍳",
      verification: "APPROVED",
      isAvailable: true,
      district: "Dakshina Kannada",
      city: "Mangaluru",
      createdAt: new Date(now - 10 * 86400000).toISOString(),
    },
    {
      id: "USER-DONOR-PENDING",
      email: "donor.pending@kadri.com",
      passwordHash: defaultPasswordHash,
      role: "DONOR",
      name: "Anil Rao",
      organization: "Kadri Caterers (New Applicant)",
      phone: "+91 98450 22334",
      avatar: "🥘",
      verification: "PENDING",
      isAvailable: true,
      district: "Dakshina Kannada",
      city: "Mangaluru",
      createdAt: new Date(now - 2 * 3600000).toISOString(),
    },
    {
      id: "USER-NGO-1",
      email: "ngo@sevatrust.org",
      passwordHash: defaultPasswordHash,
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
      district: "Dakshina Kannada",
      city: "Mangaluru",
      createdAt: new Date(now - 15 * 86400000).toISOString(),
    },
    {
      id: "USER-NGO-PENDING",
      email: "ngo.pending@hope.org",
      passwordHash: defaultPasswordHash,
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
      district: "Dakshina Kannada",
      city: "Mangaluru",
      createdAt: new Date(now - 4 * 3600000).toISOString(),
    },
    {
      id: "USER-VOL-1",
      email: "rider@foodbridge.org",
      passwordHash: defaultPasswordHash,
      role: "VOLUNTEER",
      name: "Rahul Kumar",
      organization: "Eco-Rescue Volunteer Fleet",
      phone: "+91 98450 99887",
      avatar: "🚴",
      verification: "APPROVED",
      vehicleType: "Electric Scooter",
      isAvailable: true,
      district: "Dakshina Kannada",
      city: "Mangaluru",
      createdAt: new Date(now - 8 * 86400000).toISOString(),
    },
    {
      id: "USER-VOL-2",
      email: "rider.offduty@foodbridge.org",
      passwordHash: defaultPasswordHash,
      role: "VOLUNTEER",
      name: "Deepak Naik",
      organization: "Eco-Rescue Volunteer Fleet",
      phone: "+91 98450 77889",
      avatar: "🛵",
      verification: "APPROVED",
      vehicleType: "Motorcycle",
      isAvailable: false,
      district: "Dakshina Kannada",
      city: "Mangaluru",
      createdAt: new Date(now - 5 * 86400000).toISOString(),
    },
  ];

  // 2. Initial Core NGOs
  const initialNgos: (Ngo & { orgName?: string; orgNameKn?: string; district?: string })[] = [
    {
      id: "NGO-SEVA-TRUST",
      verified: true,
      location: { lat: 12.921, lng: 74.862 },
      freeCapacity: 80,
      acceptsCategories: ["cooked_meals", "packaged", "bakery"],
      excludedAllergens: [],
      maxKm: 12,
      isDemo: true,
      orgName: "Seva Trust Care Foundation",
      orgNameKn: "ಸೇವಾ ಟ್ರಸ್ಟ್ ಕೇರ್ ಫೌಂಡೇಶನ್",
      district: "Dakshina Kannada",
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
      orgName: "Karuna Ashrama Feeding Mission",
      orgNameKn: "ಕರುಣಾ ಆಶ್ರಮ ಆಹಾರ ಮಿಷನ್",
      district: "Dakshina Kannada",
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
      orgName: "Mangaluru Child Care Shelter",
      orgNameKn: "ಮಂಗಳೂರು ಮಕ್ಕಳ ಆರೈಕೆ ಆಶ್ರಯ",
      district: "Dakshina Kannada",
    },
    {
      id: "NGO-COMMUNITY-HOPE",
      verified: false,
      location: { lat: 12.918, lng: 74.858 },
      freeCapacity: 50,
      acceptsCategories: ["cooked_meals"],
      excludedAllergens: [],
      maxKm: 10,
      isDemo: true,
      orgName: "Community Hope Kitchen",
      orgNameKn: "ಕಮ್ಯುನಿಟಿ ಹೋಪ್ ಕಿಚನ್",
      district: "Dakshina Kannada",
    },
  ];

  // 3. Initial Core Donations
  const initialDonations: PlatformDonation[] = [
    {
      id: "DON-100",
      title: "Rice & Sambar",
      titleKn: "ಅನ್ನ ಮತ್ತು ಸಾಂಬಾರ್",
      donorId: "USER-DONOR-1",
      donorName: "Ocean Pearl Banquets",
      donorOrgKn: "ಓಷಿಯನ್ ಪರ್ಲ್ ಬ್ಯಾಂಕ್ವೆಟ್ಸ್",
      pickupAddress: "Kodialbail, Mangaluru",
      quantity: 60,
      quantityKg: 20,
      location: { lat: 12.875, lng: 74.845 },
      deadline: now + 2 * 3.6e6,
      allergens: [],
      storageOk: true,
      category: "cooked_meals",
      status: "LISTED",
      handoverType: "VOLUNTEER",
      district: "Dakshina Kannada",
      city: "Mangaluru",
      createdAt: now - 10 * 60000,
      isDemo: true,
    },
    {
      id: "DON-104",
      title: "Breakfast Dosa & Sambar",
      titleKn: "ಉಪಾಹಾರ ದೋಸೆ ಮತ್ತು ಸಾಂಬಾರ್",
      donorId: "USER-DONOR-1",
      donorName: "Ocean Pearl Banquets",
      donorOrgKn: "ಓಷಿಯನ್ ಪರ್ಲ್ ಬ್ಯಾಂಕ್ವೆಟ್ಸ್",
      pickupAddress: "Kodialbail, Mangaluru",
      quantity: 35,
      quantityKg: 12,
      location: { lat: 12.878, lng: 74.843 },
      deadline: now + 3 * 3.6e6,
      allergens: [],
      storageOk: true,
      category: "breakfast",
      status: "LISTED",
      handoverType: "VOLUNTEER",
      district: "Dakshina Kannada",
      city: "Mangaluru",
      createdAt: now - 20 * 60000,
      isDemo: true,
    },
    {
      id: "DON-101",
      title: "Biryani & Kheer",
      titleKn: "ಬಿರಿಯಾನಿ ಮತ್ತು ಖೀರ್",
      donorId: "USER-DONOR-1",
      donorName: "Ocean Pearl Banquets",
      donorOrgKn: "ಓಷಿಯನ್ ಪರ್ಲ್ ಬ್ಯಾಂಕ್ವೆಟ್ಸ್",
      pickupAddress: "Kodialbail, Mangaluru",
      quantity: 45,
      quantityKg: 16,
      location: { lat: 12.9141, lng: 74.856 },
      deadline: now + 4 * 3.6e6,
      allergens: ["dairy"],
      storageOk: true,
      category: "feast",
      status: "LISTED",
      handoverType: "VOLUNTEER",
      district: "Dakshina Kannada",
      city: "Mangaluru",
      createdAt: now - 30 * 60000,
      isDemo: true,
    },
    {
      id: "DON-102",
      title: "Assorted Artisan Bread & Pastries",
      titleKn: "ವಿವಿಧ ರೀತಿಯ ಬ್ರೆಡ್ ಮತ್ತು ಪೇಸ್ಟ್ರಿಗಳು",
      donorId: "USER-DONOR-1",
      donorName: "Ocean Pearl Banquets",
      donorOrgKn: "ಓಷಿಯನ್ ಪರ್ಲ್ ಬ್ಯಾಂಕ್ವೆಟ್ಸ್",
      pickupAddress: "Demo pickup location, Mangaluru",
      quantity: 30,
      quantityKg: 10,
      location: { lat: 12.925, lng: 74.851 },
      deadline: now + 8 * 3.6e6,
      allergens: ["gluten"],
      storageOk: true,
      category: "bakery",
      status: "LISTED",
      handoverType: "VOLUNTEER",
      district: "Dakshina Kannada",
      city: "Mangaluru",
      createdAt: now - 15 * 60000,
      isDemo: true,
    },
    {
      id: "DON-103",
      title: "Steamed Rice & Dal Sambar (Bulk)",
      titleKn: "ಅನ್ನ ಮತ್ತು ಬಿಸಿ ಬೇಳೆ ಸಾಂಬಾರ್ (ದೊಡ್ಡ ಪ್ರಮಾಣ)",
      donorId: "USER-DONOR-1",
      donorName: "Ocean Pearl Banquets",
      donorOrgKn: "ಓಷಿಯನ್ ಪರ್ಲ್ ಬ್ಯಾಂಕ್ವೆಟ್ಸ್",
      pickupAddress: "Demo pickup location, Mangaluru",
      quantity: 60,
      quantityKg: 22,
      location: { lat: 12.919, lng: 74.859 },
      deadline: now + 2.5 * 3.6e6,
      allergens: [],
      storageOk: true,
      category: "cooked_meals",
      status: "ASSIGNED",
      handoverType: "VOLUNTEER",
      assignedNgoId: "NGO-SEVA-TRUST",
      collectorId: "USER-VOL-1",
      district: "Dakshina Kannada",
      city: "Mangaluru",
      createdAt: now - 60 * 60000,
      isDemo: true,
    },
  ];

  // Helper Maps for linking
  const existingEmails = new Set(initialUsers.map((u) => u.email));
  const ngoByDistrict: Record<string, any[]> = {};
  const volByDistrict: Record<string, any[]> = {};

  // Process Karnataka Donors -> Users
  (dataset.donors || []).forEach((d: any) => {
    if (!existingEmails.has(d.email)) {
      existingEmails.add(d.email);
      initialUsers.push({
        id: d.id,
        email: d.email,
        passwordHash: defaultPasswordHash,
        role: "DONOR",
        name: d.contactPerson || d.name,
        nameKn: d.nameKn,
        organization: d.orgName,
        orgNameKn: d.orgNameKn,
        phone: d.phone,
        avatar: "🏪",
        verification: d.verificationStatus || "APPROVED",
        isAvailable: true,
        district: d.district,
        division: d.division,
        city: d.city,
        address: d.address,
        createdAt: new Date(now - 12 * 86400000).toISOString(),
      });
    }
  });

  // Process Karnataka NGOs -> Users & NGO Profiles
  (dataset.ngos || []).forEach((n: any) => {
    if (!ngoByDistrict[n.district]) ngoByDistrict[n.district] = [];
    ngoByDistrict[n.district].push(n);

    if (!existingEmails.has(n.email)) {
      existingEmails.add(n.email);
      initialUsers.push({
        id: `USER-${n.id}`,
        email: n.email,
        passwordHash: defaultPasswordHash,
        role: "NGO",
        name: n.contactPerson || n.name,
        nameKn: n.nameKn,
        organization: n.orgName,
        orgNameKn: n.orgNameKn,
        phone: n.phone,
        avatar: "🏢",
        verification: n.verificationStatus || "APPROVED",
        capacity: n.capacityDailyMeals,
        ngoProfileId: n.id,
        district: n.district,
        division: n.division,
        city: n.city,
        address: n.address,
        isAvailable: true,
        createdAt: new Date(now - 18 * 86400000).toISOString(),
      });
    }

    initialNgos.push({
      id: n.id,
      verified: n.verificationStatus === "APPROVED",
      location: { lat: n.latitude, lng: n.longitude },
      freeCapacity: n.capacityDailyMeals || 100,
      acceptsCategories: ["cooked_meals", "bakery", "packaged", "produce"],
      excludedAllergens: [],
      maxKm: 15,
      orgName: n.orgName,
      orgNameKn: n.orgNameKn,
      district: n.district,
    });
  });

  // Process Karnataka Volunteers -> Users & Volunteer Records
  const allVolunteers: VolunteerRecord[] = [
    {
      id: "USER-VOL-1",
      name: "Rahul Kumar",
      nameKn: "ರಾಹುಲ್ ಕುಮಾರ್",
      district: "Dakshina Kannada",
      division: "Mysuru",
      city: "Mangaluru",
      address: "Hampankatta, Mangaluru",
      latitude: 12.87,
      longitude: 74.84,
      phone: "+91 98450 99887",
      email: "rider@foodbridge.org",
      vehicleType: "Electric Scooter",
      isAvailable: true,
      coverageRadiusKm: 15,
      regNumber: "VOL-KA-DK-001",
      verificationStatus: "APPROVED",
    },
  ];

  (dataset.volunteers || []).forEach((v: any) => {
    if (!volByDistrict[v.district]) volByDistrict[v.district] = [];
    volByDistrict[v.district].push(v);

    if (!existingEmails.has(v.email)) {
      existingEmails.add(v.email);
      initialUsers.push({
        id: v.id,
        email: v.email,
        passwordHash: defaultPasswordHash,
        role: "VOLUNTEER",
        name: v.name,
        nameKn: v.nameKn,
        organization: `${v.district} Food Rescue Fleet`,
        phone: v.phone,
        avatar: "🚴",
        verification: v.verificationStatus || "APPROVED",
        isAvailable: false,
        vehicleType: v.vehicleType,
        district: v.district,
        division: v.division,
        city: v.city,
        address: v.address,
        createdAt: new Date(now - 14 * 86400000).toISOString(),
      });
    }

    allVolunteers.push({
      id: v.id,
      name: v.name,
      nameKn: v.nameKn,
      district: v.district,
      division: v.division,
      city: v.city,
      address: v.address,
      latitude: v.latitude,
      longitude: v.longitude,
      phone: v.phone,
      email: v.email,
      vehicleType: v.vehicleType,
      isAvailable: false,
      coverageRadiusKm: v.coverageRadiusKm || 12,
      regNumber: v.regNumber,
      verificationStatus: v.verificationStatus || "APPROVED",
    });
  });

  // Process Karnataka Donations -> PlatformDonations
  (dataset.donations || []).forEach((d: any, idx: number) => {
    let status: PlatformDonation["status"] = "LISTED";
    if (d.status === "RESERVED") status = "RESERVED";
    else if (d.status === "PICKED_UP") status = "PICKED_UP";
    else if (d.status === "DELIVERED") status = "DELIVERED";

    // Link assigned NGO and Collector from the same district if reserved/in transit
    let assignedNgoId: string | undefined = undefined;
    let collectorId: string | undefined = undefined;
    let deliveredQuantity: number | undefined = undefined;
    let photoUrl: string | undefined = undefined;

    const districtNgos = ngoByDistrict[d.district] || [];
    const districtVols = volByDistrict[d.district] || [];

    if (status !== "LISTED") {
      assignedNgoId = districtNgos[0]?.id || "NGO-SEVA-TRUST";
    }

    if (status === "PICKED_UP" || status === "DELIVERED") {
      collectorId = districtVols[0]?.id || "USER-VOL-1";
    }

    if (status === "DELIVERED") {
      deliveredQuantity = d.quantityServings || 50;
      photoUrl = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="280" viewBox="0 0 400 280"><rect width="400" height="280" fill="%231b4332"/><text x="50%" y="42%" text-anchor="middle" fill="%2310b981" font-size="20" font-family="sans-serif" font-weight="bold">Verified Delivery Handover</text><text x="50%" y="58%" text-anchor="middle" fill="%23f4efe4" font-size="14" font-family="sans-serif">${encodeURIComponent(d.district)} Shelter Handover</text><text x="50%" y="72%" text-anchor="middle" fill="%2334d399" font-size="12" font-family="monospace">SHA-256 Verified</text></svg>`;
    }

    const catNormalized = (d.category || "cooked_meals").toLowerCase().replace("-", "_");
    const category =
      catNormalized.includes("bake") ? "bakery" :
      catNormalized.includes("produce") ? "produce" :
      catNormalized.includes("package") ? "packaged" : "cooked_meals";

    const allergensList =
      !d.allergens || d.allergens.toLowerCase() === "none"
        ? []
        : d.allergens.toLowerCase().split(",").map((s: string) => s.trim());

    initialDonations.push({
      id: d.id,
      title: d.title,
      titleKn: d.titleKn,
      donorId: d.donorId,
      donorName: d.donorOrg,
      pickupAddress: d.pickupAddress,
      quantity: d.quantityServings || 40,
      quantityKg: d.quantityKg || 15,
      location: { lat: d.pickupLat, lng: d.pickupLng },
      deadline: now + (d.shelfLifeHours || 4) * 3.6e6,
      allergens: allergensList,
      storageOk: true,
      category,
      status,
      handoverType: "VOLUNTEER",
      assignedNgoId,
      collectorId,
      deliveredQuantity,
      photoUrl,
      district: d.district,
      city: d.city,
      shelfLifeHours: d.shelfLifeHours,
      urgencyLevel: d.urgencyLevel,
      storageCondition: d.storageCondition,
      temperatureCelsius: d.temperatureCelsius,
      dietaryType: d.dietaryType,
      packagingType: d.packagingType,
      createdAt: now - (idx + 1) * 25 * 60000,
      isDemo: true,
    });
  });

  // 4. Districts
  const districts: DistrictRecord[] = (dataset.districts || []).map((dst: any) => ({
    district: dst.district,
    division: dst.division,
    headquarters: dst.headquarters,
    lat: dst.lat,
    lng: dst.lng,
  }));

  return {
    users: initialUsers,
    ngos: initialNgos,
    donations: initialDonations,
    volunteers: allVolunteers,
    districts,
  };
}

/**
 * Seeds MongoDB with the complete Karnataka dataset if empty
 */
async function seedMongoDatabase(db: Db): Promise<void> {
  const isTest = process.env.NODE_ENV === "test";

  if (!isTest) {
    const usersCount = await db.collection("users").countDocuments();
    const donationsCount = await db.collection("donations").countDocuments();

    if (usersCount >= 20 && donationsCount >= 10) {
      console.log(`[Database] MongoDB already populated (${usersCount} users, ${donationsCount} donations).`);
      return;
    }
  }

  console.log("[Database] Seeding MongoDB with Karnataka Statewide Rescue Datasets...");
  const seed = buildSeedData();

  // Clear existing if re-seeding or in test mode
  await db.collection("users").deleteMany({});
  await db.collection("ngos").deleteMany({});
  await db.collection("donations").deleteMany({});
  await db.collection("volunteers").deleteMany({});
  await db.collection("districts").deleteMany({});
  await db.collection("ledger").deleteMany({});
  await db.collection("notifications").deleteMany({});

  if (seed.users.length) await db.collection("users").insertMany(seed.users as any);
  if (seed.ngos.length) await db.collection("ngos").insertMany(seed.ngos as any);
  if (seed.donations.length) await db.collection("donations").insertMany(seed.donations as any);
  if (seed.volunteers.length) await db.collection("volunteers").insertMany(seed.volunteers as any);
  if (seed.districts.length) await db.collection("districts").insertMany(seed.districts as any);

  // Check ledger genesis
  const ledgerCount = await db.collection("ledger").countDocuments();
  if (ledgerCount === 0) {
    const seedLedger = new Ledger();
    const genesisEvent = seedLedger.append("SYSTEM_INITIALIZED", "GENESIS", {
      message: "FoodBridge AI Karnataka Statewide Food Rescue Network Initialized"
    });
    await db.collection("ledger").insertOne(genesisEvent as any);
  }

  console.log(`[Database] Seeding complete! Inserted ${seed.users.length} users, ${seed.ngos.length} NGOs, ${seed.volunteers.length} volunteers, ${seed.donations.length} donations, and ${seed.districts.length} districts.`);
}

/**
 * Initializes in-memory storage fallback
 */
function seedMemoryDatabase(): void {
  const seed = buildSeedData();
  memUsers = seed.users;
  memNgos = seed.ngos;
  memDonations = seed.donations;
  memVolunteers = seed.volunteers;
  memDistricts = seed.districts;
  memLedger = [
    {
      id: 1,
      type: "SYSTEM_INITIALIZED",
      donationId: "GENESIS",
      payload: { message: "FoodBridge AI Karnataka Statewide Food Rescue Network Initialized" },
      ts: new Date().toISOString(),
      prevHash: "0".repeat(64),
      hash: "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f",
    },
  ];
  console.log(`[Database] In-memory dataset ready with ${memUsers.length} users, ${memNgos.length} NGOs, ${memDonations.length} donations.`);
}

/**
 * Syncs in-memory cache from MongoDB
 */
async function refreshMemoryFromMongo(db: Db): Promise<void> {
  try {
    memUsers = (await db.collection("users").find({}).toArray()) as any[];
    memDonations = (await db.collection("donations").find({}).toArray()) as any[];
    memNgos = (await db.collection("ngos").find({}).toArray()) as any[];
    memVolunteers = (await db.collection("volunteers").find({}).toArray()) as any[];
    memDistricts = (await db.collection("districts").find({}).toArray()) as any[];
    memLedger = (await db.collection("ledger").find({}).sort({ id: 1 }).toArray()) as any[];
    memNotifications = (await db.collection("notifications").find({}).toArray()) as any[];
  } catch (err: any) {
    console.warn("[Database] Cache refresh note:", err.message);
  }
}

// ============================================================================
// CRUD Repository Methods (Persists to MongoDB & Syncs In-Memory)
// ============================================================================

// --- Synchronous In-Memory Lookups (100% Mirror) ---
export function listAllUsersSync(): PlatformUser[] {
  return memUsers;
}

export function findUserByIdSync(id: string): PlatformUser | null {
  return memUsers.find((u) => u.id === id) || null;
}

export function findUserByEmailSync(email: string): PlatformUser | null {
  const normEmail = email.toLowerCase().trim();
  return memUsers.find((u) => u.email.toLowerCase() === normEmail) || null;
}

export function listAllDonationsSync(): PlatformDonation[] {
  return memDonations;
}

export function findDonationByIdSync(id: string): PlatformDonation | null {
  return memDonations.find((d) => d.id === id) || null;
}

export function listAllNgosSync(): Ngo[] {
  return memNgos;
}

export function findNgoByIdSync(id: string): Ngo | null {
  return memNgos.find((n) => n.id === id) || null;
}

// --- Users ---
export async function findUserById(id: string): Promise<PlatformUser | null> {
  if (isConnected && mongoDb) {
    const doc = await mongoDb.collection("users").findOne({ id });
    if (doc) return doc as any;
  }
  return memUsers.find((u) => u.id === id) || null;
}

export async function findUserByEmail(email: string): Promise<PlatformUser | null> {
  const normEmail = email.toLowerCase().trim();
  if (isConnected && mongoDb) {
    const doc = await mongoDb.collection("users").findOne({
      email: { $regex: new RegExp(`^${normEmail}$`, "i") },
    });
    if (doc) return doc as any;
  }
  return memUsers.find((u) => u.email.toLowerCase() === normEmail) || null;
}

export async function saveUser(user: PlatformUser): Promise<PlatformUser> {
  const existingIdx = memUsers.findIndex((u) => u.id === user.id);
  if (existingIdx >= 0) memUsers[existingIdx] = user;
  else memUsers.push(user);

  if (isConnected && mongoDb) {
    await mongoDb.collection("users").updateOne(
      { id: user.id },
      { $set: user },
      { upsert: true }
    );
  }
  return user;
}

export async function updateUser(id: string, updates: Partial<PlatformUser>): Promise<PlatformUser | null> {
  const user = await findUserById(id);
  if (!user) return null;

  const updated = { ...user, ...updates };
  await saveUser(updated);
  return updated;
}

export async function listAllUsers(): Promise<PlatformUser[]> {
  if (isConnected && mongoDb) {
    return (await mongoDb.collection("users").find({}).toArray()) as any[];
  }
  return memUsers;
}

export async function listPendingVerifications(): Promise<PlatformUser[]> {
  if (isConnected && mongoDb) {
    return (await mongoDb.collection("users").find({ verification: "PENDING" }).toArray()) as any[];
  }
  return memUsers.filter((u) => u.verification === "PENDING");
}

// --- Donations ---
export async function findDonationById(id: string): Promise<PlatformDonation | null> {
  if (isConnected && mongoDb) {
    const doc = await mongoDb.collection("donations").findOne({ id });
    if (doc) return doc as any;
  }
  return memDonations.find((d) => d.id === id) || null;
}

export async function listAllDonations(query: any = {}): Promise<PlatformDonation[]> {
  if (isConnected && mongoDb) {
    return (await mongoDb.collection("donations").find(query).toArray()) as any[];
  }
  return memDonations.filter((d) => {
    for (const key of Object.keys(query)) {
      if ((d as any)[key] !== query[key]) return false;
    }
    return true;
  });
}

export async function saveDonation(donation: PlatformDonation): Promise<PlatformDonation> {
  const existingIdx = memDonations.findIndex((d) => d.id === donation.id);
  if (existingIdx >= 0) memDonations[existingIdx] = donation;
  else memDonations.unshift(donation);

  if (isConnected && mongoDb) {
    await mongoDb.collection("donations").updateOne(
      { id: donation.id },
      { $set: donation },
      { upsert: true }
    );
  }
  return donation;
}

export async function updateDonation(
  id: string,
  updates: Partial<PlatformDonation>
): Promise<PlatformDonation | null> {
  const donation = await findDonationById(id);
  if (!donation) return null;

  const updated = { ...donation, ...updates };
  await saveDonation(updated);
  return updated;
}

// --- NGOs ---
export async function listAllNgos(): Promise<Ngo[]> {
  if (isConnected && mongoDb) {
    return (await mongoDb.collection("ngos").find({}).toArray()) as any[];
  }
  return memNgos;
}

export async function findNgoById(id: string): Promise<Ngo | null> {
  if (isConnected && mongoDb) {
    const doc = await mongoDb.collection("ngos").findOne({ id });
    if (doc) return doc as any;
  }
  return memNgos.find((n) => n.id === id) || null;
}

export async function updateNgo(id: string, updates: Partial<Ngo>): Promise<Ngo | null> {
  const ngo = await findNgoById(id);
  if (!ngo) return null;

  const updated = { ...ngo, ...updates };
  const idx = memNgos.findIndex((n) => n.id === id);
  if (idx >= 0) memNgos[idx] = updated;

  if (isConnected && mongoDb) {
    await mongoDb.collection("ngos").updateOne({ id }, { $set: updates });
  }
  return updated;
}

// --- Volunteers ---
export async function listAllVolunteers(): Promise<VolunteerRecord[]> {
  if (isConnected && mongoDb) {
    return (await mongoDb.collection("volunteers").find({}).toArray()) as any[];
  }
  return memVolunteers;
}

export async function findVolunteerById(id: string): Promise<VolunteerRecord | null> {
  if (isConnected && mongoDb) {
    const doc = await mongoDb.collection("volunteers").findOne({ id });
    if (doc) return doc as any;
  }
  return memVolunteers.find((v) => v.id === id) || null;
}

export async function updateVolunteer(
  id: string,
  updates: Partial<VolunteerRecord>
): Promise<VolunteerRecord | null> {
  const vol = await findVolunteerById(id);
  if (!vol) return null;

  const updated = { ...vol, ...updates };
  const idx = memVolunteers.findIndex((v) => v.id === id);
  if (idx >= 0) memVolunteers[idx] = updated;

  if (isConnected && mongoDb) {
    await mongoDb.collection("volunteers").updateOne({ id }, { $set: updates });
  }
  return updated;
}

// --- Districts ---
export async function listAllDistricts(): Promise<DistrictRecord[]> {
  if (isConnected && mongoDb) {
    return (await mongoDb.collection("districts").find({}).toArray()) as any[];
  }
  return memDistricts;
}

// --- Ledger ---
export async function listLedgerEvents(): Promise<LedgerEvent[]> {
  if (isConnected && mongoDb) {
    return (await mongoDb.collection("ledger").find({}).sort({ id: 1 }).toArray()) as any[];
  }
  return memLedger;
}

export async function saveLedgerEvent(event: LedgerEvent): Promise<LedgerEvent> {
  const existingIdx = memLedger.findIndex((e) => e.id === event.id);
  if (existingIdx >= 0) {
    memLedger[existingIdx] = event;
  } else {
    memLedger.push(event);
  }
  if (isConnected && mongoDb) {
    await mongoDb.collection("ledger").updateOne(
      { id: event.id },
      { $set: event },
      { upsert: true }
    );
  }
  return event;
}

export async function pruneLedgerAfter(maxId: number): Promise<void> {
  memLedger = memLedger.filter((e) => e.id <= maxId);
  if (isConnected && mongoDb) {
    await mongoDb.collection("ledger").deleteMany({ id: { $gt: maxId } });
  }
}

export async function clearLedger(): Promise<void> {
  memLedger = [];
  if (isConnected && mongoDb) {
    await mongoDb.collection("ledger").deleteMany({});
  }
}

// --- Handovers ---
export function getHandoverDoc(donationId: string): any | null {
  return memHandovers.get(donationId) || null;
}

export function setHandoverDoc(donationId: string, data: any): void {
  memHandovers.set(donationId, data);
}

export function removeHandoverDoc(donationId: string): void {
  memHandovers.delete(donationId);
}

// --- Notifications ---
export async function listUserNotifications(userId: string): Promise<AppNotification[]> {
  if (isConnected && mongoDb) {
    return (await mongoDb.collection("notifications").find({ userId }).sort({ timestamp: -1 }).toArray()) as any[];
  }
  return memNotifications.filter((n) => n.userId === userId);
}

export async function saveNotification(notif: AppNotification): Promise<AppNotification> {
  memNotifications.unshift(notif);
  if (isConnected && mongoDb) {
    await mongoDb.collection("notifications").insertOne(notif as any);
  }
  return notif;
}

export async function markNotificationsAsRead(userId: string): Promise<void> {
  memNotifications.forEach((n) => {
    if (n.userId === userId) n.read = true;
  });
  if (isConnected && mongoDb) {
    await mongoDb.collection("notifications").updateMany({ userId }, { $set: { read: true } });
  }
}

// --- Overall Stats ---
export async function getNetworkStats(): Promise<{
  districtsCount: number;
  donorsCount: number;
  ngosCount: number;
  volunteersCount: number;
  totalDonationsCount: number;
  activeDonationsCount: number;
  rescuedMealsCount: number;
  totalDailyCapacity: number;
  database: "mongodb" | "memory";
}> {
  const users = await listAllUsers();
  const donations = await listAllDonations();
  const ngos = await listAllNgos();
  const volunteers = await listAllVolunteers();
  const districts = await listAllDistricts();

  const totalDailyCapacity = ngos.reduce((sum, n) => sum + (n.freeCapacity || 0), 0);
  const activeDonationsCount = donations.filter((d) => d.status !== "DELIVERED" && d.status !== "CANCELLED").length;
  const rescuedMealsCount = donations
    .filter((d) => d.status === "DELIVERED")
    .reduce((sum, d) => sum + (d.deliveredQuantity || d.quantity || 0), 0);

  return {
    districtsCount: districts.length || 31,
    donorsCount: users.filter((u) => u.role === "DONOR").length,
    ngosCount: ngos.length,
    volunteersCount: volunteers.length,
    totalDonationsCount: donations.length,
    activeDonationsCount,
    rescuedMealsCount,
    totalDailyCapacity,
    database: isConnected ? "mongodb" : "memory",
  };
}
