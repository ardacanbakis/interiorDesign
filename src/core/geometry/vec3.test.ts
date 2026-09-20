import { describe, expect, it } from 'vitest';

import {
  add3,
  cross3,
  distance3,
  dot3,
  flatten,
  length3,
  lerp3,
  lift,
  nearlyEquals3,
  negate3,
  normalize3,
  ORIGIN3,
  scale3,
  sub3,
  UP,
  vec3,
} from './vec3.ts';

describe('vec3 — arithmetic', () => {
  it('adds, subtracts, scales and negates componentwise', () => {
    expect(add3(vec3(1, 2, 3), vec3(10, 20, 30))).toEqual(vec3(11, 22, 33));
    expect(sub3(vec3(10, 20, 30), vec3(1, 2, 3))).toEqual(vec3(9, 18, 27));
    expect(scale3(vec3(1, -2, 3), 2)).toEqual(vec3(2, -4, 6));
    expect(negate3(vec3(1, -2, 0))).toEqual(vec3(-1, 2, -0));
  });

  it('measures length and distance', () => {
    expect(length3(vec3(3, 4, 12))).toBe(13);
    expect(distance3(vec3(1, 1, 1), vec3(4, 5, 13))).toBe(13);
    expect(length3(ORIGIN3)).toBe(0);
  });

  it('normalizes, and leaves a zero vector alone rather than dividing by zero', () => {
    expect(normalize3(vec3(0, 0, 5))).toEqual(UP);
    expect(normalize3(ORIGIN3)).toEqual(ORIGIN3);
  });

  it('interpolates', () => {
    expect(lerp3(ORIGIN3, vec3(10, 20, 30), 0.5)).toEqual(vec3(5, 10, 15));
  });
});

describe('vec3 — the conventions the renderer rests on', () => {
  it('has X cross Y pointing up', () => {
    // Every outward normal in the scene builder is derived from this. If it
    // ever flips, the 3D view turns inside out.
    expect(cross3(vec3(1, 0, 0), vec3(0, 1, 0))).toEqual(UP);
  });

  it('gives a clockwise-on-screen triangle an upward normal', () => {
    // Clockwise on screen is the positive winding in polygon.ts, so a floor
    // polygon lifted straight into 3D already faces the right way.
    const a = vec3(0, 0, 0);
    const b = vec3(100, 0, 0);
    const c = vec3(100, 100, 0);

    const normal = normalize3(cross3(sub3(b, a), sub3(c, b)));
    expect(normal).toEqual(UP);
  });

  it('keeps the plan coordinates untouched when lifting and dropping', () => {
    const plan = { x: 1200, y: -450 };
    expect(lift(plan, 2700)).toEqual(vec3(1200, -450, 2700));
    expect(flatten(lift(plan, 2700))).toEqual(plan);
  });

  it('reads a dot product as a projection onto a direction', () => {
    expect(dot3(vec3(3, 4, 5), UP)).toBe(5);
    expect(dot3(UP, vec3(1, 1, 0))).toBe(0);
  });

  it('compares within a tolerance, for values that have been through arithmetic', () => {
    expect(nearlyEquals3(vec3(1, 2, 3), vec3(1.0004, 2, 3), 0.001)).toBe(true);
    expect(nearlyEquals3(vec3(1, 2, 3), vec3(1.01, 2, 3), 0.001)).toBe(false);
  });
});
