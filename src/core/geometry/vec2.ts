/**
 * 2D points and vectors.
 *
 * ## Coordinate system
 *
 * X increases to the right, **Y increases downwards** — the SVG and screen
 * convention, chosen so that plan coordinates map to render coordinates without
 * a flip anywhere in the pipeline.
 *
 * The consequence to keep in mind: angle and orientation signs are mirrored
 * relative to school maths. A positive angle rotates *clockwise* on screen, and
 * a polygon wound clockwise on screen has a positive signed area. Every
 * orientation-sensitive function here says which way it means.
 */

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

export const ORIGIN: Vec2 = { x: 0, y: 0 };

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Vec2, factor: number): Vec2 {
  return { x: v.x * factor, y: v.y * factor };
}

/**
 * Collapse negative zero to zero.
 *
 * Any negation can produce -0, which then survives a JSON round-trip as `-0`,
 * compares unequal to `0` under `Object.is`, and renders as `-0` in an SVG path.
 * In a codebase where coordinates are constantly negated and rotated, it is
 * worth keeping out of the model entirely.
 */
function noNegativeZero(n: number): number {
  return n === 0 ? 0 : n;
}

export function negate(v: Vec2): Vec2 {
  return { x: noNegativeZero(-v.x), y: noNegativeZero(-v.y) };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * 2D cross product (the z component of the 3D cross product).
 *
 * In this y-down system, a positive result means `b` turns clockwise from `a`
 * as seen on screen.
 */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function lengthSq(v: Vec2): number {
  return v.x * v.x + v.y * v.y;
}

export function length(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Unit vector in the same direction. A zero vector is returned unchanged. */
export function normalize(v: Vec2): Vec2 {
  const len = length(v);
  return len === 0 ? ORIGIN : { x: v.x / len, y: v.y / len };
}

/**
 * Rotate 90°. On screen — with Y pointing down — this turns the vector
 * clockwise, so it points to the *right-hand side* of the original direction.
 * That is the side used for wall offsets and door swing sides.
 */
export function perpendicular(v: Vec2): Vec2 {
  return { x: noNegativeZero(-v.y), y: v.x };
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Angle of a vector in radians, measured clockwise from the positive X axis
 * as it appears on screen, in the range (-π, π].
 */
export function angleOf(v: Vec2): number {
  return Math.atan2(v.y, v.x);
}

/** Rotate by `radians` — clockwise on screen, since Y points down. */
export function rotate(v: Vec2, radians: number): Vec2 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: noNegativeZero(v.x * cos - v.y * sin),
    y: noNegativeZero(v.x * sin + v.y * cos),
  };
}

/** Rotate around a pivot rather than the origin. */
export function rotateAround(v: Vec2, pivot: Vec2, radians: number): Vec2 {
  return add(pivot, rotate(sub(v, pivot), radians));
}

/**
 * Exact equality. Safe for model coordinates, which are always whole
 * millimetres; use {@link nearlyEquals} for anything computed.
 */
export function equals(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Equality within a tolerance, for values that have been through arithmetic. */
export function nearlyEquals(a: Vec2, b: Vec2, tolerance: number): boolean {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

/** Round both components to whole millimetres, symmetrically about zero. */
export function roundVec2(v: Vec2): Vec2 {
  return {
    x: noNegativeZero(v.x < 0 ? -Math.round(-v.x) : Math.round(v.x)),
    y: noNegativeZero(v.y < 0 ? -Math.round(-v.y) : Math.round(v.y)),
  };
}

/** True when a segment is horizontal or vertical within tolerance. */
export function isAxisAligned(a: Vec2, b: Vec2, tolerance = 0): boolean {
  return Math.abs(a.x - b.x) <= tolerance || Math.abs(a.y - b.y) <= tolerance;
}

/**
 * Snap a point so the segment from `anchor` to it runs exactly horizontally or
 * vertically, whichever it is already closer to. This is how wall drawing keeps
 * the graph rectilinear without fighting the pointer.
 */
export function snapAxisAligned(anchor: Vec2, point: Vec2): Vec2 {
  const dx = Math.abs(point.x - anchor.x);
  const dy = Math.abs(point.y - anchor.y);
  return dx >= dy ? { x: point.x, y: anchor.y } : { x: anchor.x, y: point.y };
}
