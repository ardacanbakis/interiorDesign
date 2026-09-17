/**
 * Real sizes, as sold in Turkey.
 *
 * Kept as data in one file so that adding another region is a second table
 * rather than a hunt through sixty definitions. Every value is a starting
 * point — each is editable once the object is placed — but starting from a
 * real size rather than a guess is most of what makes a plan trustworthy.
 */

import { type ItemPreset } from './types.ts';
import { type Mm } from '../units/length.ts';

/**
 * Beds, by mattress size.
 *
 * Turkish sizes are their own thing: 90x190 for a single, 140x190 or 160x200
 * for a double. Buying to European or UK sizes and finding the bedding does not
 * fit is a genuine annoyance, so these are the numbers to plan against.
 *
 * `height` is the height of the whole bed — the headboard, which is its tallest
 * part. The mattress top is a separate parameter, because it is a different
 * question: the headboard is what a window sill has to clear, and the mattress
 * top is what a bedside table should match.
 */
export const BED_PRESETS: readonly ItemPreset[] = [
  { name: 'Tek kişilik 90 × 190', width: 900, depth: 1900, height: 900 },
  { name: 'Tek kişilik 100 × 200', width: 1000, depth: 2000, height: 900 },
  { name: 'Çift kişilik 140 × 190', width: 1400, depth: 1900, height: 900 },
  { name: 'Çift kişilik 150 × 200', width: 1500, depth: 2000, height: 900 },
  { name: 'Çift kişilik 160 × 200', width: 1600, depth: 2000, height: 900 },
  { name: 'King 180 × 200', width: 1800, depth: 2000, height: 900 },
];

/** Panel radiators. Type 22 (PKKP) is the usual choice. */
export const RADIATOR_PRESETS: readonly ItemPreset[] = [
  { name: 'PKKP 600 × 600', width: 600, depth: 100, height: 600 },
  { name: 'PKKP 600 × 900', width: 900, depth: 100, height: 600 },
  { name: 'PKKP 600 × 1200', width: 1200, depth: 100, height: 600 },
  { name: 'PKKP 500 × 1000', width: 1000, depth: 100, height: 500 },
  { name: 'PKKP 300 × 1600', width: 1600, depth: 100, height: 300 },
];

/** Kitchen carcasses. 60cm deep, 85cm high to the worktop, is the standard. */
export const KITCHEN = {
  baseDepth: 600 as Mm,
  baseHeight: 850 as Mm,
  worktopThickness: 40 as Mm,
  /**
   * How far the worktop stands proud of the carcass door fronts. The unit's
   * stated depth is the worktop's, so the carcass sits back by this much —
   * a 60cm run measures 60cm from the wall, not 62.
   */
  worktopOverhang: 20 as Mm,
  wallDepth: 350 as Mm,
  wallHeight: 720 as Mm,
  /** Clear height between the worktop and the underside of the wall units. */
  wallElevation: 1400 as Mm,
  tallHeight: 2100 as Mm,
  /** Module widths sold off the shelf. */
  widths: [300, 400, 450, 500, 600, 800, 900, 1000, 1200] as readonly Mm[],
} as const;

export const BASE_UNIT_PRESETS: readonly ItemPreset[] = KITCHEN.widths.map((width) => ({
  name: `${width / 10} cm`,
  width,
  depth: KITCHEN.baseDepth,
  height: KITCHEN.baseHeight,
}));

export const WALL_UNIT_PRESETS: readonly ItemPreset[] = KITCHEN.widths.map((width) => ({
  name: `${width / 10} cm`,
  width,
  depth: KITCHEN.wallDepth,
  height: KITCHEN.wallHeight,
}));

/** Wardrobes, by number of doors at a typical 500mm per door. */
export const WARDROBE_PRESETS: readonly ItemPreset[] = [
  { name: '2 doors — 100 cm', width: 1000, depth: 600, height: 2100 },
  { name: '3 doors — 150 cm', width: 1500, depth: 600, height: 2100 },
  { name: '4 doors — 200 cm', width: 2000, depth: 600, height: 2100 },
  { name: 'Sliding — 180 cm', width: 1800, depth: 650, height: 2200 },
  { name: 'Sliding — 240 cm', width: 2400, depth: 650, height: 2200 },
];

export const SOFA_PRESETS: readonly ItemPreset[] = [
  { name: '2-seat — 160 cm', width: 1600, depth: 900, height: 850 },
  { name: '3-seat — 210 cm', width: 2100, depth: 950, height: 850 },
  { name: '3-seat deep — 230 cm', width: 2300, depth: 1050, height: 850 },
];

export const DINING_TABLE_PRESETS: readonly ItemPreset[] = [
  { name: '4 people — 120 × 80', width: 1200, depth: 800, height: 750 },
  { name: '6 people — 160 × 90', width: 1600, depth: 900, height: 750 },
  { name: '8 people — 200 × 100', width: 2000, depth: 1000, height: 750 },
];

export const TV_PRESETS: readonly ItemPreset[] = [
  // Width across the screen including a modest bezel.
  { name: '43"', width: 970, depth: 80, height: 580 },
  { name: '50"', width: 1120, depth: 80, height: 660 },
  { name: '55"', width: 1240, depth: 80, height: 720 },
  { name: '65"', width: 1460, depth: 80, height: 840 },
  { name: '75"', width: 1680, depth: 80, height: 970 },
];

export const FRIDGE_PRESETS: readonly ItemPreset[] = [
  { name: 'Single door — 60 cm', width: 600, depth: 650, height: 1850 },
  { name: 'Double door — 70 cm', width: 700, depth: 700, height: 1850 },
  { name: 'Side by side — 90 cm', width: 900, depth: 720, height: 1800 },
];

/** Heights that matter and are not worth re-deriving in every definition. */
export const HEIGHTS = {
  worktop: 850 as Mm,
  table: 750 as Mm,
  desk: 750 as Mm,
  seat: 450 as Mm,
  socket: 400 as Mm,
  switch: 1100 as Mm,
  /** Height a wall-hung TV is usually centred at in a living room. */
  tvCentre: 1150 as Mm,
} as const;
