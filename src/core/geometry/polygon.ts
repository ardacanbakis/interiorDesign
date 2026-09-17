/**
 * Simple polygons.
 *
 * A polygon is an ordered ring of vertices with no repeated closing vertex —
 * the last point is implicitly joined back to the first.
 *
 * Orientation follows the y-down convention documented in `vec2.ts`: a ring
 * wound **clockwise as it appears on screen** has a positive signed area. Room
 * faces come out of face extraction in a known orientation, and several things
 * downstream (wall inner faces, clearance zone sides) depend on knowing which.
 */

import { type Mm2 } from '../units/length.ts';
import { distance, type Vec2 } from './vec2.ts';

export type Polygon = readonly Vec2[];

export interface BoundingBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Shoelace area, keeping its sign.
 *
 * Positive means the ring is wound clockwise on screen. Degenerate rings of
 * fewer than three points have zero area.
 */
export function signedArea(polygon: Polygon): number {
  if (polygon.length < 3) return 0;

  let total = 0;
  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i]!;
    const next = polygon[(i + 1) % polygon.length]!;
    total += current.x * next.y - next.x * current.y;
  }
  return total / 2;
}

/** Unsigned area. */
export function area(polygon: Polygon): Mm2 {
  return Math.abs(signedArea(polygon));
}

/** True when the ring is wound clockwise as drawn on screen. */
export function isClockwise(polygon: Polygon): boolean {
  return signedArea(polygon) > 0;
}

/** The same ring wound the other way. */
export function reverse(polygon: Polygon): Polygon {
  return [...polygon].reverse();
}

/** Force a known winding, leaving already-correct rings untouched. */
export function withWinding(polygon: Polygon, clockwise: boolean): Polygon {
  return isClockwise(polygon) === clockwise ? polygon : reverse(polygon);
}

export function perimeter(polygon: Polygon): number {
  if (polygon.length < 2) return 0;

  let total = 0;
  for (let i = 0; i < polygon.length; i++) {
    total += distance(polygon[i]!, polygon[(i + 1) % polygon.length]!);
  }
  return total;
}

/**
 * Area-weighted centroid — the centre of mass, not the average of the
 * vertices. This is what a room label should sit on; the vertex average drifts
 * towards whichever corner has the most points, which for an L-shaped room can
 * put the label outside the room entirely.
 *
 * Falls back to the vertex average for degenerate rings with no area.
 */
export function centroid(polygon: Polygon): Vec2 {
  if (polygon.length === 0) return { x: 0, y: 0 };
  if (polygon.length < 3) return vertexAverage(polygon);

  const doubleArea = signedArea(polygon) * 2;
  if (doubleArea === 0) return vertexAverage(polygon);

  let x = 0;
  let y = 0;
  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i]!;
    const next = polygon[(i + 1) % polygon.length]!;
    const weight = current.x * next.y - next.x * current.y;
    x += (current.x + next.x) * weight;
    y += (current.y + next.y) * weight;
  }

  return { x: x / (3 * doubleArea), y: y / (3 * doubleArea) };
}

function vertexAverage(polygon: Polygon): Vec2 {
  let x = 0;
  let y = 0;
  for (const point of polygon) {
    x += point.x;
    y += point.y;
  }
  return { x: x / polygon.length, y: y / polygon.length };
}

export function boundingBox(polygon: Polygon): BoundingBox {
  if (polygon.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of polygon) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }

  return { minX, minY, maxX, maxY };
}

export function boundingBoxesOverlap(a: BoundingBox, b: BoundingBox): boolean {
  return !(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY);
}

/**
 * Point-in-polygon by ray casting, using the crossing-number rule.
 *
 * Points exactly on the boundary are **not** reliably classified — floating
 * point makes that undecidable in general. Callers that care (room anchors,
 * which must land unambiguously inside one face) should use
 * {@link isPointInsidePolygon} with a margin, or place the point away from
 * edges in the first place.
 */
export function containsPoint(polygon: Polygon, point: Vec2): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;

    const straddles = a.y > point.y !== b.y > point.y;
    if (!straddles) continue;

    const crossingX = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < crossingX) inside = !inside;
  }

  return inside;
}

/** Distance from a point to the polygon's boundary, always non-negative. */
export function distanceToBoundary(polygon: Polygon, point: Vec2): number {
  if (polygon.length < 2) return Infinity;

  let closest = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const d = distanceToSegmentInline(a, b, point);
    if (d < closest) closest = d;
  }
  return closest;
}

/**
 * Inside the polygon by at least `margin`. Used wherever a point must be
 * unambiguously interior — room anchors above all, since an anchor sitting on
 * a wall could be claimed by either of the rooms it divides.
 */
export function isPointInsidePolygon(polygon: Polygon, point: Vec2, margin = 0): boolean {
  if (!containsPoint(polygon, point)) return false;
  return margin <= 0 || distanceToBoundary(polygon, point) >= margin;
}

/**
 * A point comfortably inside the polygon, for placing a room's anchor and
 * label. Prefers the centroid, which is inside for any convex ring and most
 * concave ones; when the centroid falls outside — which happens with
 * U-shaped and some L-shaped rooms — it falls back to a scan.
 */
export function representativePoint(polygon: Polygon): Vec2 {
  const middle = centroid(polygon);
  if (containsPoint(polygon, middle)) return middle;
  return scanForInteriorPoint(polygon) ?? middle;
}

/**
 * Find an interior point by sampling a grid over the bounding box and keeping
 * whichever candidate sits furthest from the boundary. Deliberately simple:
 * rooms are few and this runs only when the centroid has already failed.
 */
function scanForInteriorPoint(polygon: Polygon): Vec2 | null {
  const box = boundingBox(polygon);
  const steps = 16;
  const stepX = (box.maxX - box.minX) / steps;
  const stepY = (box.maxY - box.minY) / steps;
  if (stepX === 0 || stepY === 0) return null;

  let best: Vec2 | null = null;
  let bestClearance = -Infinity;

  for (let i = 1; i < steps; i++) {
    for (let j = 1; j < steps; j++) {
      const candidate = { x: box.minX + stepX * i, y: box.minY + stepY * j };
      if (!containsPoint(polygon, candidate)) continue;

      const clearance = distanceToBoundary(polygon, candidate);
      if (clearance > bestClearance) {
        bestClearance = clearance;
        best = candidate;
      }
    }
  }

  return best;
}

/**
 * Local copy of point-to-segment distance.
 *
 * `segment.ts` has the general version, but importing it here would make the
 * two geometry modules mutually dependent for the sake of six lines.
 */
function distanceToSegmentInline(a: Vec2, b: Vec2, point: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(point, a);

  const t = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
  return distance(point, { x: a.x + dx * t, y: a.y + dy * t });
}
