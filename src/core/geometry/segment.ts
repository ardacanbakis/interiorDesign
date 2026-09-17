/**
 * Line segment operations.
 *
 * These exist almost entirely to serve the wall graph, whose central invariant
 * is planarity: no two walls may cross except at a shared node. Keeping that
 * invariant means knowing precisely how any new wall meets every existing one —
 * including the awkward cases of touching at an endpoint and overlapping along
 * a shared line, which is what happens when someone draws a wall on top of one
 * that is already there.
 */

import { add, cross, distance, dot, lengthSq, scale, sub, type Vec2 } from './vec2.ts';

export interface Segment {
  readonly a: Vec2;
  readonly b: Vec2;
}

export type SegmentIntersection =
  | { readonly kind: 'none' }
  /**
   * The segments meet at exactly one point. `t` and `u` locate it along the
   * first and second segment respectively, each in [0, 1].
   */
  | { readonly kind: 'point'; readonly point: Vec2; readonly t: number; readonly u: number }
  /**
   * The segments lie on the same infinite line and share more than a point.
   * `overlap` is the shared span, ordered along the first segment.
   */
  | { readonly kind: 'collinear'; readonly overlap: readonly [Vec2, Vec2] };

export function segmentLength(s: Segment): number {
  return distance(s.a, s.b);
}

export function pointAt(s: Segment, t: number): Vec2 {
  return add(s.a, scale(sub(s.b, s.a), t));
}

/**
 * Where a point falls along a segment, as a fraction from `a` to `b`.
 * Values outside [0, 1] mean the projection lies beyond an endpoint.
 * A degenerate (zero-length) segment reports 0.
 */
export function parameterAlong(s: Segment, point: Vec2): number {
  const direction = sub(s.b, s.a);
  const lenSq = lengthSq(direction);
  if (lenSq === 0) return 0;
  return dot(sub(point, s.a), direction) / lenSq;
}

export interface Projection {
  /** The closest point on the segment, clamped to its extent. */
  readonly point: Vec2;
  /** Position along the segment, clamped to [0, 1]. */
  readonly t: number;
  /** Distance from the query point to {@link point}. */
  readonly distance: number;
}

/** Closest point on a segment to an arbitrary point. */
export function projectOntoSegment(s: Segment, point: Vec2): Projection {
  const t = Math.min(1, Math.max(0, parameterAlong(s, point)));
  const projected = pointAt(s, t);
  return { point: projected, t, distance: distance(point, projected) };
}

/** Perpendicular distance from a point to a segment (not its infinite line). */
export function distanceToSegment(s: Segment, point: Vec2): number {
  return projectOntoSegment(s, point).distance;
}

/** True when a point lies on a segment, within `tolerance`. */
export function isPointOnSegment(s: Segment, point: Vec2, tolerance: number): boolean {
  return distanceToSegment(s, point) <= tolerance;
}

/**
 * True when a point lies strictly *inside* a segment — on it, but not at
 * either endpoint. This is the test for "does this point split that wall?".
 */
export function isPointInsideSegment(s: Segment, point: Vec2, tolerance: number): boolean {
  if (!isPointOnSegment(s, point, tolerance)) return false;
  return distance(point, s.a) > tolerance && distance(point, s.b) > tolerance;
}

/**
 * Intersect two segments.
 *
 * `tolerance` is in model units (millimetres) and governs both the
 * parallel/collinear decision and how far outside [0, 1] a parameter may stray
 * before the intersection is rejected. Without that slack, two walls meeting
 * exactly at a corner would sometimes be reported as missing each other
 * because of floating-point error in the parameter, and the graph would be
 * left non-planar.
 */
export function segmentIntersection(
  first: Segment,
  second: Segment,
  tolerance = 1e-6,
): SegmentIntersection {
  const r = sub(first.b, first.a);
  const s = sub(second.b, second.a);
  const denominator = cross(r, s);
  const qp = sub(second.a, first.a);

  const firstLength = Math.hypot(r.x, r.y);
  const secondLength = Math.hypot(s.x, s.y);

  // Degenerate inputs: a zero-length segment is a point.
  if (firstLength === 0 || secondLength === 0) return { kind: 'none' };

  // `denominator` is |r||s|·sin(θ). "Parallel" should mean "so nearly parallel
  // that the gap between them is under `tolerance` over the length that
  // matters", which is sin(θ) ≤ tolerance / min(len) — multiply through by
  // |r||s| and the threshold is tolerance × max(len).
  //
  // Getting this wrong is subtle and expensive: comparing against
  // tolerance × len1 × len2 instead reduces to sin(θ) ≤ tolerance, and since
  // `tolerance` is a length in millimetres rather than a ratio, that is true
  // for *every* pair of segments — which silently classifies perpendicular
  // walls as parallel and leaves the graph non-planar.
  const parallelThreshold = tolerance * Math.max(firstLength, secondLength);

  if (Math.abs(denominator) <= parallelThreshold) {
    // Parallel. Collinear only if the perpendicular offset between the two
    // lines is also within tolerance. That offset is |cross(qp, r)| / |r|.
    if (Math.abs(cross(qp, r)) > tolerance * firstLength) {
      return { kind: 'none' };
    }
    return collinearOverlap(first, second, tolerance);
  }

  const t = cross(qp, s) / denominator;
  const u = cross(qp, r) / denominator;

  // Convert the millimetre tolerance into parameter space for each segment.
  const tSlack = tolerance / firstLength;
  const uSlack = tolerance / secondLength;

  if (t < -tSlack || t > 1 + tSlack || u < -uSlack || u > 1 + uSlack) {
    return { kind: 'none' };
  }

  const clampedT = Math.min(1, Math.max(0, t));
  const clampedU = Math.min(1, Math.max(0, u));

  return { kind: 'point', point: pointAt(first, clampedT), t: clampedT, u: clampedU };
}

/**
 * The shared span of two collinear segments, ordered along the first.
 * Reports `none` when they only touch at a single point or not at all — a
 * single shared point between collinear segments is handled as a point
 * intersection by the caller's node-snapping rather than as an overlap.
 */
function collinearOverlap(first: Segment, second: Segment, tolerance: number): SegmentIntersection {
  const tStart = parameterAlong(first, second.a);
  const tEnd = parameterAlong(first, second.b);

  const low = Math.min(tStart, tEnd);
  const high = Math.max(tStart, tEnd);

  const overlapLow = Math.max(0, low);
  const overlapHigh = Math.min(1, high);

  const firstLength = distance(first.a, first.b);
  const slack = tolerance / firstLength;

  if (overlapHigh - overlapLow <= slack) {
    return { kind: 'none' };
  }

  return {
    kind: 'collinear',
    overlap: [pointAt(first, overlapLow), pointAt(first, overlapHigh)],
  };
}
