import { describe, expect, it } from 'vitest';

import { area, signedArea } from '../geometry/polygon.ts';
import { nearlyEquals3, vec3 } from '../geometry/vec3.ts';
import { isDrawable, prism, prismCentre, prismFaces, slabBetween } from './prism.ts';

/** A metre square at the origin, wound anticlockwise on screen. */
const ANTICLOCKWISE = [
  { x: -500, y: -500 },
  { x: -500, y: 500 },
  { x: 500, y: 500 },
  { x: 500, y: -500 },
];

describe('prism — construction', () => {
  it('puts the winding right whichever way the base arrives', () => {
    // Bases come from four different places in the app and only some of them
    // are wound the way the face builder needs.
    expect(signedArea(prism(ANTICLOCKWISE, 0, 1000).base)).toBeGreaterThan(0);
    expect(signedArea(prism([...ANTICLOCKWISE].reverse(), 0, 1000).base)).toBeGreaterThan(0);
  });

  it('orders the heights, so bottom is always the lower one', () => {
    const upsideDown = prism(ANTICLOCKWISE, 2200, 0);
    expect(upsideDown.bottom).toBe(0);
    expect(upsideDown.top).toBe(2200);
  });

  it('rejects anything with no substance to it', () => {
    expect(isDrawable(prism(ANTICLOCKWISE, 0, 1000))).toBe(true);
    // Zero height — a floor covering with no thickness.
    expect(isDrawable(prism(ANTICLOCKWISE, 500, 500))).toBe(false);
    // A base that is a line rather than an area.
    expect(
      isDrawable(
        prism(
          [
            { x: 0, y: 0 },
            { x: 1000, y: 0 },
            { x: 500, y: 0 },
          ],
          0,
          1000,
        ),
      ),
    ).toBe(false);
  });
});

describe('prism — faces', () => {
  const box = prism(ANTICLOCKWISE, 0, 2000);
  const faces = prismFaces(box);

  it('produces a top, a bottom and one side per edge', () => {
    expect(faces).toHaveLength(6);
  });

  it('points the top up and the bottom down', () => {
    expect(faces[0]!.normal).toEqual(vec3(0, 0, 1));
    expect(faces[1]!.normal).toEqual(vec3(0, 0, -1));
    expect(faces[0]!.points.every((point) => point.z === 2000)).toBe(true);
    expect(faces[1]!.points.every((point) => point.z === 0)).toBe(true);
  });

  it('points every side outwards, away from the middle', () => {
    // The test that matters. An inward normal is invisible in the code and
    // obvious on screen — the room turns inside out and lights from within.
    const centre = prismCentre(box);

    for (const face of faces.slice(2)) {
      const anchor = face.points[0]!;
      const outward =
        face.normal.x * (anchor.x - centre.x) +
        face.normal.y * (anchor.y - centre.y) +
        face.normal.z * (anchor.z - centre.z);

      expect(outward).toBeGreaterThan(0);
      // Sides are vertical, so they never tilt.
      expect(face.normal.z).toBe(0);
    }
  });

  it('gives each side the height of the prism and the length of its edge', () => {
    const side = faces[2]!;
    const zs = side.points.map((point) => point.z);
    expect(Math.min(...zs)).toBe(0);
    expect(Math.max(...zs)).toBe(2000);
    expect(side.points).toHaveLength(4);
  });

  it('skips a repeated vertex rather than emitting a face with no normal', () => {
    const repeated = prism(
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 1000 },
        { x: 0, y: 1000 },
      ],
      0,
      100,
    );

    const sides = prismFaces(repeated).slice(2);
    expect(sides).toHaveLength(4);
    for (const side of sides) {
      expect(Math.hypot(side.normal.x, side.normal.y)).toBeCloseTo(1, 9);
    }
  });

  it('finds the middle of a prism', () => {
    expect(nearlyEquals3(prismCentre(prism(ANTICLOCKWISE, 400, 800)), vec3(0, 0, 600), 1)).toBe(
      true,
    );
  });
});

describe('slabBetween', () => {
  it('makes a rectangle of the asked-for length and thickness', () => {
    const slab = slabBetween({ x: 0, y: 0 }, { x: 2000, y: 0 }, 100);
    expect(area(slab)).toBeCloseTo(2000 * 100, 6);
  });

  it('centres it on the line, not to one side', () => {
    const slab = slabBetween({ x: 0, y: 0 }, { x: 2000, y: 0 }, 100);
    const ys = slab.map((point) => point.y);
    expect(Math.min(...ys)).toBeCloseTo(-50, 9);
    expect(Math.max(...ys)).toBeCloseTo(50, 9);
  });

  it('works at any angle', () => {
    const slab = slabBetween({ x: 0, y: 0 }, { x: 300, y: 400 }, 60);
    expect(area(slab)).toBeCloseTo(500 * 60, 6);
  });

  it('returns nothing when the two ends are the same point', () => {
    expect(slabBetween({ x: 10, y: 10 }, { x: 10, y: 10 }, 100)).toEqual([]);
  });
});
