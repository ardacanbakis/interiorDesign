/**
 * Tables and desks.
 *
 * A dining table's clearance is the chairs around it — which is why the zone is
 * on all four sides rather than in front. A table that fits a room with 400mm
 * to spare does not fit it at all once anyone sits down.
 */

import { type Item } from '../../model/schema.ts';
import { box, ellipse, frontZone, outlineRect, rect, shape, size3 } from '../build.ts';
import { DINING_TABLE_PRESETS } from '../presets.tr.ts';
import { type ClearanceZone, type ItemDefinition, numberParam } from '../types.ts';

/** Room to pull a chair out and sit at a table. */
const SEATING_CLEARANCE = 900;

/** A ring of clearance right around an item, for tables people sit at. */
function surroundZone(item: Item, id: string, reason: string, reach: number): ClearanceZone {
  return {
    id,
    reason,
    polygon: rect(item.width + reach * 2, item.depth + reach * 2),
    severity: 'warning',
    minimumBlockingHeight: 200,
  };
}

/** Four legs, inset from the corners. */
function legs(item: Item, legSize = 70) {
  const height = Math.max(0, item.height - 40);
  return [-1, 1].flatMap((sx) =>
    [-1, 1].map((sy) =>
      box(
        (sx * (item.width - legSize * 2 - 60)) / 2,
        (sy * (item.depth - legSize * 2 - 60)) / 2,
        0,
        size3(legSize, legSize, height),
        'carcass',
      ),
    ),
  );
}

export const SURFACE_DEFINITIONS: readonly ItemDefinition[] = [
  {
    kind: 'dining-table',
    label: 'Dining table',
    category: 'surfaces',
    rooms: ['dining', 'kitchen', 'living'],
    defaults: { width: 1600, depth: 900, height: 750, elevation: 0, mount: 'floor' },
    presets: DINING_TABLE_PRESETS,
    fields: [
      {
        key: 'seats',
        label: 'Seats',
        kind: 'count',
        min: 2,
        max: 12,
        hint: 'Used for the clearance ring, not drawn.',
      },
    ],
    params: { seats: 6 },
    plan: (item) =>
      shape(rect(item.width, item.depth), {
        strokes: [outlineRect(0, 0, item.width - 120, item.depth - 120, { weight: 'hairline' })],
      }),
    solid: (item) => [
      box(0, 0, item.height - 40, size3(item.width, item.depth, 40), 'surface'),
      ...legs(item),
    ],
    clearances: (item) => [
      surroundZone(
        item,
        'dining-seating',
        'No room to pull chairs out around the table',
        SEATING_CLEARANCE,
      ),
    ],
  },

  {
    kind: 'dining-table-round',
    label: 'Round dining table',
    category: 'surfaces',
    rooms: ['dining', 'kitchen'],
    defaults: { width: 1200, depth: 1200, height: 750, elevation: 0, mount: 'floor' },
    presets: [
      { name: '4 people — Ø100', width: 1000, depth: 1000, height: 750 },
      { name: '4–6 people — Ø120', width: 1200, depth: 1200, height: 750 },
      { name: '6–8 people — Ø140', width: 1400, depth: 1400, height: 750 },
    ],
    fields: [{ key: 'seats', label: 'Seats', kind: 'count', min: 2, max: 10 }],
    params: { seats: 4 },
    plan: (item) => shape(ellipse(item.width, item.depth)),
    solid: (item) => [
      box(0, 0, item.height - 40, size3(item.width, item.depth, 40), 'surface'),
      box(0, 0, 0, size3(item.width * 0.25, item.depth * 0.25, item.height - 40), 'carcass'),
    ],
    clearances: (item) => [
      surroundZone(
        item,
        'dining-seating',
        'No room to pull chairs out around the table',
        SEATING_CLEARANCE,
      ),
    ],
  },

  {
    kind: 'coffee-table',
    label: 'Coffee table',
    category: 'surfaces',
    rooms: ['living'],
    defaults: { width: 1100, depth: 600, height: 420, elevation: 0, mount: 'floor' },
    presets: [
      { name: 'Small — 90 × 50', width: 900, depth: 500, height: 400 },
      { name: 'Standard — 110 × 60', width: 1100, depth: 600, height: 420 },
      { name: 'Large — 130 × 70', width: 1300, depth: 700, height: 420 },
    ],
    fields: [],
    params: {},
    plan: (item) =>
      shape(rect(item.width, item.depth), {
        strokes: [outlineRect(0, 0, item.width - 80, item.depth - 80, { weight: 'hairline' })],
      }),
    solid: (item) => [
      box(0, 0, item.height - 40, size3(item.width, item.depth, 40), 'surface'),
      ...legs(item, 60),
    ],
    clearances: (item) => [
      // A coffee table is low enough to step over, so the rule is about getting
      // round it rather than about reaching it.
      surroundZone(item, 'coffee-table-walkway', 'No room to get round the coffee table', 400),
    ],
  },

  {
    kind: 'desk',
    label: 'Desk',
    category: 'surfaces',
    rooms: ['office', 'bedroom'],
    defaults: { width: 1400, depth: 700, height: 750, elevation: 0, mount: 'floor' },
    presets: [
      { name: 'Compact — 120 × 60', width: 1200, depth: 600, height: 750 },
      { name: 'Standard — 140 × 70', width: 1400, depth: 700, height: 750 },
      { name: 'Large — 180 × 80', width: 1800, depth: 800, height: 750 },
    ],
    fields: [],
    params: {},
    plan: (item) =>
      shape(rect(item.width, item.depth), {
        strokes: [outlineRect(0, 0, item.width - 100, item.depth - 100, { weight: 'hairline' })],
      }),
    solid: (item) => [
      box(0, 0, item.height - 40, size3(item.width, item.depth, 40), 'surface'),
      ...legs(item),
    ],
    clearances: (item) => [
      frontZone(item.width, item.depth, {
        id: 'desk-chair',
        reason: 'No room for a chair at the desk',
        depth: 900,
        severity: 'error',
      }),
    ],
  },

  {
    kind: 'console-table',
    label: 'Console table',
    category: 'surfaces',
    rooms: ['hall', 'living'],
    defaults: { width: 1100, depth: 350, height: 800, elevation: 0, mount: 'floor' },
    presets: [
      { name: 'Narrow — 90 cm', width: 900, depth: 300, height: 800 },
      { name: 'Standard — 110 cm', width: 1100, depth: 350, height: 800 },
    ],
    fields: [],
    params: {},
    plan: (item) => shape(rect(item.width, item.depth)),
    solid: (item) => [
      box(0, 0, item.height - 40, size3(item.width, item.depth, 40), 'surface'),
      ...legs(item, 50),
    ],
    clearances: () => [],
  },

  {
    kind: 'tv-stand',
    label: 'TV stand',
    category: 'surfaces',
    rooms: ['living', 'bedroom'],
    defaults: { width: 1600, depth: 400, height: 500, elevation: 0, mount: 'floor' },
    presets: [
      { name: 'Small — 120 cm', width: 1200, depth: 400, height: 450 },
      { name: 'Standard — 160 cm', width: 1600, depth: 400, height: 500 },
      { name: 'Wide — 200 cm', width: 2000, depth: 450, height: 500 },
    ],
    fields: [{ key: 'doors', label: 'Doors', kind: 'count', min: 0, max: 4 }],
    params: { doors: 2 },
    plan: (item) => {
      const doors = Math.max(0, Math.round(numberParam(item, 'doors', 2)));
      const doorWidth = doors > 0 ? item.width / doors : 0;
      return shape(rect(item.width, item.depth), {
        strokes: Array.from({ length: doors }, (_, index) =>
          outlineRect(
            -item.width / 2 + doorWidth * (index + 0.5),
            item.depth / 2 - 25,
            doorWidth - 20,
            30,
            { weight: 'hairline' },
          ),
        ),
      });
    },
    solid: (item) => [box(0, 0, 0, size3(item.width, item.depth, item.height), 'carcass')],
    clearances: (item) => [
      frontZone(item.width, item.depth, {
        id: 'tv-stand-access',
        reason: 'No room to reach the TV stand',
        depth: 500,
      }),
    ],
  },
];
