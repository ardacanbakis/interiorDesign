/**
 * One table-driven test over the whole catalogue.
 *
 * The promise this project makes is that the numbers are true: if the plan says
 * a wardrobe is 600mm deep, it is 600mm deep, and moving it 610mm from the wall
 * really does leave a 10mm gap. An object whose drawn footprint or whose solid
 * disagreed with its own stated dimensions would break that promise quietly, in
 * a way no screenshot would reveal — so every definition is held to it here,
 * rather than each one being spot-checked by hand.
 *
 * Every check runs against the catalogue as a whole and reports *all* the
 * entries that fail, not just the first. Sixty objects is enough that "the
 * wardrobe is wrong" is much less useful than "these four are wrong, and how".
 */

import { describe, expect, it } from 'vitest';

import { area, boundingBox } from '../geometry/polygon.ts';
import { ROOM_TYPES } from '../graph/roomIdentity.ts';
import { ItemSchema, type Item } from '../model/schema.ts';
import {
  CATALOG,
  createItem,
  definitionsForRoom,
  definitionsInCategory,
  findDefinition,
  getDefinition,
  populatedCategories,
} from './registry.ts';
import { ITEM_CATEGORIES, type ItemDefinition, type SolidPart } from './types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run a check over every definition, collecting the failures.
 *
 * `expect(failures).toEqual([])` then prints every offending entry with its
 * reason, which is the difference between a five-second fix and a bisect.
 */
function sweep(check: (definition: ItemDefinition) => string | string[] | null): string[] {
  const failures: string[] = [];
  for (const definition of CATALOG) {
    const result = check(definition);
    if (result === null) continue;
    for (const reason of Array.isArray(result) ? result : [result]) {
      failures.push(`${definition.kind}: ${reason}`);
    }
  }
  return failures;
}

interface Box3 {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

function solidBounds(parts: readonly SolidPart[]): Box3 | null {
  if (parts.length === 0) return null;

  const bounds: Box3 = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  };

  for (const part of parts) {
    bounds.minX = Math.min(bounds.minX, part.centre.x - part.size.x / 2);
    bounds.maxX = Math.max(bounds.maxX, part.centre.x + part.size.x / 2);
    bounds.minY = Math.min(bounds.minY, part.centre.y - part.size.y / 2);
    bounds.maxY = Math.max(bounds.maxY, part.centre.y + part.size.y / 2);
    bounds.minZ = Math.min(bounds.minZ, part.centre.z - part.size.z / 2);
    bounds.maxZ = Math.max(bounds.maxZ, part.centre.z + part.size.z / 2);
  }

  return bounds;
}

/** Rounding slack. Nothing here should need more than a tenth of a millimetre. */
const SLACK = 0.1;

const near = (value: number, target: number) => Math.abs(value - target) <= SLACK;
const within = (value: number, limit: number) => value <= limit + SLACK;

function allFinite(points: readonly { x: number; y: number }[]): boolean {
  return points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

/** A definition's own item, at whatever size is being tested. */
function sample(definition: ItemDefinition, size?: Partial<Item>): Item {
  return { ...createItem(definition.kind, 'test', 0, 0), ...size };
}

/**
 * The sizes each definition is exercised at.
 *
 * Defaults and presets are the sizes a user actually gets, and are held to the
 * strict rule. The extremes are there because every dimension is editable, and
 * definitions describe their parts by subtraction — a size small enough to make
 * one of those subtractions negative must still produce a sane object.
 */
function sizes(definition: ItemDefinition): { label: string; item: Item }[] {
  return [
    { label: 'defaults', item: sample(definition) },
    ...definition.presets.map((preset) => ({
      label: `preset "${preset.name}"`,
      item: sample(definition, {
        width: preset.width,
        depth: preset.depth,
        height: preset.height,
      }),
    })),
  ];
}

const EXTREMES: { label: string; size: Pick<Item, 'width' | 'depth' | 'height'> }[] = [
  { label: 'shrunk', size: { width: 300, depth: 300, height: 300 } },
  { label: 'stretched', size: { width: 3000, depth: 2400, height: 2500 } },
];

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

describe('the catalogue', () => {
  it('holds enough objects to furnish a house', () => {
    // Not a number worth pinning exactly — but a catalogue that silently lost
    // half its entries to a bad merge should fail rather than look fine.
    expect(CATALOG.length).toBeGreaterThanOrEqual(50);
  });

  it('gives every entry a distinct kind', () => {
    const kinds = CATALOG.map((definition) => definition.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('names every entry in a form safe to store and to look up', () => {
    expect(
      sweep((definition) => {
        const problems: string[] = [];
        if (!/^[a-z][a-z0-9-]*$/.test(definition.kind)) {
          problems.push(`kind "${definition.kind}" is not lowercase kebab-case`);
        }
        if (definition.label.trim().length === 0) problems.push('has no label');
        if (!ITEM_CATEGORIES.includes(definition.category)) {
          problems.push(`unknown category "${definition.category}"`);
        }
        for (const room of definition.rooms) {
          if (!ROOM_TYPES.includes(room)) problems.push(`unknown room type "${room}"`);
        }
        return problems.length > 0 ? problems : null;
      }),
    ).toEqual([]);
  });

  it('starts every object at a real, whole-millimetre size', () => {
    expect(
      sweep((definition) => {
        const problems: string[] = [];
        const { width, depth, height, elevation } = definition.defaults;

        for (const [name, value] of [
          ['width', width],
          ['depth', depth],
          ['height', height],
        ] as const) {
          if (!Number.isInteger(value) || value <= 0) {
            problems.push(`${name} ${value} is not a positive whole number of millimetres`);
          }
        }
        if (!Number.isInteger(elevation) || elevation < 0) {
          problems.push(`elevation ${elevation} is not a whole number of millimetres`);
        }
        // A wall-mounted item at floor level is almost always a forgotten
        // elevation rather than a deliberate one.
        if (definition.defaults.mount === 'ceiling' && elevation === 0) {
          problems.push('is ceiling-mounted but sits at floor level');
        }

        for (const preset of definition.presets) {
          if (preset.width <= 0 || preset.depth <= 0 || preset.height <= 0) {
            problems.push(`preset "${preset.name}" has a non-positive dimension`);
          }
        }
        return problems.length > 0 ? problems : null;
      }),
    ).toEqual([]);
  });

  it('produces items the document schema accepts', () => {
    // The catalogue and the saved document are written independently; this is
    // what stops them drifting apart until a file fails to load.
    expect(
      sweep((definition) => {
        const parsed = ItemSchema.safeParse(createItem(definition.kind, 'item-1', 1200, 800));
        return parsed.success ? null : parsed.error.issues.map((issue) => issue.message).join('; ');
      }),
    ).toEqual([]);
  });

  it('places new items on whole millimetres', () => {
    const item = createItem('bed-double', 'item-1', 1200.4, 799.6);
    expect(item.x).toBe(1200);
    expect(item.y).toBe(800);
    expect(item.rotation).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Parameters
  // -------------------------------------------------------------------------

  it('declares a default for every editable field', () => {
    expect(
      sweep((definition) =>
        definition.fields
          .filter((field) => !(field.key in definition.params))
          .map((field) => `field "${field.key}" has no default in params`),
      ),
    ).toEqual([]);
  });

  it('exposes every parameter as an editable field', () => {
    // A parameter with no field is one the user can never reach, which makes it
    // a constant wearing a costume.
    expect(
      sweep((definition) => {
        const declared = new Set(definition.fields.map((field) => field.key));
        return Object.keys(definition.params)
          .filter((key) => !declared.has(key))
          .map((key) => `parameter "${key}" is not editable`);
      }),
    ).toEqual([]);
  });

  it('keeps every field default inside its own field', () => {
    expect(
      sweep((definition) => {
        const problems: string[] = [];

        for (const field of definition.fields) {
          const value = definition.params[field.key];

          switch (field.kind) {
            case 'choice': {
              const options = field.options ?? [];
              if (options.length === 0) {
                problems.push(`choice "${field.key}" offers nothing to choose`);
              } else if (!options.some((option) => option.value === value)) {
                problems.push(
                  `choice "${field.key}" defaults to "${String(value)}", not an option`,
                );
              }
              break;
            }
            case 'toggle':
              if (typeof value !== 'boolean') {
                problems.push(`toggle "${field.key}" defaults to a non-boolean`);
              }
              break;
            case 'count':
            case 'length': {
              if (typeof value !== 'number' || !Number.isFinite(value)) {
                problems.push(`${field.kind} "${field.key}" defaults to a non-number`);
                break;
              }
              if (field.min !== undefined && value < field.min) {
                problems.push(
                  `"${field.key}" defaults to ${value}, below its minimum ${field.min}`,
                );
              }
              if (field.max !== undefined && value > field.max) {
                problems.push(
                  `"${field.key}" defaults to ${value}, above its maximum ${field.max}`,
                );
              }
              if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
                problems.push(`"${field.key}" has a minimum above its maximum`);
              }
              break;
            }
          }
        }

        return problems.length > 0 ? problems : null;
      }),
    ).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // The plan symbol
  // -------------------------------------------------------------------------

  it('draws a footprint exactly the size the object claims to be', () => {
    expect(
      sweep((definition) => {
        const problems: string[] = [];

        for (const { label, item } of sizes(definition)) {
          const plan = definition.plan(item);

          if (plan.outline.length < 3) {
            problems.push(`${label}: footprint is not a polygon`);
            continue;
          }
          if (!allFinite(plan.outline)) {
            problems.push(`${label}: footprint has a non-finite point`);
            continue;
          }

          const box = boundingBox(plan.outline);
          const width = box.maxX - box.minX;
          const depth = box.maxY - box.minY;

          if (!near(width, item.width)) {
            problems.push(`${label}: footprint is ${width}mm wide, but claims ${item.width}mm`);
          }
          if (!near(depth, item.depth)) {
            problems.push(`${label}: footprint is ${depth}mm deep, but claims ${item.depth}mm`);
          }
          // Centred on the origin, because that is the point everything else —
          // rotation, snapping, the inspector's x and y — is measured from.
          if (!near(box.minX + box.maxX, 0) || !near(box.minY + box.maxY, 0)) {
            problems.push(`${label}: footprint is not centred on the item's origin`);
          }
        }

        return problems.length > 0 ? problems : null;
      }),
    ).toEqual([]);
  });

  it('keeps every void inside the footprint it is a void in', () => {
    expect(
      sweep((definition) => {
        const problems: string[] = [];

        for (const { label, item } of sizes(definition)) {
          for (const hole of definition.plan(item).voids) {
            if (hole.length < 3 || !allFinite(hole)) {
              problems.push(`${label}: void is not a polygon`);
              continue;
            }
            const box = boundingBox(hole);
            if (
              !within(box.maxX, item.width / 2) ||
              !within(-box.minX, item.width / 2) ||
              !within(box.maxY, item.depth / 2) ||
              !within(-box.minY, item.depth / 2)
            ) {
              problems.push(`${label}: void escapes the footprint`);
            }
          }
        }

        return problems.length > 0 ? problems : null;
      }),
    ).toEqual([]);
  });

  it('draws its detail at the same scale as itself', () => {
    // Strokes and arcs are allowed outside the footprint — an open wardrobe
    // door and its swing arc are the point of drawing them. What they are not
    // allowed to be is an order of magnitude out, which is what a centimetre
    // slipping into a millimetre model looks like.
    expect(
      sweep((definition) => {
        const problems: string[] = [];

        for (const { label, item } of sizes(definition)) {
          const plan = definition.plan(item);
          const reach = Math.max(item.width, item.depth);
          const limitX = item.width / 2 + reach;
          const limitY = item.depth / 2 + reach;

          for (const line of plan.strokes) {
            if (line.points.length < 2) {
              problems.push(`${label}: a stroke has fewer than two points`);
              continue;
            }
            if (!allFinite(line.points)) {
              problems.push(`${label}: a stroke has a non-finite point`);
              continue;
            }
            const box = boundingBox(line.points);
            if (
              !within(Math.max(box.maxX, -box.minX), limitX) ||
              !within(Math.max(box.maxY, -box.minY), limitY)
            ) {
              problems.push(`${label}: a stroke is drawn far outside the object`);
            }
          }

          for (const curve of plan.arcs) {
            if (!Number.isFinite(curve.radius) || curve.radius <= 0) {
              problems.push(`${label}: an arc has no radius`);
            } else if (curve.radius > reach) {
              problems.push(`${label}: an arc sweeps ${curve.radius}mm, wider than the object`);
            }
            if (!Number.isFinite(curve.startAngle) || !Number.isFinite(curve.endAngle)) {
              problems.push(`${label}: an arc has a non-finite angle`);
            }
          }
        }

        return problems.length > 0 ? problems : null;
      }),
    ).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // The solid
  // -------------------------------------------------------------------------

  it('builds a solid that fills its stated box and never exceeds it', () => {
    expect(
      sweep((definition) => {
        const problems: string[] = [];

        for (const { label, item } of sizes(definition)) {
          const parts = definition.solid(item);

          if (parts.length === 0) {
            problems.push(`${label}: has no solid`);
            continue;
          }

          const bad = parts.some(
            (part) =>
              part.size.x <= 0 ||
              part.size.y <= 0 ||
              part.size.z <= 0 ||
              !Number.isFinite(part.centre.x) ||
              !Number.isFinite(part.centre.y) ||
              !Number.isFinite(part.centre.z),
          );
          if (bad) {
            problems.push(`${label}: a solid part has a non-positive or non-finite dimension`);
            continue;
          }

          const bounds = solidBounds(parts);
          if (!bounds) continue;

          if (
            !within(bounds.maxX, item.width / 2) ||
            !within(-bounds.minX, item.width / 2) ||
            !within(bounds.maxY, item.depth / 2) ||
            !within(-bounds.minY, item.depth / 2)
          ) {
            problems.push(`${label}: the solid sticks out past the footprint`);
          }
          if (!near(bounds.maxX - bounds.minX, item.width)) {
            problems.push(
              `${label}: the solid is ${bounds.maxX - bounds.minX}mm wide, not ${item.width}mm`,
            );
          }
          if (!near(bounds.maxY - bounds.minY, item.depth)) {
            problems.push(
              `${label}: the solid is ${bounds.maxY - bounds.minY}mm deep, not ${item.depth}mm`,
            );
          }

          // `height` is the overall height of the object, measured from its own
          // base — the elevation is applied by whatever places it, so a
          // wall-hung basin's solid still tops out at its stated height.
          if (bounds.minZ < -SLACK) {
            problems.push(`${label}: the solid reaches below its own base`);
          }
          if (!near(bounds.maxZ, item.height)) {
            problems.push(`${label}: the solid stands ${bounds.maxZ}mm tall, not ${item.height}mm`);
          }
        }

        return problems.length > 0 ? problems : null;
      }),
    ).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Clearance
  // -------------------------------------------------------------------------

  it('describes every clearance zone it asks for', () => {
    expect(
      sweep((definition) => {
        const problems: string[] = [];

        for (const { label, item } of sizes(definition)) {
          const zones = definition.clearances(item);
          const ids = new Set<string>();

          for (const zone of zones) {
            if (ids.has(zone.id)) {
              // Two zones sharing an id are one row in the Issues panel, and
              // the second one is the one you never hear about.
              problems.push(`${label}: two clearance zones share the id "${zone.id}"`);
            }
            ids.add(zone.id);

            if (zone.id.trim().length === 0) problems.push(`${label}: a clearance zone has no id`);
            if (zone.reason.trim().length === 0) {
              problems.push(`${label}: clearance "${zone.id}" has nothing to tell the user`);
            }
            if (zone.polygon.length < 3 || !allFinite(zone.polygon)) {
              problems.push(`${label}: clearance "${zone.id}" is not a polygon`);
              continue;
            }
            if (area(zone.polygon) <= 0) {
              problems.push(`${label}: clearance "${zone.id}" encloses no space`);
            }
            if (!Number.isFinite(zone.minimumBlockingHeight) || zone.minimumBlockingHeight < 0) {
              problems.push(`${label}: clearance "${zone.id}" has a nonsense blocking height`);
            }
          }
        }

        return problems.length > 0 ? problems : null;
      }),
    ).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Resizing
  // -------------------------------------------------------------------------

  it('survives being resized to anything', () => {
    // Every dimension is editable, and definitions build their parts by
    // subtraction — "the carcass is the depth less the door". Shrink an object
    // far enough and those subtractions go negative. It need not look good at
    // 30cm; it must not produce NaN, an inside-out box, or a symbol larger than
    // the object it stands for.
    expect(
      sweep((definition) => {
        const problems: string[] = [];

        for (const { label, size } of EXTREMES) {
          const item = sample(definition, size);
          const plan = definition.plan(item);

          if (!allFinite(plan.outline) || plan.outline.length < 3) {
            problems.push(`${label}: footprint falls apart`);
          }
          if (plan.strokes.some((line) => !allFinite(line.points))) {
            problems.push(`${label}: a stroke falls apart`);
          }

          for (const part of definition.solid(item)) {
            if (part.size.x <= 0 || part.size.y <= 0 || part.size.z <= 0) {
              problems.push(`${label}: a solid part is inside out`);
              break;
            }
            if (
              !Number.isFinite(part.centre.x) ||
              !Number.isFinite(part.centre.y) ||
              !Number.isFinite(part.centre.z)
            ) {
              problems.push(`${label}: a solid part is nowhere`);
              break;
            }
          }

          for (const zone of definition.clearances(item)) {
            if (!allFinite(zone.polygon) || area(zone.polygon) <= 0) {
              problems.push(`${label}: clearance "${zone.id}" falls apart`);
            }
          }
        }

        return problems.length > 0 ? problems : null;
      }),
    ).toEqual([]);
  });

  it('answers the same way twice', () => {
    // Definitions are pure functions of an item. Anything cached or accumulated
    // between calls would show up here and nowhere else until it went wrong on
    // screen.
    expect(
      sweep((definition) => {
        const item = sample(definition);
        const problems: string[] = [];

        if (JSON.stringify(definition.plan(item)) !== JSON.stringify(definition.plan(item))) {
          problems.push('plan() is not pure');
        }
        if (JSON.stringify(definition.solid(item)) !== JSON.stringify(definition.solid(item))) {
          problems.push('solid() is not pure');
        }
        if (
          JSON.stringify(definition.clearances(item)) !==
          JSON.stringify(definition.clearances(item))
        ) {
          problems.push('clearances() is not pure');
        }

        return problems.length > 0 ? problems : null;
      }),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

describe('looking things up', () => {
  it('finds a definition by kind', () => {
    expect(findDefinition('bed-double')?.label).toBe('Double bed');
    expect(findDefinition('flying-carpet')).toBeNull();
  });

  it('throws rather than drawing an unknown kind', () => {
    // A document referencing a kind the catalogue does not have is corrupt or
    // from a newer version. Failing loudly beats rendering an invisible object.
    expect(() => getDefinition('flying-carpet')).toThrow(/flying-carpet/);
  });

  it('groups by category without losing anything', () => {
    const counted = ITEM_CATEGORIES.reduce(
      (total, category) => total + definitionsInCategory(category).length,
      0,
    );
    expect(counted).toBe(CATALOG.length);
  });

  it('only offers categories that have something in them', () => {
    const categories = populatedCategories();
    expect(categories.length).toBeGreaterThan(0);
    for (const category of categories) {
      expect(definitionsInCategory(category).length).toBeGreaterThan(0);
    }
    // In the catalogue's own order, so the panel does not reshuffle itself.
    expect(categories).toEqual(ITEM_CATEGORIES.filter((one) => categories.includes(one)));
  });

  it('puts a room’s own furniture first without hiding the rest', () => {
    const forBathroom = definitionsForRoom('bathroom');

    expect(forBathroom.length).toBe(CATALOG.length);
    expect(forBathroom[0]?.rooms.length === 0 || forBathroom[0]?.rooms.includes('bathroom')).toBe(
      true,
    );

    // A bookshelf in a bathroom is unusual, not forbidden — it is still there,
    // just not at the top.
    const bookshelf = forBathroom.findIndex((one) => one.kind === 'bookshelf');
    const wc = forBathroom.findIndex((one) => one.kind === 'wc');
    expect(wc).toBeGreaterThanOrEqual(0);
    expect(bookshelf).toBeGreaterThan(wc);
  });

  it('offers everything when no room is selected', () => {
    expect(definitionsForRoom(null).map((one) => one.kind)).toEqual(CATALOG.map((one) => one.kind));
  });
});
