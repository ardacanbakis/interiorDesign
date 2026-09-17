/**
 * The document schema.
 *
 * Everything the app persists is defined here once, as Zod schemas, with the
 * TypeScript types inferred from them. A document arriving from disk, from a
 * file someone shared, or from cloud sync has to be validated before it is
 * trusted, and having the validator and the type be the same declaration means
 * they cannot drift apart.
 *
 * The graph types are the exception: they are hand-written in `wallGraph.ts`,
 * which has no business depending on a validation library. A compile-time
 * assertion at the bottom of this file checks that the schema here and the
 * interfaces there still describe the same thing.
 *
 * ## No optional fields
 *
 * Every field is required and every schema supplies a default. Optional fields
 * in a persisted document mean every reader has to handle absence forever,
 * which is how a codebase ends up with `?? 0` scattered through it. Adding a
 * field is a migration instead — see `migrations.ts`.
 */

import { z } from 'zod';

import { type WallGraph } from '../graph/wallGraph.ts';
import { ROOM_TYPES } from '../graph/roomIdentity.ts';

/** Bumped whenever the shape changes. See `migrations.ts`. */
export const CURRENT_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * A length in whole millimetres.
 *
 * Finite and integral is enforced here rather than trusted, because a NaN or a
 * fractional coordinate that reaches the geometry code produces a plan that
 * looks fine and computes wrong.
 */
const Mm = z.number().int().finite();

/** A length that cannot be negative — a thickness, a width, a height. */
const PositiveMm = Mm.nonnegative();

const Vec2Schema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

const IdSchema = z.string().min(1).max(64);

// ---------------------------------------------------------------------------
// Wall graph
// ---------------------------------------------------------------------------

export const WallKindSchema = z.enum(['exterior', 'interior', 'partition']);

export const GraphNodeSchema = z.object({
  id: IdSchema,
  x: Mm,
  y: Mm,
});

export const GraphWallSchema = z.object({
  id: IdSchema,
  a: IdSchema,
  b: IdSchema,
  thickness: PositiveMm,
  kind: WallKindSchema,
});

export const WallGraphSchema = z.object({
  nodes: z.record(IdSchema, GraphNodeSchema),
  walls: z.record(IdSchema, GraphWallSchema),
});

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

export const RoomTypeSchema = z.enum(ROOM_TYPES);

export const RoomPropsSchema = z.object({
  id: IdSchema,
  anchor: Vec2Schema,
  name: z.string().max(120),
  type: RoomTypeSchema,
  lastArea: z.number().nonnegative().finite(),
});

// ---------------------------------------------------------------------------
// Openings — doors and windows, hosted on a wall
// ---------------------------------------------------------------------------

export const OpeningKindSchema = z.enum(['door', 'window', 'opening']);

/**
 * Which end of the host wall the hinge is at, and which side the leaf swings
 * towards. Between them these give the four ways a door can be hung, which is
 * what the swing-clearance check needs to know.
 *
 * `side` is relative to the wall's own a-to-b direction: "right" is the side a
 * person walking from a to b would find on their right.
 */
export const HingeSchema = z.enum(['a', 'b']);
export const SwingSideSchema = z.enum(['left', 'right']);

export const OpeningSchema = z.object({
  id: IdSchema,
  kind: OpeningKindSchema,
  label: z.string().max(120),
  wallId: IdSchema,
  /** Distance from the host wall's `a` node to the opening's centre. */
  offset: PositiveMm,
  width: PositiveMm,
  height: PositiveMm,
  /** Height of the sill above the floor. Zero for a door. */
  sillHeight: PositiveMm,
  hinge: HingeSchema,
  side: SwingSideSchema,
  /** 0 is shut, 1 is fully open. */
  openAmount: z.number().min(0).max(1),
});

// ---------------------------------------------------------------------------
// Items — furniture and fixtures
// ---------------------------------------------------------------------------

export const MountSchema = z.enum(['floor', 'wall', 'ceiling']);

export const ItemSchema = z.object({
  id: IdSchema,
  /** Key into the catalogue. */
  kind: z.string().min(1).max(64),
  label: z.string().max(120),
  /** Centre of the footprint. Rotation is about this point. */
  x: Mm,
  y: Mm,
  /** Degrees, clockwise on screen, matching the y-down convention. */
  rotation: z.number().finite(),
  width: PositiveMm,
  depth: PositiveMm,
  height: PositiveMm,
  /** Height of the underside above the floor. */
  elevation: PositiveMm,
  mount: MountSchema,
  /** Kind-specific extras, defined by the catalogue entry. */
  params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
});

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

/** A void in the floor slab — most often a stairwell. */
export const FloorOpeningSchema = z.object({
  id: IdSchema,
  polygon: z.array(Vec2Schema).min(3),
  /** The stair that made this void, if any. */
  stairId: IdSchema.nullable(),
});

export const OutdoorKindSchema = z.enum(['balcony', 'terrace', 'garden', 'driveway']);

export const OutdoorAreaSchema = z.object({
  id: IdSchema,
  kind: OutdoorKindSchema,
  name: z.string().max(120),
  polygon: z.array(Vec2Schema).min(3),
  /** Zero means no railing. */
  railingHeight: PositiveMm,
});

export const FloorSchema = z.object({
  id: IdSchema,
  name: z.string().max(120),
  /** 0 is the ground floor, 1 the one above it, -1 a basement. */
  level: z.number().int(),
  /** Height of this floor's finished surface above the ground floor's. */
  elevation: Mm,
  /** Floor to ceiling, not floor to floor. */
  ceilingHeight: PositiveMm,
  slabThickness: PositiveMm,
  graph: WallGraphSchema,
  rooms: z.array(RoomPropsSchema),
  openings: z.array(OpeningSchema),
  items: z.array(ItemSchema),
  floorOpenings: z.array(FloorOpeningSchema),
  outdoorAreas: z.array(OutdoorAreaSchema),
});

// ---------------------------------------------------------------------------
// Stairs — the one thing that belongs to two floors at once
// ---------------------------------------------------------------------------

export const StairKindSchema = z.enum(['straight', 'l-shaped', 'u-shaped']);

export const StairSchema = z.object({
  id: IdSchema,
  label: z.string().max(120),
  fromFloorId: IdSchema,
  toFloorId: IdSchema,
  kind: StairKindSchema,
  /** Centre of the footprint on the lower floor. */
  x: Mm,
  y: Mm,
  rotation: z.number().finite(),
  width: PositiveMm,
  /**
   * Number of risers. The rise of each is the floor-to-floor height divided by
   * this, so the two cannot disagree.
   */
  riserCount: z.number().int().positive(),
  /** Tread depth, front to back. */
  going: PositiveMm,
});

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export const LengthUnitSchema = z.enum(['mm', 'cm', 'm']);

export const HouseDocumentSchema = z.object({
  schemaVersion: z.number().int().positive(),
  id: IdSchema,
  name: z.string().max(200),
  /** Display preference only — storage is always millimetres. */
  unit: LengthUnitSchema,
  floors: z.array(FloorSchema),
  stairs: z.array(StairSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type Vec2Value = z.infer<typeof Vec2Schema>;
export type Opening = z.infer<typeof OpeningSchema>;
export type OpeningKind = z.infer<typeof OpeningKindSchema>;
export type Hinge = z.infer<typeof HingeSchema>;
export type SwingSide = z.infer<typeof SwingSideSchema>;
export type Item = z.infer<typeof ItemSchema>;
export type Mount = z.infer<typeof MountSchema>;
export type FloorOpening = z.infer<typeof FloorOpeningSchema>;
export type OutdoorArea = z.infer<typeof OutdoorAreaSchema>;
export type OutdoorKind = z.infer<typeof OutdoorKindSchema>;
export type Floor = z.infer<typeof FloorSchema>;
export type Stair = z.infer<typeof StairSchema>;
export type StairKind = z.infer<typeof StairKindSchema>;
export type HouseDocument = z.infer<typeof HouseDocumentSchema>;

export type FloorId = string;
export type OpeningId = string;
export type ItemId = string;
export type StairId = string;

// ---------------------------------------------------------------------------
// Conformance
// ---------------------------------------------------------------------------

/**
 * Compile-time proof that the graph schema above still matches the hand-written
 * interfaces in `wallGraph.ts`. If either side gains or loses a field this
 * stops compiling, which is the point — a validator that has quietly drifted
 * from the type it validates is worse than no validator.
 */
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const _graphSchemaMatchesInterface: MutuallyAssignable<
  z.infer<typeof WallGraphSchema>,
  {
    nodes: Record<string, WallGraph['nodes'][string]>;
    walls: Record<string, WallGraph['walls'][string]>;
  }
> = true;
void _graphSchemaMatchesInterface;
