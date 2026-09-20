/**
 * What the 3D view is made of.
 *
 * Every solid in the scene is a **prism**: a plan polygon with a floor height
 * and a ceiling height. Not a general mesh, and deliberately so — a building is
 * overwhelmingly made of things that are constant in section. A wall is its
 * footprint between two levels; a worktop is its outline between 890 and 930; a
 * wardrobe carcass is a rectangle between 0 and 2200. The catalogue already
 * describes furniture as a list of boxes (`SolidPart`), and a box is a prism
 * with a rectangular base.
 *
 * Holding to one primitive is what keeps the renderer small enough to be
 * correct. There is one function that turns a prism into faces, one that decides
 * which faces you can see, and one that projects them — and nothing anywhere
 * that special-cases a bed.
 */

import { type Polygon } from '../geometry/polygon.ts';
import { type MaterialKey } from '../catalog/types.ts';
import { type Mm } from '../units/length.ts';
import { type Vec3 } from '../geometry/vec3.ts';

/**
 * How a surface is painted.
 *
 * The catalogue's own materials, plus the ones only the building has. Kept as
 * names rather than colours so the palette lives with the renderer and can
 * follow the light and dark themes.
 */
export type SceneMaterial = MaterialKey | 'wall' | 'floor' | 'door-leaf' | 'sill' | 'ground';

/** A plan polygon extruded between two heights. */
export interface Prism {
  /** World coordinates, in millimetres. Wound clockwise on screen. */
  readonly base: Polygon;
  /** Height of the underside above the floor. May be negative — a slab. */
  readonly bottom: Mm;
  readonly top: Mm;
}

/**
 * What a solid came from, so that clicking it in 3D selects the same thing
 * clicking it in plan would. The kinds match `SelectionTarget` in the store.
 */
export type SceneSource =
  | { readonly kind: 'wall'; readonly id: string }
  | { readonly kind: 'item'; readonly id: string }
  | { readonly kind: 'opening'; readonly id: string }
  | { readonly kind: 'room'; readonly id: string }
  /** Scenery — the ground plane. Clicking it clears the selection. */
  | { readonly kind: 'none' };

export interface SceneSolid extends Prism {
  /** Unique within one scene. */
  readonly id: string;
  readonly material: SceneMaterial;
  readonly source: SceneSource;
  /**
   * The wall this belongs to, for anything that is mounted on one.
   *
   * Used by the cutaway, which has to take a door's leaf and a window's glass
   * away along with the masonry around them — a door left hanging in mid-air
   * where its wall used to be is worse than no cutaway at all.
   */
  readonly hostWallId?: string;
}

/** One flat face of a solid, in world coordinates. */
export interface Face3 {
  readonly points: readonly Vec3[];
  /** Unit vector pointing out of the solid. */
  readonly normal: Vec3;
}
