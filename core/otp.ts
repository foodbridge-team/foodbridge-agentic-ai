import { randomInt, createHmac, timingSafeEqual } from "node:crypto";
import type { Stage, OtpRecord, OtpResult } from "./types.ts";

export type { Stage, OtpRecord, OtpResult };

export const MAX_ATTEMPTS = 5;
export const TTL_MS = 10 * 60_000; // 10 minutes

/**
 * Generates an HMAC-SHA256 digest bound to donation ID, stage, and server secret pepper.
 * This guarantees the plaintext OTP is never saved to the database.
 */
function hashOtp(
  pepper: string,
  record: { donationId: string; stage: Stage },
  code: string
): Buffer {
  return createHmac("sha256", pepper)
    .update(`${record.donationId}|${record.stage}|${code}`)
    .digest();
}

/**
 * Issues a cryptographically secure 6-digit OTP.
 * Returns the plaintext code ONCE to display to the issuer.
 * Only the HMAC hash is stored in the record.
 */
export function issueOtp(
  pepper: string,
  params: {
    donationId: string;
    stage: Stage;
    issuedTo: string;
    allowedEntrant: string;
  },
  now = Date.now()
): { code: string; record: OtpRecord } {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");

  const record: OtpRecord = {
    ...params,
    hash: hashOtp(pepper, params, code).toString("hex"),
    expiresAt: now + TTL_MS,
    attempts: 0,
    used: false,
  };

  return { code, record };
}

/**
 * Verifies an entered OTP using constant-time comparison (timingSafeEqual).
 * Enforces single-use, max 5 attempts lockout, identity check, and expiration.
 */
export function verifyOtp(
  pepper: string,
  rec: OtpRecord,
  entrantId: string,
  code: string,
  now = Date.now()
): OtpResult {
  if (rec.used) {
    return "USED";
  }

  if (rec.attempts >= MAX_ATTEMPTS) {
    return "LOCKED";
  }

  if (entrantId !== rec.allowedEntrant) {
    return "WRONG_ENTRANT";
  }

  if (now > rec.expiresAt) {
    return "EXPIRED";
  }

  rec.attempts++;

  const computedHash = hashOtp(pepper, rec, code);
  const storedHash = Buffer.from(rec.hash, "hex");
  const isValid = timingSafeEqual(computedHash, storedHash);

  if (!isValid) {
    return "INVALID";
  }

  rec.used = true;
  return "OK";
}
