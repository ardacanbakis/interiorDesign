/**
 * Where an object actually is.
 *
 * A definition draws itself at the origin, facing +y. An item carries a
 * position and a rotation. This module is the single place those two are put
 * together, so the renderer, the hit test, the snapping and — later — the
 * clearance rules all agree on what "rotated 90°" means. Having each of them
 * work it out separately is how a wardrobe ends up drawn in one place and
 * checked in another.
 */

import { boundingBox, containsPoint, type BoundingBox, type Polygon } from '../geometry/polygon.ts';
import { add, rotate, sub, vec2, type Vec2 } from '../geometry/vec2.ts';
import { type Item } from '../model/schema.ts';
import { type Mm } from '../units/length.ts';
import { clearancesOf, findDefinition, planShapeOf } from './registry.ts';
import { type ClearanceZone, type PlanArc, type PlanShape, type PlanStroke } from './types.ts';

const RADIANS = Math.PI / 180;

/** An item's own axes, in world space. */
export interface ItemAxes {
  /** Unit vector along the item's width, its local +x. */
  readonly along: Vec2;
  /** Unit vector towards its front — the side you walk up to. Its local +y. */
  readonly front: Vec2;
}

export function itemAxes(item: Pick<Item, 'rotation'>): ItemAxes {
  const radians = item.rotation * RADIANS;
  return { along: rotate(vec2(1, 0), radians), front: rotate(vec2(0, 1), radians) };
}

/**
 * The rotation that makes an item face a given direction.
 *
 * The inverse of {@link itemAxes}: rotating local +y by `r` gives
 * `(-sin r, cos r)`, so recovering `r` from a desired front is this.
 */
export function rotationFacing(front: Vec2): number {
  return (Math.atan2(-front.x, front.y) / RADIANS + 360) % 360;
}

export function toWorld(item: Pick<Item, 'x' | 'y' | 'rotation'>, local: Vec2): Vec2 {
  return add(vec2(item.x, item.y), rotate(local, item.rotation * RADIANS));
}

export function toLocal(item: Pick<Item, 'x' | 'y' | 'rotation'>, world: Vec2): Vec2 {
  return rotate(sub(world, vec2(item.x, item.y)), -item.rotation * RADIANS);
}

function worldPolygon(item: Item, polygon: Polygon): Polygon {
  return polygon.map((point) => toWorld(item, point));
}

/** An item's footprint, where it is. */
export function itemFootprint(item: Item): Polygon {
  return worldPolygon(item, planShapeOf(item).outline);
}

/**
 * The item's plan symbol, placed.
 *
 * The same shape a definition returns, with every point moved into world
 * coordinates and arcs swung round by the item's rotation.
 */
export function placedShape(item: Item): PlanShape {
  const shape = planShapeOf(item);

  const strokes: PlanStroke[] = shape.strokes.map((line) => ({
    ...line,
    points: line.points.map((point) => toWorld(item, point)),
  }));

  const arcs: PlanArc[] = shape.arcs.map((curve) => ({
    ...curve,
    centre: toWorld(item, curve.centre),
    // Angles are measured the same way the rotation is — clockwise on screen —
    // so rotating an arc is adding to both ends of it.
    startAngle: curve.startAngle + item.rotation * RADIANS,
    endAngle: curve.endAngle + item.rotation * RADIANS,
  }));

  return {
    outline: worldPolygon(item, shape.outline),
    voids: shape.voids.map((hole) => worldPolygon(item, hole)),
    strokes,
    arcs,
  };
}

/**
 * The item's plan symbol, or nothing if the catalogue has never heard of it.
 *
 * A document can name a kind this build does not have — one saved by a newer
 * version, or hand-edited. The schema cannot catch it, because a kind is just a
 * string. Drawing is the wrong place to discover that, so the renderer asks
 * this instead and leaves out what it cannot draw rather than taking the whole
 * canvas down with it.
 */
export function placedShapeIfKnown(item: Item): PlanShape | null {
  return findDefinition(item.kind) ? placedShape(item) : null;
}

/** The space an item needs to work, placed. */
export function placedClearances(item: Item): ClearanceZone[] {
  return clearancesOf(item).map((zone) => ({
    ...zone,
    polygon: worldPolygon(item, zone.polygon),
  }));
}

/** Axis-aligned bounds of the placed footprint. Rotated items get bigger ones. */
export function itemBounds(item: Item): BoundingBox {
  return boundingBox(itemFootprint(item));
}

/** What an item occupies vertically: from the underside of it to the top. */
export function itemHeightRange(item: Item): { bottom: Mm; top: Mm } {
  return { bottom: item.elevation, top: item.elevation + item.height };
}

/**
 * The item under a point, if any.
 *
 * Searched back to front, because later items are drawn on top and clicking
 * what you can see is the only behaviour that is not maddening.
 */
export function itemAt(items: readonly Item[], point: Vec2): Item | null {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]!;
    // An item the catalogue cannot draw is also one it cannot place, so it is
    // not under anything. See `placedShapeIfKnown`.
    const shape = placedShapeIfKnown(item);
    if (shape && containsPoint(shape.outline, point)) return item;
  }
  return null;
}

/** Whether two placed items' bounds overlap. A cheap pre-filter, not a test. */
export function boundsOverlap(a: BoundingBox, b: BoundingBox): boolean {
  return !(a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY);
}
