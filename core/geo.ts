import type { Pt } from "./types.ts";

export type { Pt };

/**
 * Calculates approximate straight-line (Haversine) distance in kilometers between two geographic points.
 * 
 * Note: Straight-line metric for fast radius and feasibility filtering.
 */
export function distanceKm(a: Pt, b: Pt): number {
  const toRadians = (deg: number) => (deg * Math.PI) / 180;
  const EARTH_RADIUS_KM = 6371;

  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) *
      Math.cos(toRadians(b.lat)) *
      Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}
