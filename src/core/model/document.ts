/**
 * Creating and reading documents.
 *
 * Construction takes its id source and clock as arguments rather than reaching
 * for `crypto.randomUUID` and `Date.now` directly. That keeps this module pure
 * and, more usefully, makes every test that builds a document able to assert on
 * exact values instead of matching patterns.
 */

import { EMPTY_GRAPH, type WallGraph } from '../graph/wallGraph.ts';
import { type LengthUnit, type Mm } from '../units/length.ts';
import {
  CURRENT_SCHEMA_VERSION,
  type Floor,
  type FloorId,
  type HouseDocument,
  type Item,
  type Opening,
  type Stair,
} from './schema.ts';

/** Typical Turkish residential construction, and all editable afterwards. */
export const FLOOR_DEFAULTS = {
  ceilingHeight: 2700 as Mm,
  slabThickness: 150 as Mm,
} as const;

export interface CreateOptions {
  readonly id?: string;
  readonly name?: string;
  readonly unit?: LengthUnit;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

function defaultIdSource(): () => string {
  let counter = 0;
  const prefix =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return () => `${prefix}-${++counter}`;
}

/** A floor with nothing on it. */
export function createFloor(
  id: FloorId,
  level: number,
  name: string,
  overrides: Partial<Pick<Floor, 'ceilingHeight' | 'slabThickness' | 'elevation' | 'graph'>> = {},
): Floor {
  const ceilingHeight = overrides.ceilingHeight ?? FLOOR_DEFAULTS.ceilingHeight;
  const slabThickness = overrides.slabThickness ?? FLOOR_DEFAULTS.slabThickness;

  return {
    id,
    name,
    level,
    elevation: overrides.elevation ?? level * (ceilingHeight + slabThickness),
    ceilingHeight,
    slabThickness,
    graph: overrides.graph ?? EMPTY_GRAPH,
    rooms: [],
    openings: [],
    items: [],
    floorOpenings: [],
    outdoorAreas: [],
  };
}

/**
 * A new, empty house with a single ground floor.
 *
 * One floor rather than none because every house has at least one, and a plan
 * that opens onto nothing at all gives you nowhere to start drawing.
 */
export function createDocument(options: CreateOptions = {}): HouseDocument {
  const newId = options.newId ?? defaultIdSource();
  const now = (options.now ?? (() => new Date()))().toISOString();

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: options.id ?? newId(),
    name: options.name ?? 'Untitled house',
    unit: options.unit ?? 'cm',
    floors: [createFloor(newId(), 0, 'Ground floor')],
    stairs: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Default names for floors as they are added, above and below ground. */
export function defaultFloorName(level: number): string {
  if (level === 0) return 'Ground floor';
  if (level < 0) return level === -1 ? 'Basement' : `Basement ${-level}`;
  const ordinals = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh'];
  const ordinal = ordinals[level - 1];
  return ordinal ? `${ordinal} floor` : `Floor ${level}`;
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function findFloor(document: HouseDocument, floorId: FloorId): Floor | null {
  return document.floors.find((floor) => floor.id === floorId) ?? null;
}

/**
 * Look up a floor, throwing if it is missing. Used on paths where a dangling
 * id means the document is inconsistent rather than that the user did
 * something unusual.
 */
export function getFloor(document: HouseDocument, floorId: FloorId): Floor {
  const floor = findFloor(document, floorId);
  if (!floor) throw new Error(`Document is inconsistent: no floor "${floorId}"`);
  return floor;
}

/** Floors ordered from the bottom up. */
export function floorsByLevel(document: HouseDocument): Floor[] {
  return [...document.floors].sort((left, right) => left.level - right.level);
}

/** The floor directly below this one, if there is one. */
export function floorBelow(document: HouseDocument, floorId: FloorId): Floor | null {
  const floor = findFloor(document, floorId);
  if (!floor) return null;

  return (
    floorsByLevel(document)
      .filter((candidate) => candidate.level < floor.level)
      .pop() ?? null
  );
}

/** Floor-to-floor height: what a stair between two floors has to climb. */
export function floorToFloorHeight(floor: Floor): Mm {
  return floor.ceilingHeight + floor.slabThickness;
}

export function findOpening(floor: Floor, openingId: string): Opening | null {
  return floor.openings.find((opening) => opening.id === openingId) ?? null;
}

export function findItem(floor: Floor, itemId: string): Item | null {
  return floor.items.find((item) => item.id === itemId) ?? null;
}

/** Stairs that arrive at or leave from a given floor. */
export function stairsTouchingFloor(document: HouseDocument, floorId: FloorId): Stair[] {
  return document.stairs.filter(
    (stair) => stair.fromFloorId === floorId || stair.toFloorId === floorId,
  );
}

/** Every wall graph in the document, keyed by floor. Used by whole-house views. */
export function graphsByFloor(document: HouseDocument): Map<FloorId, WallGraph> {
  return new Map(document.floors.map((floor) => [floor.id, floor.graph]));
}
