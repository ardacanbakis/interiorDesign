/**
 * Turning a footprint and two heights into surfaces.
 *
 * The one place a prism becomes something that can be drawn. Everything the
 * renderer sees comes through here, so the normals produced here are what
 * decide which faces are visible and how brightly they are lit — getting them
 * backwards turns the scene inside out, and it is the kind of mistake that is
 * hard to see and easy to test.
 */

import { centroid, signedArea, withWinding, type Polygon } from '../geometry/polygon.ts';
import { normalize, perpendicular, sub, type Vec2 } from '../geometry/vec2.ts';
import { lift, type Vec3 } from '../geometry/vec3.ts';
import { type Mm } from '../units/length.ts';
import { type Face3, type Prism } from './types.ts';

/**
 * A prism from a polygon, with the winding put right.
 *
 * Bases arrive from four different places — wall rectangles, room outlines,
 * rotated furniture footprints, door leaves — and only some of them are wound
 * the way the face builder needs. Normalising here rather than trusting each
 * caller means a new source of geometry cannot quietly produce a solid that is
 * lit from the inside.
 *
 * Heights are ordered too, so `bottom` is always the lower one.
 */
export function prism(base: Polygon, bottom: Mm, top: Mm): Prism {
  return {
    base: withWinding(base, true),
    bottom: Math.min(bottom, top),
    top: Math.max(bottom, top),
  };
}

/** True when a prism has enough substance to be worth drawing. */
export function isDrawable(solid: Prism): boolean {
  return solid.base.length >= 3 && solid.top > solid.bottom && Math.abs(signedArea(solid.base)) > 1;
}

/**
 * The faces of a prism: a top, a bottom, and one per edge of the base.
 *
 * The base is wound clockwise on screen, which is the positive winding in
 * `polygon.ts`. For such a ring `perpendicular` points *into* the enclosed
 * area — the same fact `roomGeometry.ts` relies on to inset a room — so the
 * outward normal of a side face is the opposite of it.
 */
export function prismFaces(solid: Prism): Face3[] {
  const { base, bottom, top } = solid;
  if (base.length < 3) return [];

  const faces: Face3[] = [
    { points: base.map((point) => lift(point, top)), normal: { x: 0, y: 0, z: 1 } },
    // Reversed so the underside's vertices also run anticlockwise about its own
    // outward normal. Nothing in the renderer reads the winding — the normal is
    // supplied — but a face whose points and normal disagree is a trap for
    // whatever gets written next.
    {
      points: [...base].reverse().map((point) => lift(point, bottom)),
      normal: { x: 0, y: 0, z: -1 },
    },
  ];

  for (let index = 0; index < base.length; index++) {
    const from = base[index]!;
    const to = base[(index + 1) % base.length]!;

    const direction = sub(to, from);
    if (direction.x === 0 && direction.y === 0) continue;

    const inward = perpendicular(normalize(direction));

    faces.push({
      points: [lift(from, bottom), lift(to, bottom), lift(to, top), lift(from, top)],
      normal: { x: -inward.x, y: -inward.y, z: 0 },
    });
  }

  return faces;
}

/** The middle of a prism, for depth sorting and for framing the view. */
export function prismCentre(solid: Prism): Vec3 {
  const middle = centroid(solid.base);
  return { x: middle.x, y: middle.y, z: (solid.bottom + solid.top) / 2 };
}

/**
 * A rectangle in plan, given one edge and a thickness.
 *
 * The shape of a door leaf, a pane of glass, a strip of wall — anything
 * described as "this long, this thick, running this way". The rectangle is
 * centred on the line from `from` to `to`.
 */
export function slabBetween(from: Vec2, to: Vec2, thickness: Mm): Polygon {
  const direction = sub(to, from);
  if (direction.x === 0 && direction.y === 0) return [];

  const half = thickness / 2;
  const across = perpendicular(normalize(direction));
  const right = { x: across.x * half, y: across.y * half };

  return [
    { x: from.x - right.x, y: from.y - right.y },
    { x: to.x - right.x, y: to.y - right.y },
    { x: to.x + right.x, y: to.y + right.y },
    { x: from.x + right.x, y: from.y + right.y },
  ];
}
