/**
 * Standard door and window sizes.
 *
 * Turkish residential practice, as data rather than as numbers buried in the
 * placement code, so another region is a second table rather than a refactor.
 * Every value is editable once the opening is placed; these are the starting
 * points that mean most openings need no editing at all.
 */

import { type Mm } from '../units/length.ts';
import { type Opening, type OpeningKind } from '../model/schema.ts';

export interface OpeningPreset {
  readonly id: string;
  readonly label: string;
  readonly kind: OpeningKind;
  readonly width: Mm;
  readonly height: Mm;
  /** Height of the sill above the floor. Zero for anything walked through. */
  readonly sillHeight: Mm;
}

export const OPENING_PRESETS: readonly OpeningPreset[] = [
  // Doors. 80cm is the ordinary room door; bathrooms are commonly 70cm and
  // front doors 100cm.
  { id: 'door-70', label: 'Bathroom door', kind: 'door', width: 700, height: 2050, sillHeight: 0 },
  { id: 'door-80', label: 'Room door', kind: 'door', width: 800, height: 2050, sillHeight: 0 },
  { id: 'door-90', label: 'Wide door', kind: 'door', width: 900, height: 2050, sillHeight: 0 },
  {
    id: 'door-100',
    label: 'Entrance door',
    kind: 'door',
    width: 1000,
    height: 2100,
    sillHeight: 0,
  },
  {
    id: 'door-balcony',
    label: 'Balcony door',
    kind: 'door',
    width: 800,
    height: 2100,
    sillHeight: 0,
  },

  // Windows. Sills sit at 90cm in habitable rooms and higher in kitchens and
  // bathrooms, where a worktop or a bath usually runs underneath.
  {
    id: 'window-100',
    label: 'Small window',
    kind: 'window',
    width: 1000,
    height: 1200,
    sillHeight: 900,
  },
  { id: 'window-120', label: 'Window', kind: 'window', width: 1200, height: 1400, sillHeight: 900 },
  {
    id: 'window-180',
    label: 'Wide window',
    kind: 'window',
    width: 1800,
    height: 1400,
    sillHeight: 900,
  },
  {
    id: 'window-kitchen',
    label: 'Kitchen window',
    kind: 'window',
    width: 1200,
    height: 1000,
    sillHeight: 1400,
  },
  {
    id: 'window-bathroom',
    label: 'Bathroom window',
    kind: 'window',
    width: 600,
    height: 600,
    sillHeight: 1700,
  },

  // A plain hole in a wall — a serving hatch, or a doorway with no door in it.
  {
    id: 'opening-900',
    label: 'Doorway (no door)',
    kind: 'opening',
    width: 900,
    height: 2100,
    sillHeight: 0,
  },
];

export function presetById(id: string): OpeningPreset | null {
  return OPENING_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function defaultPresetFor(kind: OpeningKind): OpeningPreset {
  const fallback = OPENING_PRESETS.find((preset) => preset.kind === kind);
  if (!fallback) throw new Error(`No preset for opening kind "${kind}"`);
  return fallback;
}

/** Build an opening from a preset, ready to be positioned on a wall. */
export function openingFromPreset(
  id: string,
  preset: OpeningPreset,
  wallId: string,
  offset: Mm,
): Opening {
  return {
    id,
    kind: preset.kind,
    label: preset.label,
    wallId,
    offset,
    width: preset.width,
    height: preset.height,
    sillHeight: preset.sillHeight,
    // Hinged at the end nearer the wall's start, opening to its right-hand
    // side. Arbitrary, but it is one click to flip either, and a door has to
    // start somewhere.
    hinge: 'a',
    side: 'right',
    openAmount: 0,
  };
}
