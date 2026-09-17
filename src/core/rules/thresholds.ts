/**
 * The numbers the checker judges by.
 *
 * Kept in one editable place because none of this is law. 750mm for a walkway
 * is guidance; a Turkish flat built in 1998 has corridors narrower than that and
 * people live in them perfectly happily. A checker that presents guidance as a
 * verdict gets switched off, so every figure here is a default the user can
 * move — and the panel says which number it used.
 */

import { type Mm } from '../units/length.ts';

export interface Thresholds {
  /** Clear width to walk through. */
  readonly walkway: Mm;
  /** Clear floor in front of a doorway, so the door is usable. */
  readonly doorLanding: Mm;
  /**
   * Anything this low is stepped on rather than walked round — a rug, a floor
   * trim. Below it, two things sharing floor space is not a collision.
   */
  readonly stepOverHeight: Mm;
  /** How far in front of a window has to stay below the sill. */
  readonly windowApproach: Mm;
  /** Sum of the three legs of the sink–hob–fridge triangle. */
  readonly kitchenTriangleMin: Mm;
  readonly kitchenTriangleMax: Mm;
  /** Comfortable viewing distance, as a multiple of the screen's width. */
  readonly tvDistanceMin: number;
  readonly tvDistanceMax: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  walkway: 750,
  doorLanding: 700,
  stepOverHeight: 50,
  windowApproach: 300,
  // The classic kitchen work triangle: under 3.6m and it is cramped, over 8m
  // and you are walking the length of the room to cook.
  kitchenTriangleMin: 3600,
  kitchenTriangleMax: 8000,
  // Roughly 1.5 to 2.5 times the screen width, which is the range most viewing
  // guidance lands on once it is converted out of diagonals.
  tvDistanceMin: 1.5,
  tvDistanceMax: 2.5,
};

export function withThresholds(overrides: Partial<Thresholds> = {}): Thresholds {
  return { ...DEFAULT_THRESHOLDS, ...overrides };
}
