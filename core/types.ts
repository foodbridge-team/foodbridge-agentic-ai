/**
 * FoodBridge AI - Central Type Definitions
 * Clean, separated data structures for core verification, handover, and matching logic.
 */

// Geographic Coordinates
export interface Pt {
  lat: number;
  lng: number;
}

// User Roles & Verification Statuses
export type Role = "DONOR" | "NGO" | "VOLUNTEER" | "ADMIN";
export type VerifStatus = "PENDING" | "APPROVED" | "REJECTED";
export type DeliveryAvailability = "AVAILABLE" | "OFF_DUTY";
export type HandoverType = "VOLUNTEER" | "NGO_SELF_PICKUP";

// Handover Lifecycle Status
export type Status =
  | "RESERVED"
  | "ASSIGNED"
  | "PICKED_UP"
  | "DELIVERED"
  | "AT_RISK"
  | "CANCELLED";

// OTP Stages and Verification Records
export type Stage = "PICKUP" | "DELIVERY";

export interface OtpRecord {
  donationId: string;
  stage: Stage;
  issuedTo: string;
  allowedEntrant: string;
  hash: string;
  expiresAt: number;
  attempts: number;
  used: boolean;
}

export type OtpResult =
  | "OK"
  | "WRONG_ENTRANT"
  | "EXPIRED"
  | "USED"
  | "LOCKED"
  | "INVALID";

// Cryptographic Tamper-Evident Ledger
export interface LedgerEvent {
  id: number;
  type: string;
  donationId: string;
  payload: Record<string, unknown>;
  ts: string;
  prevHash: string;
  hash: string;
}

export interface LedgerVerificationResult {
  ok: boolean;
  brokenAt?: number;
}

// Food Donation Specification
export interface Donation {
  id: string;
  quantity: number;
  location: Pt;
  deadline: number;
  allergens: string[];
  storageOk: boolean;
  category: string;
}

// NGO Profile Specification
export interface Ngo {
  id: string;
  verified: boolean;
  isDemo?: boolean;
  location: Pt;
  freeCapacity: number;
  acceptsCategories: string[];
  excludedAllergens: string[];
  maxKm: number;
}

// Matching and Recommendation
export interface Match {
  ngoId: string;
  km: number;
  score: number;
  reasons: string[];
  suitabilityScore?: number;
  isDemo?: boolean;
}

export interface Rejection {
  ngoId: string;
  reason: string;
}

export interface EligibilityResult {
  ok: Array<Ngo & { km: number }>;
  rejected: Rejection[];
  donationBlocked: string;
}

// Handover Completion Parameters
export interface CompleteDeliveryParams {
  collectorId: string;
  code: string;
  ngoRepId: string;
  quantityReceived: number;
  photoRef?: string;
  evidenceLocation?: Pt;
}

export type DeliveryResult =
  | OtpResult
  | "MISSING_EVIDENCE"
  | "NOT_RECEIVER"
  | "BAD_STATE";
