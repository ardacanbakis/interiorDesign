/**
 * The things that come with the room rather than being brought into it.
 *
 * Radiators, sockets, switches and lights. Small, easy to forget when planning,
 * and the cause of most "the wardrobe does not quite go there" discoveries —
 * which is exactly why they are worth putting on the plan.
 */

import { box, ellipse, frontZone, line, outlineRect, rect, shape, size3 } from '../build.ts';
import { HEIGHTS, RADIATOR_PRESETS, TV_PRESETS } from '../presets.tr.ts';
import { type ItemDefinition, numberParam } from '../types.ts';

export const FIXTURE_DEFINITIONS: readonly ItemDefinition[] = [
  {
    kind: 'radiator',
    label: 'Radiator',
    category: 'fixtures',
    rooms: [],
    defaults: { width: 1000, depth: 100, height: 600, elevation: 150, mount: 'wall' },
    presets: RADIATOR_PRESETS,
    fields: [{ key: 'fins', label: 'Fins', kind: 'count', min: 2, max: 40 }],
    params: { fins: 12 },
    plan: (item) => {
      const fins = Math.max(2, Math.round(numberParam(item, 'fins', 12)));
      const spacing = item.width / fins;
      return shape(rect(item.width, item.depth), {
        strokes: Array.from({ length: fins }, (_, index) =>
          line(
            -item.width / 2 + spacing * (index + 0.5),
            -item.depth / 2,
            -item.width / 2 + spacing * (index + 0.5),
            item.depth / 2,
            { weight: 'hairline' },
          ),
        ),
      });
    },
    solid: (item) => [box(0, 0, 0, size3(item.width, item.depth, item.height), 'metal')],
    clearances: (item) => [
      // A radiator with a sofa in front of it heats the sofa. The zone is
      // shallow because the problem is contact, not access; the height
      // threshold is what stops a rug from triggering it.
      frontZone(item.width, item.depth, {
        id: 'radiator-blocked',
        reason: 'This radiator is blocked and will not heat the room',
        depth: 150,
        severity: 'warning',
        minimumBlockingHeight: 300,
      }),
    ],
  },

  {
    kind: 'socket',
    label: 'Socket',
    category: 'fixtures',
    rooms: [],
    defaults: { width: 85, depth: 40, height: 85, elevation: HEIGHTS.socket, mount: 'wall' },
    presets: [
      { name: 'Single', width: 85, depth: 40, height: 85 },
      { name: 'Double', width: 150, depth: 40, height: 85 },
    ],
    fields: [],
    params: {},
    plan: (item) =>
      shape(rect(item.width, item.depth), {
        strokes: [outlineRect(0, 0, item.width, item.depth, { weight: 'hairline', closed: true })],
      }),
    solid: (item) => [box(0, 0, 0, size3(item.width, item.depth, item.height), 'surface')],
    clearances: (item) => [
      frontZone(item.width, item.depth, {
        id: 'socket-blocked',
        reason: 'This socket is behind furniture',
        depth: 100,
        width: item.width + 200,
        severity: 'warning',
        minimumBlockingHeight: 500,
      }),
    ],
  },

  {
    kind: 'switch',
    label: 'Light switch',
    category: 'fixtures',
    rooms: [],
    defaults: { width: 85, depth: 40, height: 85, elevation: HEIGHTS.switch, mount: 'wall' },
    presets: [{ name: 'Single', width: 85, depth: 40, height: 85 }],
    fields: [],
    params: {},
    plan: (item) =>
      shape(rect(item.width, item.depth), {
        strokes: [outlineRect(0, 0, item.width, item.depth, { weight: 'hairline', closed: true })],
      }),
    solid: (item) => [box(0, 0, 0, size3(item.width, item.depth, item.height), 'surface')],
    clearances: () => [],
  },

  {
    kind: 'ceiling-light',
    label: 'Ceiling light',
    category: 'fixtures',
    rooms: [],
    defaults: { width: 400, depth: 400, height: 250, elevation: 2400, mount: 'ceiling' },
    presets: [
      { name: 'Pendant — 30 cm', width: 300, depth: 300, height: 400 },
      { name: 'Flush — 40 cm', width: 400, depth: 400, height: 120 },
    ],
    fields: [],
    params: {},
    plan: (item) =>
      shape(ellipse(item.width, item.depth), {
        // Overhead, so nothing on the floor is blocked by it.
        voids: [ellipse(item.width, item.depth)],
        strokes: [
          { points: ellipse(item.width, item.depth), closed: true, weight: 'hairline' as const },
          line(-item.width / 2, 0, item.width / 2, 0, { weight: 'hairline' }),
          line(0, -item.depth / 2, 0, item.depth / 2, { weight: 'hairline' }),
        ],
      }),
    solid: (item) => [box(0, 0, 0, size3(item.width, item.depth, item.height), 'surface')],
    clearances: () => [],
  },

  {
    kind: 'tv-wall',
    label: 'TV (wall-mounted)',
    category: 'appliances',
    rooms: ['living', 'bedroom'],
    defaults: { width: 1240, depth: 80, height: 720, elevation: HEIGHTS.tvCentre, mount: 'wall' },
    presets: TV_PRESETS,
    fields: [],
    params: {},
    plan: (item) =>
      shape(rect(item.width, item.depth), {
        voids: [rect(item.width, item.depth)],
        strokes: [outlineRect(0, 0, item.width, item.depth, { weight: 'normal', closed: true })],
      }),
    solid: (item) => [box(0, 0, 0, size3(item.width, item.depth, item.height), 'appliance')],
    clearances: () => [],
  },

  {
    kind: 'column',
    label: 'Column',
    category: 'fixtures',
    rooms: [],
    defaults: { width: 400, depth: 400, height: 2700, elevation: 0, mount: 'floor' },
    presets: [
      { name: 'Square — 40 cm', width: 400, depth: 400, height: 2700 },
      { name: 'Square — 50 cm', width: 500, depth: 500, height: 2700 },
    ],
    fields: [],
    params: {},
    plan: (item) => shape(rect(item.width, item.depth)),
    solid: (item) => [box(0, 0, 0, size3(item.width, item.depth, item.height), 'carcass')],
    clearances: () => [],
  },

  {
    kind: 'curtain',
    label: 'Curtains',
    category: 'soft',
    rooms: [],
    defaults: { width: 1600, depth: 150, height: 2400, elevation: 200, mount: 'wall' },
    presets: [
      { name: 'Window — 140 cm', width: 1400, depth: 150, height: 2200 },
      { name: 'Wide — 200 cm', width: 2000, depth: 150, height: 2400 },
    ],
    fields: [],
    params: {},
    plan: (item) =>
      shape(rect(item.width, item.depth), {
        voids: [rect(item.width, item.depth)],
        strokes: [
          // A wavy line, which is how curtains are drawn on a plan.
          {
            points: Array.from({ length: 17 }, (_, index) => ({
              x: -item.width / 2 + (item.width * index) / 16,
              y: (index % 2 === 0 ? -1 : 1) * (item.depth / 2 - 10),
            })),
            weight: 'hairline' as const,
          },
        ],
      }),
    solid: (item) => [box(0, 0, 0, size3(item.width, item.depth, item.height), 'soft')],
    clearances: () => [],
  },

  {
    kind: 'rug',
    label: 'Rug',
    category: 'soft',
    rooms: [],
    defaults: { width: 2000, depth: 1400, height: 15, elevation: 0, mount: 'floor' },
    presets: [
      { name: '120 × 170', width: 1200, depth: 1700, height: 15 },
      { name: '160 × 230', width: 1600, depth: 2300, height: 15 },
      { name: '200 × 300', width: 2000, depth: 3000, height: 15 },
    ],
    fields: [],
    params: {},
    plan: (item) =>
      // A void as well as an outline: a rug is 15mm tall, so nothing is
      // "blocked" by it and furniture standing on it is not a collision.
      shape(rect(item.width, item.depth), {
        voids: [rect(item.width, item.depth)],
        strokes: [
          outlineRect(0, 0, item.width, item.depth, { weight: 'hairline', closed: true }),
          outlineRect(0, 0, item.width - 120, item.depth - 120, {
            weight: 'hairline',
            closed: true,
            dashed: true,
          }),
        ],
      }),
    solid: (item) => [box(0, 0, 0, size3(item.width, item.depth, item.height), 'soft')],
    clearances: () => [],
  },

  {
    kind: 'mirror',
    label: 'Mirror',
    category: 'soft',
    rooms: [],
    defaults: { width: 600, depth: 40, height: 900, elevation: 1000, mount: 'wall' },
    presets: [
      { name: 'Small — 50 × 70', width: 500, depth: 40, height: 700 },
      { name: 'Full length — 60 × 160', width: 600, depth: 40, height: 1600 },
    ],
    fields: [],
    params: {},
    plan: (item) =>
      shape(rect(item.width, item.depth), {
        voids: [rect(item.width, item.depth)],
        strokes: [outlineRect(0, 0, item.width, item.depth, { weight: 'normal', closed: true })],
      }),
    solid: (item) => [box(0, 0, 0, size3(item.width, item.depth, item.height), 'glass')],
    clearances: () => [],
  },

  {
    kind: 'boiler',
    label: 'Boiler',
    category: 'appliances',
    rooms: ['kitchen', 'bathroom', 'utility'],
    defaults: { width: 450, depth: 300, height: 750, elevation: 1200, mount: 'wall' },
    presets: [{ name: 'Combi — 45 cm', width: 450, depth: 300, height: 750 }],
    fields: [],
    params: {},
    plan: (item) =>
      shape(rect(item.width, item.depth), {
        voids: [rect(item.width, item.depth)],
        strokes: [outlineRect(0, 0, item.width, item.depth, { weight: 'normal', closed: true })],
      }),
    solid: (item) => [box(0, 0, 0, size3(item.width, item.depth, item.height), 'appliance')],
    clearances: () => [],
  },

  {
    kind: 'dryer',
    label: 'Tumble dryer',
    category: 'appliances',
    rooms: ['utility', 'bathroom', 'kitchen'],
    defaults: { width: 600, depth: 600, height: 850, elevation: 0, mount: 'floor' },
    presets: [{ name: 'Standard — 60 cm', width: 600, depth: 600, height: 850 }],
    fields: [],
    params: {},
    plan: (item) =>
      shape(rect(item.width, item.depth), {
        strokes: [
          {
            points: ellipse(item.width * 0.6, item.depth * 0.6),
            closed: true,
            weight: 'normal' as const,
          },
        ],
      }),
    solid: (item) => [box(0, 0, 0, size3(item.width, item.depth, item.height), 'appliance')],
    clearances: (item) => [
      frontZone(item.width, item.depth, {
        id: 'dryer-door',
        reason: 'No room to open the dryer door',
        depth: Math.max(900, item.depth + 300),
        severity: 'error',
      }),
    ],
  },
];
