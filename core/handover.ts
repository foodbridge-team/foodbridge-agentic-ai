import { Ledger } from "./ledger.ts";
import { issueOtp, verifyOtp, type OtpRecord, type OtpResult } from "./otp.ts";
import { distanceKm, type Pt } from "./geo.ts";
import type { Status, CompleteDeliveryParams, DeliveryResult, HandoverType } from "./types.ts";

export type { Status, CompleteDeliveryParams, DeliveryResult, HandoverType };

// Tolerance threshold (500 meters) before flagging delivery location divergence
export const MAX_DEST_DRIFT_KM = 0.5;

/**
 * Two-Stage Handover State Machine.
 * 
 * Enforces dual verification:
 * 1. PICKUP: Donor provides code -> Collector enters code -> Food transferred to collector.
 * 2. DELIVERY: NGO provides code -> Collector enters code with photo proof -> Food handed to NGO.
 * 
 * Supports both VOLUNTEER dispatch and NGO_SELF_PICKUP modes.
 */
export class Handover {
  status: Status = "RESERVED";
  handoverType: HandoverType = "VOLUNTEER";
  collectorId?: string;
  otps: Partial<Record<"PICKUP" | "DELIVERY", OtpRecord>> = {};
  flags: string[] = [];

  id: string;
  donorId: string;
  ngoRepId: string;
  ngoLocation: Pt;
  ledger: Ledger;
  pepper: string;

  constructor(
    id: string,
    donorId: string,
    ngoRepId: string,
    ngoLocation: Pt,
    ledger: Ledger,
    pepper: string
  ) {
    this.id = id;
    this.donorId = donorId;
    this.ngoRepId = ngoRepId;
    this.ngoLocation = ngoLocation;
    this.ledger = ledger;
    this.pepper = pepper;

    ledger.append("DONATION_RESERVED", id, { donorId });
  }

  /**
   * Assigns an approved volunteer collector to the reserved donation.
   */
  assignCollector(collectorId: string, approvedBy: string): void {
    if (this.status !== "RESERVED") {
      throw new Error(`Cannot assign in status ${this.status}`);
    }

    this.collectorId = collectorId;
    this.status = "ASSIGNED";
    this.handoverType = "VOLUNTEER";
    this.ledger.append("COLLECTOR_ASSIGNED", this.id, {
      collectorId,
      approvedBy,
    });
  }

  /**
   * Enables direct NGO self-pickup when no delivery courier is available or NGO chooses direct collection.
   */
  enableSelfPickup(ngoRepId: string): void {
    if (this.status !== "RESERVED") {
      throw new Error(`Cannot enable self-pickup in status ${this.status}`);
    }

    this.collectorId = ngoRepId;
    this.handoverType = "NGO_SELF_PICKUP";
    this.status = "ASSIGNED";
    this.ledger.append("NGO_SELF_PICKUP_ASSIGNED", this.id, {
      ngoRepId,
      handoverType: "NGO_SELF_PICKUP",
    });
  }

  /**
   * Donor receives the pickup code. Only the assigned collector (volunteer or self-pickup NGO rep) may enter it.
   */
  issuePickupOtp(actorId: string): string {
    if (actorId !== this.donorId) {
      throw new Error("Only the donor can issue the pickup OTP");
    }

    if (this.status !== "ASSIGNED") {
      throw new Error("Not awaiting pickup");
    }

    const { code, record } = issueOtp(this.pepper, {
      donationId: this.id,
      stage: "PICKUP",
      issuedTo: this.donorId,
      allowedEntrant: this.collectorId!,
    });

    this.otps.PICKUP = record;
    return code;
  }

  /**
   * Collector confirms pickup by submitting the OTP given by the donor.
   */
  confirmPickup(actorId: string, code: string): OtpResult {
    if (this.status !== "ASSIGNED" || !this.otps.PICKUP) {
      return "INVALID";
    }

    const result = verifyOtp(this.pepper, this.otps.PICKUP, actorId, code);

    if (result === "OK") {
      this.status = "PICKED_UP";
      this.ledger.append("PICKUP_VERIFIED", this.id, {
        collectorId: actorId,
        handoverType: this.handoverType,
      });
    } else {
      this.ledger.append("PICKUP_OTP_FAILED", this.id, {
        collectorId: actorId,
        reason: result,
      });
    }

    return result;
  }

  /**
   * Receiving NGO representative generates the delivery code.
   */
  issueDeliveryOtp(actorId: string): string {
    if (actorId !== this.ngoRepId) {
      throw new Error(
        "Only the receiving NGO representative can issue the delivery OTP"
      );
    }

    if (this.status !== "PICKED_UP") {
      throw new Error("Pickup not verified");
    }

    const { code, record } = issueOtp(this.pepper, {
      donationId: this.id,
      stage: "DELIVERY",
      issuedTo: this.ngoRepId,
      allowedEntrant: this.collectorId!,
    });

    this.otps.DELIVERY = record;
    return code;
  }

  /**
   * Completes handover delivery.
   * Requires: valid OTP, correct receiver rep, valid photo proof, and quantity > 0.
   */
  completeDelivery(params: {
    collectorId: string;
    code: string;
    ngoRepId: string;
    quantityReceived: number;
    photoRef?: string;
    evidenceLocation?: Pt;
  }): OtpResult | "MISSING_EVIDENCE" | "NOT_RECEIVER" | "BAD_STATE" {
    if (this.status !== "PICKED_UP" || !this.otps.DELIVERY) {
      return "BAD_STATE";
    }

    if (params.ngoRepId !== this.ngoRepId) {
      return "NOT_RECEIVER";
    }

    if (!params.photoRef || !(params.quantityReceived > 0)) {
      return "MISSING_EVIDENCE";
    }

    const result = verifyOtp(
      this.pepper,
      this.otps.DELIVERY,
      params.collectorId,
      params.code
    );

    if (result !== "OK") {
      this.ledger.append("DELIVERY_OTP_FAILED", this.id, { reason: result });
      return result;
    }

    if (
      params.evidenceLocation &&
      distanceKm(params.evidenceLocation, this.ngoLocation) > MAX_DEST_DRIFT_KM
    ) {
      this.flags.push("EVIDENCE_LOCATION_MISMATCH");
      this.ledger.append("EVIDENCE_FLAGGED", this.id, {
        flag: "EVIDENCE_LOCATION_MISMATCH",
      });
    }

    this.status = "DELIVERED";
    this.ledger.append("DELIVERED", this.id, {
      quantityReceived: params.quantityReceived,
      photoRef: params.photoRef,
      flags: [...this.flags],
      handoverType: this.handoverType,
    });

    return "OK";
  }

  /**
   * Cancels a handover unless already delivered.
   */
  cancel(reason: string): void {
    if (this.status === "DELIVERED") {
      throw new Error("Already delivered");
    }

    this.status = "CANCELLED";
    this.ledger.append("CANCELLED", this.id, { reason });
  }
}
