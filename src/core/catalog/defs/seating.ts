/**
 * Things to sit on.
 *
 * A sofa faces +y, so its clearance is a front zone: the gap to the coffee
 * table, which is the one measurement people get wrong in a living room. Too
 * close and you cannot get past; too far and you cannot reach your tea.
 */

import { type Item } from '../../model/schema.ts';
import { box, ellipse, frontZone, outlineRect, rect, roundedRect, shape, size3 } from '../build.ts';
import { HEIGHTS, SOFA_PRESETS } from '../presets.tr.ts';
import { type ItemDefinition, numberParam, stringParam } from '../types.ts';

const ARM_WIDTH = 220;
const BACK_DEPTH = 220;

/**
 * A sofa: a back along -y, arms down each side, and seat cushions between.
 *
 * Drawn from its current dimensions rather than as a fixed symbol, so a 3-seat
 * sofa stretched to 2.6m grows a fourth cushion instead of three stretched
 * ones.
 */
function sofaPlan(item: Item) {
  const arms = stringParam(item, 'arms', 'both');
  const leftArm = arms === 'both' || arms === 'left';
  const rightArm = arms === 'both' || arms === 'right';

  const innerLeft = -item.width / 2 + (leftArm ? ARM_WIDTH : 0);
  const innerRight = item.width / 2 - (rightArm ? ARM_WIDTH : 0);
  const seatDepth = item.depth - BACK_DEPTH;
  const seatWidth = innerRight - innerLeft;

  // About 600mm per seat, so the cushion count follows the width.
  const seats = Math.max(1, Math.round(seatWidth / 600));
  const cushionWidth = seatWidth / seats;

  return shape(roundedRect(item.width, item.depth, 80), {
    strokes: [
      // The back.
      outlineRect(0, -item.depth / 2 + BACK_DEPTH / 2, item.width, BACK_DEPTH, {
        weight: 'heavy',
      }),
      ...(leftArm
        ? [
            outlineRect(-item.width / 2 + ARM_WIDTH / 2, BACK_DEPTH / 2, ARM_WIDTH, seatDepth, {
              weight: 'normal',
            }),
          ]
        : []),
      ...(rightArm
        ? [
            outlineRect(item.width / 2 - ARM_WIDTH / 2, BACK_DEPTH / 2, ARM_WIDTH, seatDepth, {
              weight: 'normal',
            }),
          ]
        : []),
      ...Array.from({ length: seats }, (_, index) =>
        outlineRect(
          innerLeft + cushionWidth * (index + 0.5),
          BACK_DEPTH / 2,
          cushionWidth - 30,
          seatDepth - 40,
          { weight: 'hairline' },
        ),
      ),
    ],
  });
}

function sofaSolid(item: Item) {
  const arms = stringParam(item, 'arms', 'both');
  const backHeight = numberParam(item, 'backHeight', 850);
  const seatDepth = item.depth - BACK_DEPTH;

  const parts = [
    // Seat base.
    box(0, BACK_DEPTH / 2, 0, size3(item.width, seatDepth, HEIGHTS.seat), 'soft'),
    // Back.
    box(0, -item.depth / 2 + BACK_DEPTH / 2, 0, size3(item.width, BACK_DEPTH, backHeight), 'soft'),
  ];

  const armHeight = Math.min(backHeight - 100, 650);
  if (arms === 'both' || arms === 'left') {
    parts.push(
      box(
        -item.width / 2 + ARM_WIDTH / 2,
        BACK_DEPTH / 2,
        0,
        size3(ARM_WIDTH, seatDepth, armHeight),
        'soft',
      ),
    );
  }
  if (arms === 'both' || arms === 'right') {
    parts.push(
      box(
        item.width / 2 - ARM_WIDTH / 2,
        BACK_DEPTH / 2,
        0,
        size3(ARM_WIDTH, seatDepth, armHeight),
        'soft',
      ),
    );
  }

  return parts;
}

const ARM_OPTIONS = [
  { value: 'both', label: 'Both arms' },
  { value: 'left', label: 'Left arm only' },
  { value: 'right', label: 'Right arm only' },
  { value: 'none', label: 'Armless' },
];

function sofa(kind: string, label: string, width: number, depth: number): ItemDefinition {
  return {
    kind,
    label,
    category: 'seating',
    rooms: ['living'],
    defaults: { width, depth, height: 850, elevation: 0, mount: 'floor' },
    presets: SOFA_PRESETS,
    fields: [
      { key: 'arms', label: 'Arms', kind: 'choice', options: ARM_OPTIONS },
      { key: 'backHeight', label: 'Back height', kind: 'length', min: 500, max: 1200 },
    ],
    params: { arms: 'both', backHeight: 850 },
    plan: sofaPlan,
    solid: sofaSolid,
    clearances: (item) => [
      frontZone(item.width, item.depth, {
        id: 'sofa-legroom',
        reason: 'No legroom in front of the sofa',
        depth: 400,
        severity: 'error',
      }),
    ],
  };
}

export const SEATING_DEFINITIONS: readonly ItemDefinition[] = [
  sofa('sofa-2', '2-seat sofa', 1600, 900),
  sofa('sofa-3', '3-seat sofa', 2100, 950),

  {
    kind: 'sofa-corner',
    label: 'Corner sofa',
    category: 'seating',
    rooms: ['living'],
    defaults: { width: 2600, depth: 1900, height: 850, elevation: 0, mount: 'floor' },
    presets: [
      { name: 'Compact — 240 × 170', width: 2400, depth: 1700, height: 850 },
      { name: 'Standard — 260 × 190', width: 2600, depth: 1900, height: 850 },
      { name: 'Large — 300 × 210', width: 3000, depth: 2100, height: 850 },
    ],
    fields: [
      {
        key: 'chaise',
        label: 'Chaise on the',
        kind: 'choice',
        options: [
          { value: 'right', label: 'Right' },
          { value: 'left', label: 'Left' },
        ],
      },
    ],
    params: { chaise: 'right' },
    plan: (item) => {
      const chaise = stringParam(item, 'chaise', 'right');
      const mainDepth = 950;
      const chaiseWidth = 900;
      const sign = chaise === 'right' ? 1 : -1;

      // An L drawn as the union of two rectangles: the run along the back, and
      // the chaise coming forward off one end.
      const halfWidth = item.width / 2;
      const halfDepth = item.depth / 2;
      const outline =
        sign === 1
          ? [
              { x: -halfWidth, y: -halfDepth },
              { x: halfWidth, y: -halfDepth },
              { x: halfWidth, y: halfDepth },
              { x: halfWidth - chaiseWidth, y: halfDepth },
              { x: halfWidth - chaiseWidth, y: -halfDepth + mainDepth },
              { x: -halfWidth, y: -halfDepth + mainDepth },
            ]
          : [
              { x: -halfWidth, y: -halfDepth },
              { x: halfWidth, y: -halfDepth },
              { x: halfWidth, y: -halfDepth + mainDepth },
              { x: -halfWidth + chaiseWidth, y: -halfDepth + mainDepth },
              { x: -halfWidth + chaiseWidth, y: halfDepth },
              { x: -halfWidth, y: halfDepth },
            ];

      return shape(outline, {
        strokes: [
          outlineRect(0, -item.depth / 2 + BACK_DEPTH / 2, item.width, BACK_DEPTH, {
            weight: 'heavy',
          }),
        ],
      });
    },
    solid: (item) => {
      const chaise = stringParam(item, 'chaise', 'right');
      const mainDepth = 950;
      const chaiseWidth = 900;
      const sign = chaise === 'right' ? 1 : -1;

      return [
        box(
          0,
          -item.depth / 2 + mainDepth / 2,
          0,
          size3(item.width, mainDepth, HEIGHTS.seat),
          'soft',
        ),
        box(
          (sign * (item.width - chaiseWidth)) / 2,
          0,
          0,
          size3(chaiseWidth, item.depth, HEIGHTS.seat),
          'soft',
        ),
        box(
          0,
          -item.depth / 2 + BACK_DEPTH / 2,
          0,
          size3(item.width, BACK_DEPTH, item.height),
          'soft',
        ),
      ];
    },
    clearances: (item) => [
      frontZone(item.width, item.depth, {
        id: 'sofa-legroom',
        reason: 'No room to get past the corner sofa',
        depth: 400,
        severity: 'error',
      }),
    ],
  },

  {
    kind: 'armchair',
    label: 'Armchair',
    category: 'seating',
    rooms: ['living', 'bedroom', 'office'],
    defaults: { width: 850, depth: 850, height: 850, elevation: 0, mount: 'floor' },
    presets: [
      { name: 'Compact — 75 cm', width: 750, depth: 800, height: 800 },
      { name: 'Standard — 85 cm', width: 850, depth: 850, height: 850 },
      { name: 'Wide — 100 cm', width: 1000, depth: 950, height: 900 },
    ],
    fields: [],
    params: {},
    plan: (item) =>
      shape(roundedRect(item.width, item.depth, 100), {
        strokes: [
          outlineRect(0, -item.depth / 2 + BACK_DEPTH / 2, item.width, BACK_DEPTH, {
            weight: 'heavy',
          }),
          outlineRect(0, BACK_DEPTH / 2, item.width - ARM_WIDTH * 2, item.depth - BACK_DEPTH - 40, {
            weight: 'hairline',
          }),
        ],
      }),
    solid: (item) => [
      box(0, 0, 0, size3(item.width, item.depth, HEIGHTS.seat), 'soft'),
      box(
        0,
        -item.depth / 2 + BACK_DEPTH / 2,
        0,
        size3(item.width, BACK_DEPTH, item.height),
        'soft',
      ),
    ],
    clearances: (item) => [
      frontZone(item.width, item.depth, {
        id: 'chair-legroom',
        reason: 'No legroom in front of the chair',
        depth: 400,
      }),
    ],
  },

  {
    kind: 'dining-chair',
    label: 'Dining chair',
    category: 'seating',
    rooms: ['dining', 'kitchen', 'office'],
    defaults: { width: 450, depth: 500, height: 900, elevation: 0, mount: 'floor' },
    presets: [{ name: 'Standard — 45 cm', width: 450, depth: 500, height: 900 }],
    fields: [],
    params: {},
    plan: (item) =>
      shape(roundedRect(item.width, item.depth, 40), {
        strokes: [
          // The back, at -y.
          outlineRect(0, -item.depth / 2 + 40, item.width, 60, { weight: 'heavy' }),
        ],
      }),
    solid: (item) => [
      box(0, 0, HEIGHTS.seat - 40, size3(item.width, item.depth, 40), 'carcass'),
      box(
        0,
        -item.depth / 2 + 30,
        HEIGHTS.seat,
        size3(item.width, 50, item.height - HEIGHTS.seat),
        'carcass',
      ),
      ...[-1, 1].flatMap((sx) =>
        [-1, 1].map((sy) =>
          box(
            (sx * (item.width - 60)) / 2,
            (sy * (item.depth - 60)) / 2,
            0,
            size3(40, 40, HEIGHTS.seat - 40),
            'carcass',
          ),
        ),
      ),
    ],
    clearances: (item) => [
      // Pulling a chair out to sit down is the clearance people forget, and it
      // is the reason a dining table in a narrow room does not work.
      {
        id: 'chair-pullout',
        reason: 'No room to pull the chair out and sit down',
        polygon: rect(item.width + 100, item.depth + 900).map((point) => ({
          x: point.x,
          y: point.y - 450,
        })),
        severity: 'warning',
        minimumBlockingHeight: 100,
      },
    ],
  },

  {
    kind: 'stool',
    label: 'Stool',
    category: 'seating',
    rooms: ['kitchen', 'dining', 'bedroom'],
    defaults: { width: 380, depth: 380, height: 650, elevation: 0, mount: 'floor' },
    presets: [
      { name: 'Low — 45 cm', width: 380, depth: 380, height: 450 },
      { name: 'Bar — 65 cm', width: 380, depth: 380, height: 650 },
      { name: 'Tall — 75 cm', width: 380, depth: 380, height: 750 },
    ],
    fields: [],
    params: {},
    plan: (item) => shape(ellipse(item.width, item.depth)),
    solid: (item) => [
      box(0, 0, item.height - 40, size3(item.width, item.depth, 40), 'carcass'),
      box(0, 0, 0, size3(item.width * 0.3, item.depth * 0.3, item.height - 40), 'metal'),
    ],
    clearances: () => [],
  },

  {
    kind: 'bench',
    label: 'Bench',
    category: 'seating',
    rooms: ['hall', 'dining', 'bedroom'],
    defaults: { width: 1200, depth: 400, height: 450, elevation: 0, mount: 'floor' },
    presets: [
      { name: 'Small — 90 cm', width: 900, depth: 350, height: 450 },
      { name: 'Standard — 120 cm', width: 1200, depth: 400, height: 450 },
    ],
    fields: [],
    params: {},
    plan: (item) => shape(rect(item.width, item.depth)),
    solid: (item) => [
      box(0, 0, item.height - 50, size3(item.width, item.depth, 50), 'carcass'),
      ...[-1, 1].map((side) =>
        box(
          (side * (item.width - 80)) / 2,
          0,
          0,
          size3(60, item.depth, item.height - 50),
          'carcass',
        ),
      ),
    ],
    clearances: (item) => [
      frontZone(item.width, item.depth, {
        id: 'bench-legroom',
        reason: 'No room to sit on the bench',
        depth: 500,
      }),
    ],
  },
];
