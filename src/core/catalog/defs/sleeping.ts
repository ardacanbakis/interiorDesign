/**
 * Beds and what stands beside them.
 *
 * A bed's front (+y) is its foot, so "the side you get in from" is a side zone
 * and "room to walk past the end" is a front zone. Access sides are a parameter
 * because a bed against a wall only needs one, and demanding 600mm on both
 * would flag every single room that is laid out perfectly sensibly.
 */

import { type Item } from '../../model/schema.ts';
import {
  box,
  frontZone,
  line,
  outlineRect,
  rect,
  shape,
  sideZone,
  size3,
  stroke,
} from '../build.ts';
import { BED_PRESETS } from '../presets.tr.ts';
import { type ClearanceZone, type ItemDefinition, numberParam, stringParam } from '../types.ts';
import { vec2 } from '../../geometry/vec2.ts';

/** Minimum space to get in and out of a bed comfortably. */
const BED_ACCESS: number = 600;

/**
 * How much of the head end the access zone leaves out.
 *
 * You get in and out of a bed beside its middle and its foot, not beside the
 * pillows — which is exactly where a bedside table goes. Running the zone the
 * whole length would flag every properly furnished bedroom in the country.
 */
const BED_HEAD_ALLOWANCE = 500;

/** Top of the mattress above the floor — a divan base and a mattress on it. */
const MATTRESS_TOP = 550;
const HEADBOARD_DEPTH = 80;

const ACCESS_OPTIONS = [
  { value: 'both', label: 'Both sides' },
  { value: 'left', label: 'Left only' },
  { value: 'right', label: 'Right only' },
  { value: 'none', label: 'Against a wall' },
] as const;

function bedAccessZones(item: Item): ClearanceZone[] {
  const access = stringParam(item, 'access', 'both');
  const zones: ClearanceZone[] = [];

  const along = Math.max(300, item.depth - BED_HEAD_ALLOWANCE);
  const offset = item.depth / 2 - along / 2;

  for (const side of ['left', 'right'] as const) {
    if (access !== 'both' && access !== side) continue;
    zones.push(
      sideZone(item.width, item.depth, {
        id: `bed-access-${side}`,
        reason: 'No room to get in or out of this side of the bed',
        reach: BED_ACCESS,
        side,
        along,
        offset,
      }),
    );
  }

  return zones;
}

/** A bed: frame, mattress on top of it, and a headboard at the back. */
function bedPlan(item: Item) {
  const headboard = numberParam(item, 'headboardDepth', HEADBOARD_DEPTH);
  const pillowDepth = Math.min(item.depth * 0.25, 500);
  const backEdge = -item.depth / 2;

  return shape(rect(item.width, item.depth), {
    strokes: [
      // The headboard, across the back.
      outlineRect(0, backEdge + headboard / 2, item.width, headboard, { weight: 'heavy' }),
      // Pillows, which is what makes a plan symbol read as a bed at a glance.
      ...pillows(item.width, backEdge + headboard, pillowDepth),
      // The turned-back corner of the duvet.
      stroke(
        [
          vec2(-item.width / 2, backEdge + headboard + pillowDepth + 100),
          vec2(item.width / 2, backEdge + headboard + pillowDepth + 100),
        ],
        { weight: 'hairline' },
      ),
    ],
  });
}

function pillows(width: number, y: number, depth: number) {
  // One pillow under about 1200mm of bed, two above it.
  const count = width >= 1200 ? 2 : 1;
  const gap = 60;
  const pillowWidth = (width - gap * (count + 1)) / count;

  return Array.from({ length: count }, (_, index) => {
    const centre = -width / 2 + gap * (index + 1) + pillowWidth * (index + 0.5);
    return outlineRect(centre, y + depth / 2, pillowWidth, depth, { weight: 'hairline' });
  });
}

/**
 * Frame, mattress, headboard.
 *
 * A bed's `height` is its headboard — the tallest thing about it, and what has
 * to clear a window sill or a wall-mounted radiator. Where the mattress sits is
 * a separate figure, and the one that matters for a bedside table.
 */
function bedSolid(item: Item) {
  const headboard = numberParam(item, 'headboardDepth', HEADBOARD_DEPTH);
  // Kept inside the overall height, and thick enough to leave a frame under it,
  // however the two are edited.
  const mattressTop = Math.max(
    50,
    Math.min(item.height, numberParam(item, 'mattressTop', MATTRESS_TOP)),
  );
  const mattressThickness = Math.max(
    20,
    Math.min(numberParam(item, 'mattressThickness', 250), mattressTop - 20),
  );
  const frameHeight = mattressTop - mattressThickness;

  return [
    box(0, 0, 0, size3(item.width, item.depth, frameHeight), 'carcass'),
    box(
      0,
      headboard / 2,
      frameHeight,
      size3(item.width - 60, item.depth - headboard - 30, mattressThickness),
      'soft',
    ),
    box(
      0,
      -item.depth / 2 + headboard / 2,
      0,
      size3(item.width, headboard, item.height),
      'carcass',
    ),
  ];
}

function bed(kind: string, label: string, width: number, depth: number): ItemDefinition {
  return {
    kind,
    label,
    category: 'sleeping',
    rooms: ['bedroom'],
    // `height` is the headboard: the tallest part, and the one a window sill or
    // a wall-hung radiator has to clear.
    defaults: { width, depth, height: 900, elevation: 0, mount: 'floor' },
    presets: BED_PRESETS,
    fields: [
      { key: 'access', label: 'Get in from', kind: 'choice', options: ACCESS_OPTIONS },
      { key: 'headboardDepth', label: 'Headboard depth', kind: 'length', min: 0, max: 400 },
      {
        key: 'mattressTop',
        label: 'Mattress top',
        kind: 'length',
        min: 200,
        max: 900,
        hint: 'Height of the sleeping surface above the floor.',
      },
      { key: 'mattressThickness', label: 'Mattress thickness', kind: 'length', min: 100, max: 500 },
    ],
    params: {
      access: 'both',
      headboardDepth: HEADBOARD_DEPTH,
      mattressTop: MATTRESS_TOP,
      mattressThickness: 250,
    },
    plan: bedPlan,
    solid: bedSolid,
    clearances: (item) => [
      ...bedAccessZones(item),
      frontZone(item.width, item.depth, {
        id: 'bed-foot',
        reason: 'No room to walk past the foot of the bed',
        depth: 500,
        severity: 'warning',
      }),
    ],
  };
}

export const SLEEPING_DEFINITIONS: readonly ItemDefinition[] = [
  bed('bed-single', 'Single bed', 900, 1900),
  bed('bed-double', 'Double bed', 1400, 1900),
  bed('bed-queen', 'Queen bed', 1600, 2000),
  bed('bed-king', 'King bed', 1800, 2000),

  {
    kind: 'bed-bunk',
    label: 'Bunk bed',
    category: 'sleeping',
    rooms: ['bedroom'],
    defaults: { width: 900, depth: 1900, height: 1700, elevation: 0, mount: 'floor' },
    presets: [
      { name: 'Single — 90 × 190', width: 900, depth: 1900, height: 1700 },
      { name: 'Wide — 120 × 200', width: 1200, depth: 2000, height: 1700 },
    ],
    fields: [{ key: 'access', label: 'Get in from', kind: 'choice', options: ACCESS_OPTIONS }],
    params: { access: 'left' },
    plan: (item) =>
      shape(rect(item.width, item.depth), {
        strokes: [
          outlineRect(0, 0, item.width - 120, item.depth - 120, { weight: 'hairline' }),
          // The ladder, at the foot.
          ...[0, 1, 2].map((rung) =>
            line(
              -item.width / 4,
              item.depth / 2 - 80 - rung * 60,
              item.width / 4,
              item.depth / 2 - 80 - rung * 60,
              { weight: 'hairline' },
            ),
          ),
        ],
      }),
    solid: (item) => [
      box(0, 0, 300, size3(item.width, item.depth, 250), 'soft'),
      box(0, 0, item.height - 300, size3(item.width, item.depth, 250), 'soft'),
      // Corner posts.
      ...[-1, 1].flatMap((sx) =>
        [-1, 1].map((sy) =>
          box(
            (sx * (item.width - 60)) / 2,
            (sy * (item.depth - 60)) / 2,
            0,
            size3(60, 60, item.height),
            'carcass',
          ),
        ),
      ),
    ],
    clearances: (item) => [
      ...bedAccessZones(item),
      frontZone(item.width, item.depth, {
        id: 'bunk-ladder',
        reason: 'No room to climb the ladder',
        depth: 700,
        severity: 'error',
      }),
    ],
  },

  {
    kind: 'cot',
    label: 'Cot',
    category: 'sleeping',
    rooms: ['bedroom'],
    defaults: { width: 700, depth: 1300, height: 950, elevation: 0, mount: 'floor' },
    presets: [
      { name: 'Standard — 70 × 130', width: 700, depth: 1300, height: 950 },
      { name: 'Small — 60 × 120', width: 600, depth: 1200, height: 900 },
    ],
    fields: [],
    params: {},
    plan: (item) =>
      shape(rect(item.width, item.depth), {
        strokes: [outlineRect(0, 0, item.width - 100, item.depth - 100, { weight: 'hairline' })],
      }),
    solid: (item) => [
      box(0, 0, 300, size3(item.width - 100, item.depth - 100, 120), 'soft'),
      ...[-1, 1].map((side) =>
        box((side * (item.width - 40)) / 2, 0, 0, size3(40, item.depth, item.height), 'carcass'),
      ),
    ],
    clearances: (item) => [
      sideZone(item.width, item.depth, {
        id: 'cot-access',
        reason: 'No room to reach into the cot',
        reach: 500,
        side: 'right',
      }),
    ],
  },

  {
    kind: 'bedside-table',
    label: 'Bedside table',
    category: 'sleeping',
    rooms: ['bedroom'],
    defaults: { width: 450, depth: 400, height: 550, elevation: 0, mount: 'floor' },
    presets: [
      { name: 'Narrow — 40 cm', width: 400, depth: 350, height: 500 },
      { name: 'Standard — 45 cm', width: 450, depth: 400, height: 550 },
      { name: 'Wide — 60 cm', width: 600, depth: 450, height: 600 },
    ],
    fields: [{ key: 'drawers', label: 'Drawers', kind: 'count', min: 0, max: 4 }],
    params: { drawers: 2 },
    plan: (item) => {
      const drawers = numberParam(item, 'drawers', 2);
      const inset = 50;
      return shape(rect(item.width, item.depth), {
        strokes: Array.from({ length: drawers }, (_, index) =>
          outlineRect(
            0,
            -item.depth / 2 + inset + ((index + 0.5) * (item.depth - inset * 2)) / drawers,
            item.width - inset * 2,
            (item.depth - inset * 2) / drawers - 20,
            { weight: 'hairline' },
          ),
        ),
      });
    },
    solid: (item) => [box(0, 0, 0, size3(item.width, item.depth, item.height), 'carcass')],
    clearances: (item) =>
      numberParam(item, 'drawers', 2) > 0
        ? [
            frontZone(item.width, item.depth, {
              id: 'bedside-drawer',
              reason: 'No room to open the drawers',
              depth: 500,
            }),
          ]
        : [],
  },

  {
    kind: 'chest-of-drawers',
    label: 'Chest of drawers',
    category: 'storage',
    rooms: ['bedroom'],
    defaults: { width: 900, depth: 450, height: 850, elevation: 0, mount: 'floor' },
    presets: [
      { name: '3 drawers — 80 cm', width: 800, depth: 450, height: 750 },
      { name: '4 drawers — 90 cm', width: 900, depth: 450, height: 950 },
      { name: '6 drawers — 120 cm', width: 1200, depth: 450, height: 850 },
    ],
    fields: [{ key: 'drawers', label: 'Drawers', kind: 'count', min: 1, max: 8 }],
    params: { drawers: 4 },
    plan: (item) => {
      const drawers = numberParam(item, 'drawers', 4);
      return shape(rect(item.width, item.depth), {
        strokes: [
          // Drawer fronts read as a stack of lines across the front face.
          ...Array.from({ length: Math.max(1, drawers) }, (_, index) =>
            line(
              -item.width / 2 + 40,
              item.depth / 2 - 40 - (index * 30) / Math.max(1, drawers - 1 || 1),
              item.width / 2 - 40,
              item.depth / 2 - 40 - (index * 30) / Math.max(1, drawers - 1 || 1),
              { weight: 'hairline' },
            ),
          ),
        ],
      });
    },
    solid: (item) => [box(0, 0, 0, size3(item.width, item.depth, item.height), 'carcass')],
    clearances: (item) => [
      frontZone(item.width, item.depth, {
        id: 'drawer-pull',
        reason: 'No room to pull the drawers out',
        // A drawer is roughly as deep as its carcass, plus somewhere to stand.
        depth: Math.max(600, item.depth + 150),
        severity: 'error',
      }),
    ],
  },

  {
    kind: 'dressing-table',
    label: 'Dressing table',
    category: 'sleeping',
    rooms: ['bedroom'],
    // Height to the top of the mirror, which is the whole object; the table
    // itself is a parameter under it.
    defaults: { width: 1000, depth: 450, height: 1450, elevation: 0, mount: 'floor' },
    presets: [{ name: 'Standard — 100 cm', width: 1000, depth: 450, height: 1450 }],
    fields: [{ key: 'surfaceHeight', label: 'Table height', kind: 'length', min: 600, max: 900 }],
    params: { surfaceHeight: 750 },
    plan: (item) =>
      shape(rect(item.width, item.depth), {
        strokes: [
          // The mirror, against the back.
          line(-item.width / 2, -item.depth / 2 + 30, item.width / 2, -item.depth / 2 + 30, {
            weight: 'heavy',
          }),
        ],
      }),
    solid: (item) => {
      const surface = Math.min(item.height - 100, numberParam(item, 'surfaceHeight', 750));
      return [
        box(0, 0, surface - 40, size3(item.width, item.depth, 40), 'surface'),
        ...[-1, 1].map((side) =>
          box((side * (item.width - 80)) / 2, 0, 0, size3(80, item.depth, surface - 40), 'carcass'),
        ),
        // The mirror, filling everything above the table.
        box(
          0,
          -item.depth / 2 + 20,
          surface,
          size3(item.width * 0.7, 30, item.height - surface),
          'glass',
        ),
      ];
    },
    clearances: (item) => [
      frontZone(item.width, item.depth, {
        id: 'dressing-stool',
        reason: 'No room to sit at the dressing table',
        depth: 700,
      }),
    ],
  },
];

/** Exported for the clearance rules, which quote the figure back to the user. */
export const BED_ACCESS_CLEARANCE = BED_ACCESS;
