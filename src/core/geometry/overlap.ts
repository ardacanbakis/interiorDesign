/**
 * Do these two shapes share any space?
 *
 * The question every clearance check comes down to, and one that is easy to get
 * *nearly* right. The obvious approaches all fail on cases this app is full of:
 * testing whether a corner of one is inside the other misses a plus sign;
 * testing edge crossings misses containment; and both report two rectangles
 * that merely touch — which, in a plan where everything is placed to the
 * millimetre and furniture is *meant* to sit flat against walls and against each
 * other, is the single most common arrangement there is.
 *
 * So the answer is the exact one: clip one polygon by the other and ask whether
 * anything with area is left. Touching gives nothing; a one-millimetre overlap
 * gives a square millimetre; and there is no tolerance to tune.
 */

import {
  area,
  boundingBox,
  boundingBoxesOverlap,
  containsPoint,
  isClockwise,
  reverse,
  type BoundingBox,
  type Polygon,
} from './polygon.ts';
import { cross, sub, type Vec2 } from './vec2.ts';

/**
 * Anything smaller than this is two shapes touching, not overlapping.
 *
 * A square millimetre. Coordinates are whole millimetres, so a real overlap is
 * never smaller than that, and floating-point dust from the clip never bigger.
 */
const AREA_EPSILON = 1;

/** True when two simple polygons share actual area. Touching does not count. */
export function polygonsOverlap(first: Polygon, second: Polygon): boolean {
  return overlapArea(first, second) > AREA_EPSILON;
}

/**
 * How much area two polygons share.
 *
 * Exact when the shape doing the clipping is convex, which every clearance zone
 * is. Where both are concave — an L-shaped corner sofa against another one —
 * the result can be an over-estimate, because Sutherland–Hodgman clips against
 * a convex region. That errs towards reporting a problem, which is the right
 * way round for a safety check.
 */
export function overlapArea(first: Polygon, second: Polygon): number {
  if (first.length < 3 || second.length < 3) return 0;
  if (!boundingBoxesOverlap(boundingBox(first), boundingBox(second))) return 0;

  // Clip by whichever is convex, so the common case is exact.
  const [subject, clip] = isConvex(second) ? [first, second] : [second, first];
  return area(clipPolygon(subject, clip));
}

/**
 * Sutherland–Hodgman: the part of `subject` inside `clip`.
 *
 * Returns an empty polygon when they do not meet. The classic algorithm, and
 * the reason it is worth the thirty lines here rather than a dependency: it is
 * exact, it has no tolerance, and it gives the intersection itself rather than
 * just a yes or no — which is what lets an issue say "by about 0.3 m²".
 */
export function clipPolygon(subject: Polygon, clip: Polygon): Polygon {
  // Both wound the same way, so "inside" means the same thing for every edge.
  const boundary = isClockwise(clip) ? clip : reverse(clip);
  let output: Vec2[] = [...subject];

  for (let index = 0; index < boundary.length && output.length > 0; index++) {
    const a = boundary[index]!;
    const b = boundary[(index + 1) % boundary.length]!;

    const input = output;
    output = [];

    for (let edge = 0; edge < input.length; edge++) {
      const current = input[edge]!;
      const previous = input[(edge + input.length - 1) % input.length]!;

      const currentIn = side(a, b, current) >= 0;
      const previousIn = side(a, b, previous) >= 0;

      if (currentIn) {
        if (!previousIn) output.push(lineCrossing(previous, current, a, b));
        output.push(current);
      } else if (previousIn) {
        output.push(lineCrossing(previous, current, a, b));
      }
    }
  }

  return output;
}

/**
 * Which side of the directed edge a→b a point falls on.
 *
 * Positive is the interior of a clockwise-on-screen polygon, matching the
 * y-down convention used everywhere else here.
 */
function side(a: Vec2, b: Vec2, point: Vec2): number {
  return cross(sub(b, a), sub(point, a));
}

/** Where the segment p→q crosses the infinite line through a→b. */
function lineCrossing(p: Vec2, q: Vec2, a: Vec2, b: Vec2): Vec2 {
  const denominator = side(a, b, q) - side(a, b, p);
  if (denominator === 0) return q;

  const t = side(a, b, p) / -denominator;
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
}

/** True when a polygon never turns back on itself. */
export function isConvex(polygon: Polygon): boolean {
  if (polygon.length < 4) return true;

  let sign = 0;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index]!;
    const b = polygon[(index + 1) % polygon.length]!;
    const c = polygon[(index + 2) % polygon.length]!;

    const turn = cross(sub(b, a), sub(c, b));
    if (Math.abs(turn) < 1e-9) continue;

    const direction = turn > 0 ? 1 : -1;
    if (sign === 0) sign = direction;
    else if (sign !== direction) return false;
  }

  return true;
}

/**
 * True when a polygon lies entirely inside another.
 *
 * Sitting flat on the boundary counts as inside: furniture with its back
 * against a wall has its edge exactly on the room's outline, and that is
 * correct placement rather than a shape hanging out of the room.
 */
export function polygonInside(inner: Polygon, outer: Polygon, tolerance = 1): boolean {
  return inner.every((point) => containsPoint(outer, point) || onBoundary(outer, point, tolerance));
}

function onBoundary(polygon: Polygon, point: Vec2, tolerance: number): boolean {
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index]!;
    const b = polygon[(index + 1) % polygon.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq === 0) continue;

    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
    const distance = Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
    if (distance <= tolerance) return true;
  }
  return false;
}

/**
 * Two height ranges, as `[bottom, top]`, sharing any part of their span.
 *
 * Strict at the ends, so a box standing *on* another is not inside it.
 */
export function heightsOverlap(
  first: { bottom: number; top: number },
  second: { bottom: number; top: number },
  tolerance = 1,
): boolean {
  return first.bottom < second.top - tolerance && second.bottom < first.top - tolerance;
}

export function boxesOverlap(a: BoundingBox, b: BoundingBox): boolean {
  return boundingBoxesOverlap(a, b);
}
