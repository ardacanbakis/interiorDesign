/**
 * The catalogue.
 *
 * One flat registry assembled from the per-category files. Adding a piece of
 * furniture is adding an entry to one of those files — nothing here, and
 * nothing in the renderer, has to know it exists.
 */

import { type RoomType } from '../graph/roomIdentity.ts';
import { type Item } from '../model/schema.ts';
import { BATH_DEFINITIONS } from './defs/bath.ts';
import { FIXTURE_DEFINITIONS } from './defs/fixtures.ts';
import { KITCHEN_DEFINITIONS } from './defs/kitchen.ts';
import { SEATING_DEFINITIONS } from './defs/seating.ts';
import { SLEEPING_DEFINITIONS } from './defs/sleeping.ts';
import { STORAGE_DEFINITIONS } from './defs/storage.ts';
import { SURFACE_DEFINITIONS } from './defs/surfaces.ts';
import {
  type ItemCategory,
  type ItemDefinition,
  ITEM_CATEGORIES,
  type PlanShape,
  type SolidPart,
  type ClearanceZone,
} from './types.ts';

const ALL: readonly ItemDefinition[] = [
  ...SLEEPING_DEFINITIONS,
  ...SEATING_DEFINITIONS,
  ...STORAGE_DEFINITIONS,
  ...SURFACE_DEFINITIONS,
  ...KITCHEN_DEFINITIONS,
  ...BATH_DEFINITIONS,
  ...FIXTURE_DEFINITIONS,
];

const BY_KIND = new Map<string, ItemDefinition>(ALL.map((entry) => [entry.kind, entry]));

// A duplicated kind would silently shadow another object in the catalogue, and
// the one that lost would simply never appear. Cheaper to find at start-up.
if (BY_KIND.size !== ALL.length) {
  const seen = new Set<string>();
  const duplicates = ALL.map((entry) => entry.kind).filter((kind) => {
    if (seen.has(kind)) return true;
    seen.add(kind);
    return false;
  });
  throw new Error(`Duplicate catalogue kinds: ${[...new Set(duplicates)].join(', ')}`);
}

export const CATALOG: readonly ItemDefinition[] = ALL;

export function findDefinition(kind: string): ItemDefinition | null {
  return BY_KIND.get(kind) ?? null;
}

/**
 * Look up a definition, throwing if it is missing.
 *
 * A document referencing an unknown kind is either corrupt or from a newer
 * version, and both are caught at load; by the time anything is being drawn the
 * kind is known to exist.
 */
export function getDefinition(kind: string): ItemDefinition {
  const definition = BY_KIND.get(kind);
  if (!definition) throw new Error(`Unknown catalogue item "${kind}"`);
  return definition;
}

export function definitionsInCategory(category: ItemCategory): ItemDefinition[] {
  return CATALOG.filter((entry) => entry.category === category);
}

/**
 * The catalogue, ordered for a given room.
 *
 * Things belonging to that room come first, then everything else — filtered
 * rather than restricted, because a desk in a bedroom and a bookshelf in a
 * kitchen are both perfectly ordinary and a catalogue that hides them is
 * merely annoying.
 */
export function definitionsForRoom(roomType: RoomType | null): ItemDefinition[] {
  if (!roomType) return [...CATALOG];

  const relevant: ItemDefinition[] = [];
  const rest: ItemDefinition[] = [];

  for (const entry of CATALOG) {
    // An empty `rooms` list means "belongs everywhere" — radiators, sockets.
    if (entry.rooms.length === 0 || entry.rooms.includes(roomType)) relevant.push(entry);
    else rest.push(entry);
  }

  return [...relevant, ...rest];
}

/** Categories that actually have something in them, in display order. */
export function populatedCategories(
  definitions: readonly ItemDefinition[] = CATALOG,
): ItemCategory[] {
  const present = new Set(definitions.map((entry) => entry.category));
  return ITEM_CATEGORIES.filter((category) => present.has(category));
}

// ---------------------------------------------------------------------------
// Deriving from an item
// ---------------------------------------------------------------------------

export function planShapeOf(item: Item): PlanShape {
  return getDefinition(item.kind).plan(item);
}

export function solidOf(item: Item): SolidPart[] {
  return getDefinition(item.kind).solid(item);
}

export function clearancesOf(item: Item): ClearanceZone[] {
  return getDefinition(item.kind).clearances(item);
}

/**
 * A new item of a given kind, at a point.
 *
 * Starts from the definition's defaults and its declared parameters, so an
 * object is never placed half-configured.
 */
export function createItem(kind: string, id: string, x: number, y: number, rotation = 0): Item {
  const definition = getDefinition(kind);

  return {
    id,
    kind,
    label: definition.label,
    x: Math.round(x),
    y: Math.round(y),
    rotation,
    width: definition.defaults.width,
    depth: definition.defaults.depth,
    height: definition.defaults.height,
    elevation: definition.defaults.elevation,
    mount: definition.defaults.mount,
    params: { ...definition.params },
  };
}
