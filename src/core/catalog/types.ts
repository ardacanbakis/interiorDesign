/**
 * What a piece of furniture *is*.
 *
 * Objects are data, not components. Each kind is one `ItemDefinition` that
 * knows how to draw itself in plan, build itself as boxes in 3D, and say what
 * space it needs to function — all as functions of its current dimensions.
 *
 * That last part is the whole point. Resizing a wardrobe is not a scale
 * transform on a fixed model: the definition is re-run, so the plan symbol,
 * the solid and the door-swing clearance all come out right for the new size.
 * It is what makes "edit the measurements of every object" mean something
 * rather than being a stretch factor.
 *
 * ## Local coordinates
 *
 * A definition draws itself at the origin, unrotated, with:
 *
 * - **+x** across its width, to the right
 * - **+y** across its depth, towards its **front** — the side you walk up to,
 *   open, sit on or get into
 * - **+z** upwards from the floor
 *
 * Fixing "front" as +y is what lets clearance zones be written once and stay
 * correct at any rotation: the space a wardrobe needs is always in front of it,
 * and the renderer applies the rotation afterwards.
 */

import { type Polygon } from '../geometry/polygon.ts';
import { type Vec2 } from '../geometry/vec2.ts';
import { type RoomType } from '../graph/roomIdentity.ts';
import { type Item, type Mount } from '../model/schema.ts';
import { type Mm } from '../units/length.ts';

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type ItemCategory =
  | 'sleeping'
  | 'seating'
  | 'storage'
  | 'surfaces'
  | 'kitchen'
  | 'bath'
  | 'appliances'
  | 'fixtures'
  | 'soft';

export const ITEM_CATEGORIES: readonly ItemCategory[] = [
  'sleeping',
  'seating',
  'storage',
  'surfaces',
  'kitchen',
  'bath',
  'appliances',
  'fixtures',
  'soft',
];

export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  sleeping: 'Beds',
  seating: 'Seating',
  storage: 'Storage',
  surfaces: 'Tables & desks',
  kitchen: 'Kitchen',
  bath: 'Bathroom',
  appliances: 'Appliances',
  fixtures: 'Fixtures',
  soft: 'Soft furnishings',
};

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/** A line or polyline drawn over an item's footprint. */
export interface PlanStroke {
  readonly points: readonly Vec2[];
  /** Dashed strokes read as "not solid" — a door swing, a pull-out drawer. */
  readonly dashed?: boolean;
  /** Thin by default; `heavy` for something that reads as structure. */
  readonly weight?: 'hairline' | 'normal' | 'heavy';
  readonly closed?: boolean;
}

/** An arc, for the swing of a hinged door on a cupboard. */
export interface PlanArc {
  readonly centre: Vec2;
  readonly radius: Mm;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly dashed?: boolean;
}

export interface PlanShape {
  /** The footprint, filled. */
  readonly outline: Polygon;
  /** Everything drawn on top of the fill. */
  readonly strokes: readonly PlanStroke[];
  readonly arcs: readonly PlanArc[];
  /**
   * Parts of the footprint that are not solid at floor level — the space under
   * a bed or a wall-hung basin. Drawn lighter, and ignored by the overlap check
   * at floor height.
   */
  readonly voids: readonly Polygon[];
}

// ---------------------------------------------------------------------------
// Solids
// ---------------------------------------------------------------------------

export type MaterialKey = 'carcass' | 'soft' | 'surface' | 'metal' | 'glass' | 'appliance';

/** One box of an item's low-poly solid, in local coordinates. */
export interface SolidPart {
  readonly centre: Vec3;
  readonly size: Vec3;
  readonly material: MaterialKey;
}

// ---------------------------------------------------------------------------
// Clearance
// ---------------------------------------------------------------------------

export type ClearanceSeverity = 'error' | 'warning';

/**
 * Space an item needs in order to work.
 *
 * Not the same as the space it occupies: a wardrobe that fits perfectly into an
 * alcove but has 300mm in front of it is useless, and this is how the app knows
 * that. The polygon is in the item's local coordinates and is rotated with it.
 */
export interface ClearanceZone {
  readonly id: string;
  /** Shown to the user when the zone is blocked. */
  readonly reason: string;
  readonly polygon: Polygon;
  readonly severity: ClearanceSeverity;
  /**
   * How high the obstruction has to be to matter. A rug does not stop a
   * wardrobe door; a chest of drawers does.
   */
  readonly minimumBlockingHeight: Mm;
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export type FieldKind = 'length' | 'choice' | 'toggle' | 'count';

/**
 * A parameter the inspector should offer.
 *
 * `width`, `depth`, `height` and `elevation` live on the item itself and are
 * always editable; these are the kind-specific extras that live in `params`.
 */
export interface FieldSpec {
  readonly key: string;
  readonly label: string;
  readonly kind: FieldKind;
  readonly min?: number;
  readonly max?: number;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  readonly hint?: string;
}

/** A named set of real-world dimensions. */
export interface ItemPreset {
  readonly name: string;
  readonly width: Mm;
  readonly depth: Mm;
  readonly height: Mm;
}

// ---------------------------------------------------------------------------
// The definition
// ---------------------------------------------------------------------------

export interface ItemDefaults {
  readonly width: Mm;
  readonly depth: Mm;
  readonly height: Mm;
  readonly elevation: Mm;
  readonly mount: Mount;
}

export interface ItemDefinition {
  readonly kind: string;
  readonly label: string;
  readonly category: ItemCategory;
  /** Room types that offer this first. Empty means "offer it everywhere". */
  readonly rooms: readonly RoomType[];
  readonly defaults: ItemDefaults;
  readonly presets: readonly ItemPreset[];
  readonly fields: readonly FieldSpec[];
  /** Default values for anything in `fields`. */
  readonly params: Readonly<Record<string, number | string | boolean>>;

  readonly plan: (item: Item) => PlanShape;
  readonly solid: (item: Item) => SolidPart[];
  readonly clearances: (item: Item) => ClearanceZone[];
}

// ---------------------------------------------------------------------------
// Reading params
// ---------------------------------------------------------------------------

export function numberParam(item: Item, key: string, fallback: number): number {
  const value = item.params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function stringParam(item: Item, key: string, fallback: string): string {
  const value = item.params[key];
  return typeof value === 'string' ? value : fallback;
}

export function booleanParam(item: Item, key: string, fallback: boolean): boolean {
  const value = item.params[key];
  return typeof value === 'boolean' ? value : fallback;
}
