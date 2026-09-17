/**
 * Bathrooms.
 *
 * The smallest rooms and the tightest clearances, which is where the checking
 * engine earns its keep: a WC needs 200mm each side and 600mm in front, and a
 * bathroom that ignores either is one you cannot comfortably use even though
 * everything technically fits.
 */

import { box, ellipse, frontZone, outlineRect, rect, roundedRect, shape, size3 } from '../build.ts';
import { type ClearanceZone, type ItemDefinition } from '../types.ts';

/** Elbow room each side of a WC, and standing room in front. */
const WC_SIDE = 200;
const WC_FRONT = 600;

/** The cistern at the back of a close-coupled WC. */
const WC_CISTERN_DEPTH = 180;

/** Both sides of an item at once, as one zone. */
function surroundSides(
  width: number,
  depth: number,
  reach: number,
  id: string,
  reason: string,
): ClearanceZone {
  return {
    id,
    reason,
    polygon: rect(width + reach * 2, depth),
    severity: 'error',
    minimumBlockingHeight: 100,
  };
}

export const BATH_DEFINITIONS: readonly ItemDefinition[] = [
  {
    kind: 'wc',
    label: 'WC',
    category: 'bath',
    rooms: ['bathroom', 'wc'],
    defaults: { width: 380, depth: 680, height: 800, elevation: 0, mount: 'floor' },
    presets: [
      { name: 'Close-coupled', width: 380, depth: 680, height: 800 },
      { name: 'Compact', width: 360, depth: 600, height: 780 },
      { name: 'Wall-hung', width: 380, depth: 540, height: 400 },
    ],
    fields: [],
    params: {},
    plan: (item) =>
      shape(
        // The pan, rounded at the front; the cistern squared off at the back.
        roundedRect(item.width, item.depth, item.width / 2.4),
        {
          strokes: [
            outlineRect(0, -item.depth / 2 + WC_CISTERN_DEPTH / 2, item.width, WC_CISTERN_DEPTH, {
              weight: 'normal',
            }),
            {
              points: ellipse(item.width - 80, item.depth * 0.5).map((point) => ({
                x: point.x,
                y: point.y + item.depth * 0.14,
              })),
              closed: true,
              weight: 'hairline' as const,
            },
          ],
        },
      ),
    solid: (item) => {
      // A wall-hung pan has no cistern in front of it, so the pan runs the
      // whole stated depth less whatever cistern there is.
      const cistern = Math.min(WC_CISTERN_DEPTH, item.depth / 2);
      return [
        box(0, cistern / 2, 0, size3(item.width, item.depth - cistern, 400), 'surface'),
        box(
          0,
          -item.depth / 2 + cistern / 2,
          0,
          size3(item.width, cistern, item.height),
          'surface',
        ),
      ];
    },
    clearances: (item) => [
      surroundSides(
        item.width,
        item.depth,
        WC_SIDE,
        'wc-elbows',
        'Not enough room either side of the WC',
      ),
      frontZone(item.width, item.depth, {
        id: 'wc-front',
        reason: 'Not enough room in front of the WC',
        depth: WC_FRONT,
        severity: 'error',
      }),
    ],
  },

  {
    kind: 'basin',
    label: 'Basin',
    category: 'bath',
    rooms: ['bathroom', 'wc'],
    defaults: { width: 550, depth: 450, height: 850, elevation: 0, mount: 'wall' },
    presets: [
      { name: 'Cloakroom — 45 cm', width: 450, depth: 350, height: 850 },
      { name: 'Standard — 55 cm', width: 550, depth: 450, height: 850 },
      { name: 'Wide — 70 cm', width: 700, depth: 500, height: 850 },
    ],
    fields: [],
    params: {},
    plan: (item) =>
      shape(roundedRect(item.width, item.depth, 60), {
        // Wall-hung, so the floor under it is clear.
        voids: [rect(item.width, item.depth)],
        strokes: [
          {
            points: ellipse(item.width - 120, item.depth - 120),
            closed: true,
            weight: 'hairline' as const,
          },
        ],
      }),
    solid: (item) => [box(0, 0, item.height - 150, size3(item.width, item.depth, 150), 'surface')],
    clearances: (item) => [
      frontZone(item.width, item.depth, {
        id: 'basin-front',
        reason: 'Not enough room to stand at the basin',
        depth: 700,
        severity: 'error',
      }),
    ],
  },

  {
    kind: 'vanity-unit',
    label: 'Vanity unit',
    category: 'bath',
    rooms: ['bathroom'],
    defaults: { width: 800, depth: 460, height: 850, elevation: 0, mount: 'floor' },
    presets: [
      { name: '60 cm', width: 600, depth: 460, height: 850 },
      { name: '80 cm', width: 800, depth: 460, height: 850 },
      { name: '100 cm', width: 1000, depth: 500, height: 850 },
    ],
    fields: [],
    params: {},
    plan: (item) =>
      shape(rect(item.width, item.depth), {
        strokes: [
          {
            points: ellipse(item.width * 0.55, item.depth - 140),
            closed: true,
            weight: 'hairline' as const,
          },
          outlineRect(0, item.depth / 2 - 40, item.width - 60, 50, { weight: 'hairline' }),
        ],
      }),
    solid: (item) => [
      box(0, 0, 0, size3(item.width, item.depth, item.height - 60), 'carcass'),
      box(0, 0, item.height - 60, size3(item.width, item.depth, 60), 'surface'),
    ],
    clearances: (item) => [
      frontZone(item.width, item.depth, {
        id: 'vanity-front',
        reason: 'Not enough room to stand at the vanity unit',
        depth: 700,
        severity: 'error',
      }),
    ],
  },

  {
    kind: 'bath',
    label: 'Bath',
    category: 'bath',
    rooms: ['bathroom'],
    defaults: { width: 1700, depth: 700, height: 550, elevation: 0, mount: 'floor' },
    presets: [
      { name: 'Small — 150 × 70', width: 1500, depth: 700, height: 550 },
      { name: 'Standard — 170 × 70', width: 1700, depth: 700, height: 550 },
      { name: 'Large — 180 × 80', width: 1800, depth: 800, height: 550 },
    ],
    fields: [],
    params: {},
    plan: (item) =>
      shape(rect(item.width, item.depth), {
        strokes: [
          {
            points: roundedRect(item.width - 120, item.depth - 120, 120),
            closed: true,
            weight: 'normal' as const,
          },
        ],
      }),
    solid: (item) => [box(0, 0, 0, size3(item.width, item.depth, item.height), 'surface')],
    clearances: (item) => [
      frontZone(item.width, item.depth, {
        id: 'bath-access',
        reason: 'Not enough room to get into the bath',
        depth: 700,
        severity: 'error',
      }),
    ],
  },

  {
    kind: 'shower',
    label: 'Shower',
    category: 'bath',
    rooms: ['bathroom'],
    defaults: { width: 900, depth: 900, height: 2000, elevation: 0, mount: 'floor' },
    presets: [
      { name: 'Square — 80 × 80', width: 800, depth: 800, height: 2000 },
      { name: 'Square — 90 × 90', width: 900, depth: 900, height: 2000 },
      { name: 'Rectangular — 120 × 80', width: 1200, depth: 800, height: 2000 },
    ],
    fields: [],
    params: {},
    plan: (item) =>
      shape(rect(item.width, item.depth), {
        strokes: [
          // The tray, and the diagonal that says "this is a shower".
          outlineRect(0, 0, item.width - 60, item.depth - 60, { weight: 'normal' }),
          {
            points: [
              { x: -item.width / 2 + 40, y: -item.depth / 2 + 40 },
              { x: item.width / 2 - 40, y: item.depth / 2 - 40 },
            ],
            weight: 'hairline' as const,
          },
        ],
      }),
    solid: (item) => [
      box(0, 0, 0, size3(item.width, item.depth, 80), 'surface'),
      // The enclosure, as glass.
      box(0, item.depth / 2 - 20, 80, size3(item.width, 40, item.height - 80), 'glass'),
    ],
    clearances: (item) => [
      frontZone(item.width, item.depth, {
        id: 'shower-door',
        reason: 'Not enough room to open the shower and get in',
        depth: 700,
        severity: 'error',
      }),
    ],
  },

  {
    kind: 'towel-radiator',
    label: 'Towel radiator',
    category: 'bath',
    rooms: ['bathroom'],
    defaults: { width: 500, depth: 80, height: 1200, elevation: 200, mount: 'wall' },
    presets: [
      { name: '50 × 80', width: 500, depth: 80, height: 800 },
      { name: '50 × 120', width: 500, depth: 80, height: 1200 },
      { name: '60 × 150', width: 600, depth: 80, height: 1500 },
    ],
    fields: [],
    params: {},
    plan: (item) =>
      shape(rect(item.width, item.depth), {
        strokes: [
          {
            points: [
              { x: -item.width / 2, y: 0 },
              { x: item.width / 2, y: 0 },
            ],
            weight: 'hairline' as const,
          },
        ],
      }),
    solid: (item) => [box(0, 0, 0, size3(item.width, item.depth, item.height), 'metal')],
    clearances: (item) => [
      frontZone(item.width, item.depth, {
        id: 'towel-radiator-blocked',
        reason: 'The towel radiator is blocked',
        depth: 150,
        severity: 'warning',
        minimumBlockingHeight: 300,
      }),
    ],
  },

  {
    kind: 'washing-machine',
    label: 'Washing machine',
    category: 'appliances',
    rooms: ['bathroom', 'kitchen', 'utility'],
    defaults: { width: 600, depth: 600, height: 850, elevation: 0, mount: 'floor' },
    presets: [
      { name: 'Slim — 45 cm', width: 450, depth: 450, height: 850 },
      { name: 'Standard — 60 cm', width: 600, depth: 600, height: 850 },
    ],
    fields: [],
    params: {},
    plan: (item) =>
      shape(rect(item.width, item.depth), {
        strokes: [
          {
            points: ellipse(item.width * 0.6, item.depth * 0.6).map((point) => ({
              x: point.x,
              y: point.y + item.depth * 0.1,
            })),
            closed: true,
            weight: 'normal' as const,
          },
        ],
      }),
    solid: (item) => [box(0, 0, 0, size3(item.width, item.depth, item.height), 'appliance')],
    clearances: (item) => [
      frontZone(item.width, item.depth, {
        id: 'washer-door',
        reason: 'No room to open the washing machine door',
        depth: Math.max(900, item.depth + 300),
        severity: 'error',
      }),
    ],
  },
];
