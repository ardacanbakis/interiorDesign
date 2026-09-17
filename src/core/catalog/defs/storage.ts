/**
 * Cupboards, shelves and the things that open.
 *
 * Storage is where clearance matters most and is noticed least. A wardrobe that
 * fits an alcove exactly is useless if its doors cannot open, and a hinged door
 * needs its own width in front of it — which for a 4-door wardrobe is more
 * floor than the wardrobe itself occupies.
 */

import { type Item } from '../../model/schema.ts';
import { arc, box, frontZone, line, outlineRect, rect, shape, size3 } from '../build.ts';
import { WARDROBE_PRESETS } from '../presets.tr.ts';
import { type ItemDefinition, numberParam, stringParam } from '../types.ts';
import { vec2 } from '../../geometry/vec2.ts';

/** Space needed in front of a hinged door, as a fraction of the leaf width. */
const HINGED_SWING_FACTOR = 1;

/** Sliding doors need only somewhere to stand. */
const SLIDING_CLEARANCE = 600;

/** A door leaf, as thick as one actually is. */
const DOOR_THICKNESS = 20;

const DOOR_TYPE_OPTIONS = [
  { value: 'hinged', label: 'Hinged' },
  { value: 'sliding', label: 'Sliding' },
];

/**
 * A wardrobe, drawn with its doors.
 *
 * Hinged doors get a swing arc each, which is the whole reason to draw them:
 * the arcs are the honest picture of how much of the room the wardrobe really
 * uses. Sliding doors get an arrow instead, because they use none.
 */
function wardrobePlan(item: Item) {
  const doorType = stringParam(item, 'doorType', 'hinged');
  const doorCount = Math.max(1, Math.round(numberParam(item, 'doors', defaultDoors(item.width))));
  const doorWidth = item.width / doorCount;
  const front = item.depth / 2;

  if (doorType === 'sliding') {
    return shape(rect(item.width, item.depth), {
      strokes: [
        line(-item.width / 2, front - 60, item.width / 2, front - 60, { weight: 'normal' }),
        // Two overlapping panels, offset, reading as "these slide past".
        line(-item.width / 2, front - 110, 0, front - 110, { weight: 'hairline' }),
        line(0, front - 30, item.width / 2, front - 30, { weight: 'hairline' }),
      ],
    });
  }

  const strokes = [];
  const arcs = [];

  for (let index = 0; index < doorCount; index++) {
    const left = -item.width / 2 + doorWidth * index;
    // Doors hinge at alternate ends, as a pair of doors does.
    const hingeAtLeft = index % 2 === 0;
    const hinge = vec2(hingeAtLeft ? left : left + doorWidth, front);

    // Open leaf, standing square to the wardrobe.
    strokes.push(
      line(hinge.x, hinge.y, hinge.x, hinge.y + doorWidth, { weight: 'normal' }),
      // The door's closed position, along the front face.
      line(left, front, left + doorWidth, front, { weight: 'hairline' }),
    );

    arcs.push(
      hingeAtLeft
        ? arc(hinge, doorWidth, 0, Math.PI / 2)
        : arc(hinge, doorWidth, Math.PI / 2, Math.PI),
    );
  }

  return shape(rect(item.width, item.depth), { strokes, arcs });
}

/** A door per 500mm or so, which is how wardrobes are actually built. */
function defaultDoors(width: number): number {
  return Math.max(1, Math.round(width / 500));
}

export const STORAGE_DEFINITIONS: readonly ItemDefinition[] = [
  {
    kind: 'wardrobe',
    label: 'Wardrobe',
    category: 'storage',
    rooms: ['bedroom'],
    defaults: { width: 1500, depth: 600, height: 2100, elevation: 0, mount: 'floor' },
    presets: WARDROBE_PRESETS,
    fields: [
      { key: 'doorType', label: 'Doors', kind: 'choice', options: DOOR_TYPE_OPTIONS },
      {
        key: 'doors',
        label: 'Number of doors',
        kind: 'count',
        min: 1,
        max: 8,
        hint: 'Each hinged door needs its own width of clear floor in front.',
      },
    ],
    params: { doorType: 'hinged', doors: 3 },
    plan: wardrobePlan,
    solid: (item) => [
      // The doors are proud of the carcass, both inside the stated depth: a
      // 60cm wardrobe measures 60cm from the wall to the door face, not 62.
      box(
        0,
        -DOOR_THICKNESS / 2,
        0,
        size3(item.width, item.depth - DOOR_THICKNESS, item.height),
        'carcass',
      ),
      box(
        0,
        item.depth / 2 - DOOR_THICKNESS / 2,
        0,
        size3(item.width, DOOR_THICKNESS, item.height),
        'surface',
      ),
    ],
    clearances: (item) => {
      const doorType = stringParam(item, 'doorType', 'hinged');
      const doorCount = Math.max(
        1,
        Math.round(numberParam(item, 'doors', defaultDoors(item.width))),
      );

      if (doorType === 'sliding') {
        return [
          frontZone(item.width, item.depth, {
            id: 'wardrobe-sliding',
            reason: 'No room to stand at the wardrobe',
            depth: SLIDING_CLEARANCE,
          }),
        ];
      }

      // A hinged leaf sweeps its own width, so the clearance follows the door
      // size rather than the wardrobe size — four narrow doors need much less
      // room than two wide ones.
      return [
        frontZone(item.width, item.depth, {
          id: 'wardrobe-swing',
          reason: 'Not enough room for the wardrobe doors to open',
          depth: (item.width / doorCount) * HINGED_SWING_FACTOR,
          severity: 'error',
        }),
      ];
    },
  },

  {
    kind: 'bookshelf',
    label: 'Bookshelf',
    category: 'storage',
    rooms: ['living', 'office', 'bedroom'],
    defaults: { width: 800, depth: 300, height: 1800, elevation: 0, mount: 'floor' },
    presets: [
      { name: 'Narrow — 60 cm', width: 600, depth: 280, height: 1800 },
      { name: 'Standard — 80 cm', width: 800, depth: 300, height: 1800 },
      { name: 'Tall — 80 × 220', width: 800, depth: 300, height: 2200 },
    ],
    fields: [{ key: 'shelves', label: 'Shelves', kind: 'count', min: 1, max: 10 }],
    params: { shelves: 5 },
    plan: (item) =>
      shape(rect(item.width, item.depth), {
        strokes: [
          line(-item.width / 2, item.depth / 2 - 40, item.width / 2, item.depth / 2 - 40, {
            weight: 'hairline',
          }),
        ],
      }),
    solid: (item) => {
      const shelves = Math.max(1, Math.round(numberParam(item, 'shelves', 5)));
      const spacing = item.height / shelves;
      return [
        ...[-1, 1].map((side) =>
          box((side * (item.width - 25)) / 2, 0, 0, size3(25, item.depth, item.height), 'carcass'),
        ),
        ...Array.from({ length: shelves + 1 }, (_, index) =>
          box(
            0,
            0,
            Math.min(item.height - 25, index * spacing),
            size3(item.width, item.depth, 25),
            'carcass',
          ),
        ),
      ];
    },
    clearances: (item) => [
      frontZone(item.width, item.depth, {
        id: 'shelf-reach',
        reason: 'No room to stand and reach the shelves',
        depth: 600,
      }),
    ],
  },

  {
    kind: 'sideboard',
    label: 'Sideboard',
    category: 'storage',
    rooms: ['living', 'dining'],
    defaults: { width: 1600, depth: 450, height: 800, elevation: 0, mount: 'floor' },
    presets: [
      { name: 'Small — 120 cm', width: 1200, depth: 420, height: 750 },
      { name: 'Standard — 160 cm', width: 1600, depth: 450, height: 800 },
      { name: 'Long — 200 cm', width: 2000, depth: 450, height: 800 },
    ],
    fields: [{ key: 'doors', label: 'Doors', kind: 'count', min: 1, max: 6 }],
    params: { doors: 3 },
    plan: (item) => {
      const doors = Math.max(1, Math.round(numberParam(item, 'doors', 3)));
      const doorWidth = item.width / doors;
      return shape(rect(item.width, item.depth), {
        strokes: Array.from({ length: doors }, (_, index) =>
          outlineRect(
            -item.width / 2 + doorWidth * (index + 0.5),
            item.depth / 2 - 30,
            doorWidth - 20,
            40,
            { weight: 'hairline' },
          ),
        ),
      });
    },
    solid: (item) => [box(0, 0, 0, size3(item.width, item.depth, item.height), 'carcass')],
    clearances: (item) => [
      frontZone(item.width, item.depth, {
        id: 'sideboard-doors',
        reason: 'No room to open the sideboard',
        depth: 700,
      }),
    ],
  },

  {
    kind: 'shoe-rack',
    label: 'Shoe rack',
    category: 'storage',
    rooms: ['hall', 'bedroom'],
    defaults: { width: 800, depth: 300, height: 900, elevation: 0, mount: 'floor' },
    presets: [{ name: 'Standard — 80 cm', width: 800, depth: 300, height: 900 }],
    fields: [],
    params: {},
    plan: (item) => shape(rect(item.width, item.depth)),
    solid: (item) => [box(0, 0, 0, size3(item.width, item.depth, item.height), 'carcass')],
    clearances: (item) => [
      frontZone(item.width, item.depth, {
        id: 'shoe-rack-reach',
        reason: 'No room to stand at the shoe rack',
        depth: 600,
      }),
    ],
  },

  {
    kind: 'wall-shelf',
    label: 'Wall shelf',
    category: 'storage',
    rooms: [],
    defaults: { width: 800, depth: 250, height: 40, elevation: 1400, mount: 'wall' },
    presets: [
      { name: 'Short — 60 cm', width: 600, depth: 220, height: 40 },
      { name: 'Standard — 80 cm', width: 800, depth: 250, height: 40 },
      { name: 'Long — 120 cm', width: 1200, depth: 250, height: 40 },
    ],
    fields: [],
    params: {},
    plan: (item) =>
      // Drawn as an outline rather than a fill: it is above head height and
      // nothing on the floor below it is blocked by it.
      shape(rect(item.width, item.depth), {
        voids: [rect(item.width, item.depth)],
        strokes: [outlineRect(0, 0, item.width, item.depth, { weight: 'hairline', closed: true })],
      }),
    solid: (item) => [box(0, 0, 0, size3(item.width, item.depth, item.height), 'surface')],
    clearances: () => [],
  },
];
