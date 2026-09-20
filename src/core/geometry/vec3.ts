/**
 * 3D points and vectors.
 *
 * ## Coordinate system
 *
 * X and Y are the plan's, unchanged — X to the right, **Y downwards** — and Z
 * is added pointing **up** from the floor. Keeping X and Y identical to
 * `vec2.ts` is the whole reason this is a separate file rather than a rewrite:
 * a footprint becomes a solid by writing two heights beside it, with no flip,
 * no transpose, and no second convention to keep straight.
 *
 * The consequence, as in 2D, is that some signs read backwards from school
 * maths. Every function here that cares says which way it means.
 */

import { type Vec2 } from './vec2.ts';
import { type Mm } from '../units/length.ts';

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export const ORIGIN3: Vec3 = { x: 0, y: 0, z: 0 };

/** Straight up, out of the floor. The one direction the world agrees on. */
export const UP: Vec3 = { x: 0, y: 0, z: 1 };

/** Lift a plan point to a height. */
export function lift(point: Vec2, z: Mm): Vec3 {
  return { x: point.x, y: point.y, z };
}

/** Drop the height, leaving the plan point underneath. */
export function flatten(v: Vec3): Vec2 {
  return { x: v.x, y: v.y };
}

export function add3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale3(v: Vec3, factor: number): Vec3 {
  return { x: v.x * factor, y: v.y * factor, z: v.z * factor };
}

export function negate3(v: Vec3): Vec3 {
  return { x: -v.x, y: -v.y, z: -v.z };
}

export function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * The right-handed cross product, by the usual formula.
 *
 * Worth stating what that gives in this system, because the answer is the one
 * every normal in the renderer depends on: `cross3(X, Y)` is `+Z`, so a
 * polygon's vertices wound **clockwise as seen on screen** — which is the
 * positive winding in `polygon.ts` — have a normal pointing **up**.
 */
export function cross3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function length3(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function distance3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Unit vector in the same direction. A zero vector is returned unchanged. */
export function normalize3(v: Vec3): Vec3 {
  const len = length3(v);
  return len === 0 ? ORIGIN3 : { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export function nearlyEquals3(a: Vec3, b: Vec3, tolerance: number): boolean {
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.z - b.z) <= tolerance
  );
}
