import { distanceKm, type Pt } from "./geo.ts";
import type {
  Donation,
  Ngo,
  Match,
  Rejection,
  EligibilityResult,
} from "./types.ts";

export type { Donation, Ngo, Match, Rejection, EligibilityResult };

// Assumed city collection speed (25 km/h) for feasibility checking
const AVG_KMH = 25;

/**
 * Deterministic Hard Checks.
 * Evaluates NGO eligibility against safety, capacity, allergens, and transit window constraints.
 */
export function eligible(
  donation: Donation,
  ngos: Ngo[],
  now = Date.now()
): EligibilityResult {
  const ok: Array<Ngo & { km: number }> = [];
  const rejected: Rejection[] = [];

  // Check 1: Expiration
  if (donation.deadline <= now) {
    return {
      ok,
      rejected: ngos.map((ngo) => ({
        ngoId: ngo.id,
        reason: "donation deadline passed",
      })),
      donationBlocked: "deadline passed",
    };
  }

  // Check 2: Safe storage verification
  if (!donation.storageOk) {
    return {
      ok,
      rejected: [],
      donationBlocked:
        "storage information missing or questionable; needs donor/admin review",
    };
  }

  // Check 3: Individual NGO constraints
  for (const ngo of ngos) {
    const km = distanceKm(donation.location, ngo.location);

    let rejectionReason = "";

    if (!ngo.verified) {
      rejectionReason = "NGO not admin-approved";
    } else if (ngo.freeCapacity < donation.quantity) {
      rejectionReason = "insufficient capacity";
    } else if (!ngo.acceptsCategories.includes(donation.category)) {
      rejectionReason = "category not accepted";
    } else if (
      donation.allergens.some((allergen) =>
        ngo.excludedAllergens.includes(allergen)
      )
    ) {
      rejectionReason = "allergen conflict";
    } else if (km > ngo.maxKm) {
      rejectionReason = "outside receiver radius";
    } else {
      const estimatedTransitMs = (km / AVG_KMH) * 3.6e6;
      if (now + estimatedTransitMs > donation.deadline) {
        rejectionReason = "collection before deadline not feasible";
      }
    }

    if (rejectionReason) {
      rejected.push({ ngoId: ngo.id, reason: rejectionReason });
    } else {
      ok.push({ ...ngo, km });
    }
  }

  return { ok, rejected, donationBlocked: "" };
}

/**
 * Rule-Based Match Ranking with AI suitability explanations.
 * Ranks eligible NGOs considering distance, capacity buffer, and urgency.
 */
export function rankRuleBased(
  donation: Donation,
  candidates: Array<Ngo & { km: number }>,
  now = Date.now()
): Match[] {
  const hoursLeft = Math.max((donation.deadline - now) / 3.6e6, 0.1);

  return candidates
    .map((ngo) => {
      const distancePenalty = Math.min(ngo.km * 4, 60);
      const capacityRatioBonus =
        Math.min(ngo.freeCapacity / donation.quantity, 2) * 10;
      const urgencyBonus = hoursLeft < 3 ? 10 : 0;

      const rawScore = 100 - distancePenalty + capacityRatioBonus + urgencyBonus;
      const score = Math.round(rawScore * 10) / 10;
      const transitMins = Math.max(2, Math.round((ngo.km / AVG_KMH) * 60));

      return {
        ngoId: ngo.id,
        km: Math.round(ngo.km * 10) / 10,
        score,
        suitabilityScore: Math.min(99, Math.max(65, Math.round(score))),
        isDemo: Boolean(ngo.isDemo),
        reasons: [
          `~${ngo.km.toFixed(1)} km straight-line (est. ${transitMins} min transit)`,
          `capacity ${ngo.freeCapacity} for ${donation.quantity} requested meals`,
          `${hoursLeft.toFixed(1)} h to deadline`,
          `Category '${donation.category}' accepted with 0 allergen conflicts`,
        ],
      };
    })
    .sort((a, b) => b.score - a.score);
}
