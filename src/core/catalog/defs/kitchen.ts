/**
 * Kitchen units and what goes in them.
 *
 * Loose objects rather than cabinet runs, for now. Each unit snaps to walls and
 * to its neighbours, so a run can be built by placing modules end to end; what
 * is missing is the run as a thing in its own right, with a worktop generated
 * over it. That is a container of these objects rather than a different kind of
 * object, so adding it later changes nothing here.
 */

import { type Item } from '../../model/schema.ts';
import { box, ellipse, frontZone, line, outlineRect, rect, shape, size3 } from '../build.ts';
import { BASE_UNIT_PRESETS, FRIDGE_PRESETS, KITCHEN, WALL_UNIT_PRESETS } from '../presets.tr.ts';
import { type ItemDefinition, type MaterialKey, numberParam } from '../types.ts';

/** Somewhere to stand and open a kitchen unit. */
const WORKING_CLEARANCE = 900;

/**
 * A carcass with a worktop over it.
 *
 * The unit's stated depth is the worktop's, so the carcass sits back from the
 * front by the overhang rather than the worktop sticking out past the number
 * the user typed.
 */
function worktopUnit(item: Item, worktop: MaterialKey) {
  const overhang = KITCHEN.worktopOverhang;
  return [
    box(
      0,
      -overhang / 2,
      0,
      size3(item.width, item.depth - overhang, item.height - KITCHEN.worktopThickness),
      'carcass',
    ),
    box(
      0,
      0,
      item.height - KITCHEN.worktopThickness,
      size3(item.width, item.depth, KITCHEN.worktopThickness),
      worktop,
    ),
  ];
}

/** An appliance door swings its own depth, plus room for the person. */
function applianceClearance(item: Item, id: string, reason: string) {
  return frontZone(item.width, item.depth, {
    id,
    reason,
    depth: Math.max(WORKING_CLEARANCE, item.depth + 300),
    severity: 'error',
  });
}

export const KITCHEN_DEFINITIONS: readonly ItemDefinition[] = [
  {
    kind: 'base-unit',
    label: 'Base unit',
    category: 'kitchen',
    rooms: ['kitchen'],
    defaults: {
      width: 600,
      depth: KITCHEN.baseDepth,
      height: KITCHEN.baseHeight,
      elevation: 0,
      mount: 'floor',
    },
    presets: BASE_UNIT_PRESETS,
    fields: [
      {
        key: 'front',
        label: 'Front',
        kind: 'choice',
        options: [
          { value: 'door', label: 'Door' },
          { value: 'drawers', label: 'Drawers' },
        ],
      },
    ],
    params: { front: 'door' },
    plan: (item) =>
      shape(rect(item.width, item.depth), {
        strokes: [
          // The worktop overhangs the carcass at the front.
          line(
            -item.width / 2,
            item.depth / 2 - KITCHEN.worktopOverhang,
            item.width / 2,
            item.depth / 2 - KITCHEN.worktopOverhang,
            {
              weight: 'normal',
            },
          ),
          outlineRect(0, item.depth / 2 - 60, item.width - 40, 60, { weight: 'hairline' }),
        ],
      }),
    solid: (item) => worktopUnit(item, 'surface'),
    clearances: (item) => [
      frontZone(item.width, item.depth, {
        id: 'kitchen-working',
        reason: 'No room to stand and work at the units',
        depth: WORKING_CLEARANCE,
        severity: 'error',
      }),
    ],
  },

  {
    kind: 'wall-unit',
    label: 'Wall unit',
    category: 'kitchen',
    rooms: ['kitchen'],
    defaults: {
      width: 600,
      depth: KITCHEN.wallDepth,
      height: KITCHEN.wallHeight,
      elevation: KITCHEN.wallElevation,
      mount: 'wall',
    },
    presets: WALL_UNIT_PRESETS,
    fields: [],
    params: {},
    plan: (item) =>
      // Above the worktop, so nothing standing on the floor is blocked by it —
      // drawn as an outline and excluded from floor-level overlap.
      shape(rect(item.width, item.depth), {
        voids: [rect(item.width, item.depth)],
        strokes: [
          outlineRect(0, 0, item.width, item.depth, {
            weight: 'hairline',
            closed: true,
            dashed: true,
          }),
        ],
      }),
    solid: (item) => [box(0, 0, 0, size3(item.width, item.depth, item.height), 'carcass')],
    clearances: () => [],
  },

  {
    kind: 'tall-unit',
    label: 'Tall unit',
    category: 'kitchen',
    rooms: ['kitchen'],
    defaults: {
      width: 600,
      depth: KITCHEN.baseDepth,
      height: KITCHEN.tallHeight,
      elevation: 0,
      mount: 'floor',
    },
    presets: [
      { name: '50 cm', width: 500, depth: KITCHEN.baseDepth, height: KITCHEN.tallHeight },
      { name: '60 cm', width: 600, depth: KITCHEN.baseDepth, height: KITCHEN.tallHeight },
    ],
    fields: [],
    params: {},
    plan: (item) =>
      shape(rect(item.width, item.depth), {
        strokes: [outlineRect(0, item.depth / 2 - 40, item.width - 40, 40, { weight: 'hairline' })],
      }),
    solid: (item) => [box(0, 0, 0, size3(item.width, item.depth, item.height), 'carcass')],
    clearances: (item) => [
      frontZone(item.width, item.depth, {
        id: 'tall-unit-door',
        reason: 'No room to open the tall unit',
        depth: WORKING_CLEARANCE,
        severity: 'error',
      }),
    ],
  },

  {
    kind: 'sink',
    label: 'Sink',
    category: 'kitchen',
    rooms: ['kitchen'],
    defaults: {
      width: 800,
      depth: KITCHEN.baseDepth,
      height: KITCHEN.baseHeight,
      elevation: 0,
      mount: 'floor',
    },
    presets: [
      {
        name: 'Single bowl — 60 cm',
        width: 600,
        depth: KITCHEN.baseDepth,
        height: KITCHEN.baseHeight,
      },
      {
        name: 'Bowl and drainer — 80 cm',
        width: 800,
        depth: KITCHEN.baseDepth,
        height: KITCHEN.baseHeight,
      },
      {
        name: 'Double bowl — 100 cm',
        width: 1000,
        depth: KITCHEN.baseDepth,
        height: KITCHEN.baseHeight,
      },
    ],
    fields: [],
    params: {},
    plan: (item) =>
      shape(rect(item.width, item.depth), {
        strokes: [
          outlineRect(-item.width / 4, 0, item.width / 2 - 60, item.depth - 140, {
            weight: 'normal',
          }),
          // The drainer, grooved.
          ...[0, 1, 2].map((groove) =>
            line(
              item.width / 4 - 60 + groove * 60,
              -item.depth / 2 + 90,
              item.width / 4 - 60 + groove * 60,
              item.depth / 2 - 70,
              { weight: 'hairline' },
            ),
          ),
        ],
      }),
    solid: (item) => worktopUnit(item, 'metal'),
    clearances: (item) => [
      frontZone(item.width, item.depth, {
        id: 'sink-working',
        reason: 'No room to stand at the sink',
        depth: WORKING_CLEARANCE,
        severity: 'error',
      }),
    ],
  },

  {
    kind: 'hob',
    label: 'Hob',
    category: 'kitchen',
    rooms: ['kitchen'],
    defaults: {
      width: 600,
      depth: KITCHEN.baseDepth,
      height: KITCHEN.baseHeight,
      elevation: 0,
      mount: 'floor',
    },
    presets: [
      {
        name: '4 burners — 60 cm',
        width: 600,
        depth: KITCHEN.baseDepth,
        height: KITCHEN.baseHeight,
      },
      {
        name: '5 burners — 90 cm',
        width: 900,
        depth: KITCHEN.baseDepth,
        height: KITCHEN.baseHeight,
      },
    ],
    fields: [{ key: 'burners', label: 'Burners', kind: 'count', min: 1, max: 6 }],
    params: { burners: 4 },
    plan: (item) => {
      const burners = Math.max(1, Math.round(numberParam(item, 'burners', 4)));
      const columns = Math.ceil(burners / 2);
      const rows = burners > columns ? 2 : 1;
      const radius = Math.min(item.width / (columns * 3), item.depth / (rows * 3));

      const rings = [];
      for (let index = 0; index < burners; index++) {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const cx = -item.width / 2 + (item.width * (column + 0.5)) / columns;
        const cy = -item.depth / 2 + (item.depth * (row + 0.5)) / rows;
        rings.push({
          points: ellipse(radius * 2, radius * 2).map((point) => ({
            x: point.x + cx,
            y: point.y + cy,
          })),
          closed: true,
          weight: 'hairline' as const,
        });
      }

      return shape(rect(item.width, item.depth), { strokes: rings });
    },
    solid: (item) => [
      box(
        0,
        0,
        0,
        size3(item.width, item.depth, item.height - KITCHEN.worktopThickness),
        'appliance',
      ),
      box(
        0,
        0,
        item.height - KITCHEN.worktopThickness,
        size3(item.width, item.depth, KITCHEN.worktopThickness),
        'glass',
      ),
    ],
    clearances: (item) => [
      frontZone(item.width, item.depth, {
        id: 'hob-working',
        reason: 'No room to stand at the hob',
        depth: WORKING_CLEARANCE,
        severity: 'error',
      }),
    ],
  },

  {
    kind: 'oven',
    label: 'Oven',
    category: 'kitchen',
    rooms: ['kitchen'],
    defaults: { width: 600, depth: 580, height: 600, elevation: 0, mount: 'floor' },
    presets: [
      { name: 'Built-under — 60 cm', width: 600, depth: 580, height: 600 },
      { name: 'Built-in tall — 60 cm', width: 600, depth: 580, height: 600 },
    ],
    fields: [],
    params: {},
    plan: (item) =>
      shape(rect(item.width, item.depth), {
        strokes: [outlineRect(0, item.depth / 2 - 50, item.width - 60, 60, { weight: 'normal' })],
      }),
    solid: (item) => [box(0, 0, 0, size3(item.width, item.depth, item.height), 'appliance')],
    clearances: (item) => [applianceClearance(item, 'oven-door', 'No room to open the oven door')],
  },

  {
    kind: 'extractor',
    label: 'Extractor hood',
    category: 'kitchen',
    rooms: ['kitchen'],
    defaults: { width: 600, depth: 500, height: 150, elevation: 1500, mount: 'wall' },
    presets: [
      { name: '60 cm', width: 600, depth: 500, height: 150 },
      { name: '90 cm', width: 900, depth: 500, height: 150 },
    ],
    fields: [],
    params: {},
    plan: (item) =>
      shape(rect(item.width, item.depth), {
        voids: [rect(item.width, item.depth)],
        strokes: [
          outlineRect(0, 0, item.width, item.depth, {
            weight: 'hairline',
            closed: true,
            dashed: true,
          }),
        ],
      }),
    solid: (item) => [box(0, 0, 0, size3(item.width, item.depth, item.height), 'metal')],
    clearances: () => [],
  },

  {
    kind: 'fridge',
    label: 'Fridge',
    category: 'appliances',
    rooms: ['kitchen'],
    defaults: { width: 600, depth: 650, height: 1850, elevation: 0, mount: 'floor' },
    presets: FRIDGE_PRESETS,
    fields: [],
    params: {},
    plan: (item) =>
      shape(rect(item.width, item.depth), {
        strokes: [
          line(-item.width / 2, item.depth / 2 - 40, item.width / 2, item.depth / 2 - 40, {
            weight: 'normal',
          }),
        ],
      }),
    solid: (item) => [box(0, 0, 0, size3(item.width, item.depth, item.height), 'appliance')],
    clearances: (item) => [
      applianceClearance(item, 'fridge-door', 'No room to open the fridge door'),
    ],
  },

  {
    kind: 'dishwasher',
    label: 'Dishwasher',
    category: 'appliances',
    rooms: ['kitchen'],
    defaults: {
      width: 600,
      depth: KITCHEN.baseDepth,
      height: KITCHEN.baseHeight,
      elevation: 0,
      mount: 'floor',
    },
    presets: [
      {
        name: 'Slimline — 45 cm',
        width: 450,
        depth: KITCHEN.baseDepth,
        height: KITCHEN.baseHeight,
      },
      {
        name: 'Standard — 60 cm',
        width: 600,
        depth: KITCHEN.baseDepth,
        height: KITCHEN.baseHeight,
      },
    ],
    fields: [],
    params: {},
    plan: (item) =>
      shape(rect(item.width, item.depth), {
        strokes: [outlineRect(0, item.depth / 2 - 40, item.width - 60, 50, { weight: 'normal' })],
      }),
    solid: (item) => [box(0, 0, 0, size3(item.width, item.depth, item.height), 'appliance')],
    clearances: (item) => [
      applianceClearance(item, 'dishwasher-door', 'No room to open the dishwasher'),
    ],
  },
];
