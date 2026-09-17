import { describe, expect, it } from 'vitest';

import {
  add,
  angleOf,
  cross,
  negate,
  distance,
  isAxisAligned,
  lerp,
  midpoint,
  nearlyEquals,
  normalize,
  perpendicular,
  rotate,
  rotateAround,
  roundVec2,
  scale,
  snapAxisAligned,
  sub,
  vec2,
} from './vec2.ts';

describe('arithmetic', () => {
  it('adds, subtracts and scales', () => {
    expect(add(vec2(1, 2), vec2(10, 20))).toEqual({ x: 11, y: 22 });
    expect(sub(vec2(10, 20), vec2(1, 2))).toEqual({ x: 9, y: 18 });
    expect(scale(vec2(3, 4), 2)).toEqual({ x: 6, y: 8 });
  });

  it('measures distance', () => {
    expect(distance(vec2(0, 0), vec2(300, 400))).toBe(500);
  });

  it('normalises, leaving a zero vector alone', () => {
    expect(normalize(vec2(0, 5))).toEqual({ x: 0, y: 1 });
    expect(normalize(vec2(0, 0))).toEqual({ x: 0, y: 0 });
  });

  it('interpolates and finds midpoints', () => {
    expect(lerp(vec2(0, 0), vec2(100, 200), 0.25)).toEqual({ x: 25, y: 50 });
    expect(midpoint(vec2(0, 0), vec2(100, 200))).toEqual({ x: 50, y: 100 });
  });
});

/**
 * These pin the y-down convention. Every one of them would flip sign in a
 * y-up system, and a flip here silently reverses door swing sides, wall offset
 * directions and face orientation throughout the app.
 */
describe('orientation conventions (Y points down)', () => {
  it('cross is positive when the second vector turns clockwise on screen', () => {
    // +X is right, +Y is down. Turning from "right" to "down" is clockwise.
    expect(cross(vec2(1, 0), vec2(0, 1))).toBe(1);
    expect(cross(vec2(1, 0), vec2(0, -1))).toBe(-1);
  });

  it('perpendicular turns clockwise on screen', () => {
    // Facing right, the right-hand side is downwards on screen.
    expect(perpendicular(vec2(1, 0))).toEqual({ x: 0, y: 1 });
    expect(perpendicular(vec2(0, 1))).toEqual({ x: -1, y: 0 });
  });

  it('angleOf measures clockwise from +X', () => {
    expect(angleOf(vec2(1, 0))).toBe(0);
    expect(angleOf(vec2(0, 1))).toBeCloseTo(Math.PI / 2);
    expect(angleOf(vec2(-1, 0))).toBeCloseTo(Math.PI);
    expect(angleOf(vec2(0, -1))).toBeCloseTo(-Math.PI / 2);
  });

  it('rotate turns clockwise on screen', () => {
    const rotated = rotate(vec2(1, 0), Math.PI / 2);
    expect(rotated.x).toBeCloseTo(0);
    expect(rotated.y).toBeCloseTo(1);
  });

  it('rotateAround pivots about a point', () => {
    const rotated = rotateAround(vec2(110, 100), vec2(100, 100), Math.PI / 2);
    expect(rotated.x).toBeCloseTo(100);
    expect(rotated.y).toBeCloseTo(110);
  });
});

describe('nearlyEquals', () => {
  it('compares within a tolerance', () => {
    expect(nearlyEquals(vec2(100, 100), vec2(100.4, 99.7), 0.5)).toBe(true);
    expect(nearlyEquals(vec2(100, 100), vec2(101, 100), 0.5)).toBe(false);
  });
});

describe('roundVec2', () => {
  it('rounds both components symmetrically about zero', () => {
    expect(roundVec2(vec2(12.4, 12.6))).toEqual({ x: 12, y: 13 });
    expect(roundVec2(vec2(-0.5, 0.5))).toEqual({ x: -1, y: 1 });
  });
});

describe('negative zero', () => {
  // -0 survives JSON round-trips, compares unequal to 0 under Object.is, and
  // renders as "-0" in SVG path data. It should never reach the model.
  it('never leaks out of a negation', () => {
    expect(Object.is(negate(vec2(0, 0)).x, -0)).toBe(false);
    expect(Object.is(perpendicular(vec2(1, 0)).x, -0)).toBe(false);
    expect(Object.is(roundVec2(vec2(-0.2, 0)).x, -0)).toBe(false);
    expect(Object.is(rotate(vec2(1, 0), Math.PI).y, -0)).toBe(false);
  });

  it('round-trips through JSON unchanged', () => {
    const value = perpendicular(vec2(1, 0));
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
    expect(JSON.stringify(value)).not.toContain('-0');
  });
});

describe('isAxisAligned', () => {
  it('accepts horizontal and vertical segments', () => {
    expect(isAxisAligned(vec2(0, 0), vec2(1000, 0))).toBe(true);
    expect(isAxisAligned(vec2(0, 0), vec2(0, 1000))).toBe(true);
    expect(isAxisAligned(vec2(0, 0), vec2(1000, 1000))).toBe(false);
  });

  it('honours a tolerance', () => {
    expect(isAxisAligned(vec2(0, 0), vec2(1000, 2), 5)).toBe(true);
    expect(isAxisAligned(vec2(0, 0), vec2(1000, 2))).toBe(false);
  });
});

describe('snapAxisAligned', () => {
  it('snaps to whichever axis the drag is already closer to', () => {
    const anchor = vec2(1000, 1000);
    // Mostly horizontal drag -> keep x, flatten y.
    expect(snapAxisAligned(anchor, vec2(2000, 1100))).toEqual({ x: 2000, y: 1000 });
    // Mostly vertical drag -> keep y, flatten x.
    expect(snapAxisAligned(anchor, vec2(1100, 2000))).toEqual({ x: 1000, y: 2000 });
  });

  it('breaks an exact diagonal tie towards horizontal', () => {
    expect(snapAxisAligned(vec2(0, 0), vec2(500, 500))).toEqual({ x: 500, y: 0 });
  });
});
