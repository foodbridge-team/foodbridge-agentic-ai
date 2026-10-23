import { createHash } from "node:crypto";
import type { LedgerEvent, LedgerVerificationResult } from "./types.ts";

export type { LedgerEvent, LedgerVerificationResult };

// Prohibit sensitive data fields in public/audit records
const FORBIDDEN = /otp|password|secret|token/i;

export const GENESIS = "0".repeat(64);

/**
 * Deterministically computes SHA-256 digest of an audit entry.
 */
function digest(event: Omit<LedgerEvent, "hash">): string {
  const serialized = JSON.stringify([
    event.id,
    event.type,
    event.donationId,
    event.payload,
    event.ts,
    event.prevHash,
  ]);
  return createHash("sha256").update(serialized).digest("hex");
}

/**
 * Tamper-Evident SHA-256 Audit Ledger.
 * Maintains an append-only cryptographic chain of lifecycle events.
 */
export class Ledger {
  events: LedgerEvent[] = [];

  /**
   * Appends an event to the ledger after validating that no sensitive secrets are leaked.
   */
  append(
    type: string,
    donationId: string,
    payload: Record<string, unknown> = {},
    ts = new Date().toISOString()
  ): LedgerEvent {
    for (const key of Object.keys(payload)) {
      if (FORBIDDEN.test(key)) {
        throw new Error(`Ledger refuses sensitive field: ${key}`);
      }
    }

    const prevHash = this.events.at(-1)?.hash ?? GENESIS;
    const base = {
      id: this.events.length + 1,
      type,
      donationId,
      payload,
      ts,
      prevHash,
    };

    const entry: LedgerEvent = {
      ...base,
      hash: digest(base),
    };

    this.events.push(entry);
    return entry;
  }

  /**
   * Verifies the integrity of every link in the hash chain.
   */
  verify(): LedgerVerificationResult {
    let expectedPrevHash = GENESIS;

    for (const event of this.events) {
      const { hash, ...unhashed } = event;

      if (event.prevHash !== expectedPrevHash || digest(unhashed) !== hash) {
        return { ok: false, brokenAt: event.id };
      }

      expectedPrevHash = hash;
    }

    return { ok: true };
  }
}
