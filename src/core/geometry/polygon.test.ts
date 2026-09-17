import { describe, expect, it } from 'vitest';

import {
  area,
  boundingBox,
  boundingBoxesOverlap,
  centroid,
  containsPoint,
  distanceToBoundary,
  isClockwise,
  isPointInsidePolygon,
  perimeter,
  representativePoint,
  reverse,
  signedArea,
  withWinding,
} from './polygon.ts';
import { vec2, type Vec2 } from './vec2.ts';

/**
 * A 4m x 3m room, wound clockwise as it appears on screen:
 * top-left -> top-right -> bottom-right -> bottom-left.
 */
const room: Vec2[] = [vec2(0, 0), vec2(4000, 0), vec2(4000, 3000), vec2(0, 3000)];

/** An L-shape: a 4x3 room with a 2x1.5 bite taken out of the bottom-right. */
const lShape: Vec2[] = [
  vec2(0, 0),
  vec2(4000, 0),
  vec2(4000, 1500),
  vec2(2000, 1500),
  vec2(2000, 3000),
  vec2(0, 3000),
];

describe('signedArea', () => {
  it('is positive for a ring wound clockwise on screen', () => {
    // This pins the y-down convention. If this flips, face extraction's
    // interior/exterior classification flips with it.
    expect(signedArea(room)).toBe(12_000_000);
  });

  it('is negative for the same ring wound the other way', () => {
    expect(signedArea(reverse(room))).toBe(-12_000_000);
  });

  it('is zero for degenerate rings', () => {
    expect(signedArea([])).toBe(0);
    expect(signedArea([vec2(0, 0)])).toBe(0);
    expect(signedArea([vec2(0, 0), vec2(10, 10)])).toBe(0);
  });

  it('is zero for a collinear ring with no enclosed area', () => {
    expect(signedArea([vec2(0, 0), vec2(10, 0), vec2(20, 0)])).toBe(0);
  });
});

describe('area', () => {
  it('ignores winding', () => {
    expect(area(room)).toBe(12_000_000);
    expect(area(reverse(room))).toBe(12_000_000);
  });

  it('handles a concave ring', () => {
    // 4x3 minus the 2x1.5 bite = 12 - 3 = 9 m²
    expect(area(lShape)).toBe(9_000_000);
  });
});

describe('isClockwise / withWinding', () => {
  it('identifies screen-clockwise winding', () => {
    expect(isClockwise(room)).toBe(true);
    expect(isClockwise(reverse(room))).toBe(false);
  });

  it('leaves an already-correct ring untouched', () => {
    expect(withWinding(room, true)).toBe(room);
  });

  it('flips a ring that needs it', () => {
    expect(isClockwise(withWinding(reverse(room), true))).toBe(true);
    expect(isClockwise(withWinding(room, false))).toBe(false);
  });
});

describe('perimeter', () => {
  it('measures the closed ring', () => {
    expect(perimeter(room)).toBe(14_000);
  });

  it('is zero for a single point', () => {
    expect(perimeter([vec2(5, 5)])).toBe(0);
  });
});

describe('centroid', () => {
  it('finds the centre of a rectangle', () => {
    expect(centroid(room)).toEqual({ x: 2000, y: 1500 });
  });

  it('is area-weighted, not a vertex average', () => {
    // Derived by decomposing the L into two rectangles:
    //   top strip     4000 x 1500 centred (2000,  750), area 6.0 m²
    //   bottom-left   2000 x 1500 centred (1000, 2250), area 3.0 m²
    //   x = (6e6*2000 + 3e6*1000) / 9e6 = 1666.67
    //   y = (6e6* 750 + 3e6*2250) / 9e6 = 1250
    const result = centroid(lShape);
    expect(result.x).toBeCloseTo(1666.67, 1);
    expect(result.y).toBeCloseTo(1250, 1);

    // The vertex average sits at (2000, 1500) — pulled towards the corner with
    // the most vertices, and a worse place for a room label.
    const vertexMean = {
      x: lShape.reduce((sum, p) => sum + p.x, 0) / lShape.length,
      y: lShape.reduce((sum, p) => sum + p.y, 0) / lShape.length,
    };
    expect(vertexMean).toEqual({ x: 2000, y: 1500 });
    expect(result).not.toEqual(vertexMean);
  });

  it('falls back gracefully for degenerate rings', () => {
    expect(centroid([])).toEqual({ x: 0, y: 0 });
    expect(centroid([vec2(4, 6)])).toEqual({ x: 4, y: 6 });
    expect(centroid([vec2(0, 0), vec2(10, 0)])).toEqual({ x: 5, y: 0 });
    // Collinear: no area to weight by.
    expect(centroid([vec2(0, 0), vec2(10, 0), vec2(20, 0)])).toEqual({ x: 10, y: 0 });
  });
});

describe('boundingBox', () => {
  it('bounds a ring', () => {
    expect(boundingBox(room)).toEqual({ minX: 0, minY: 0, maxX: 4000, maxY: 3000 });
  });

  it('handles an empty ring', () => {
    expect(boundingBox([])).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });
});

describe('boundingBoxesOverlap', () => {
  const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

  it('detects overlap', () => {
    expect(boundingBoxesOverlap(a, { minX: 5, minY: 5, maxX: 15, maxY: 15 })).toBe(true);
  });

  it('counts a shared edge as overlapping', () => {
    expect(boundingBoxesOverlap(a, { minX: 10, minY: 0, maxX: 20, maxY: 10 })).toBe(true);
  });

  it('rejects disjoint boxes', () => {
    expect(boundingBoxesOverlap(a, { minX: 11, minY: 0, maxX: 20, maxY: 10 })).toBe(false);
  });
});

describe('containsPoint', () => {
  it('accepts interior points', () => {
    expect(containsPoint(room, vec2(2000, 1500))).toBe(true);
    expect(containsPoint(room, vec2(1, 1))).toBe(true);
  });

  it('rejects exterior points', () => {
    expect(containsPoint(room, vec2(-1, 1500))).toBe(false);
    expect(containsPoint(room, vec2(4001, 1500))).toBe(false);
    expect(containsPoint(room, vec2(2000, -1))).toBe(false);
    expect(containsPoint(room, vec2(2000, 3001))).toBe(false);
  });

  it('respects concavity — the bite is outside', () => {
    expect(containsPoint(lShape, vec2(3000, 2500))).toBe(false);
    expect(containsPoint(lShape, vec2(3000, 500))).toBe(true);
    expect(containsPoint(lShape, vec2(1000, 2500))).toBe(true);
  });

  it('is winding-independent', () => {
    expect(containsPoint(reverse(room), vec2(2000, 1500))).toBe(true);
  });

  it('rejects everything for a degenerate ring', () => {
    expect(containsPoint([vec2(0, 0), vec2(10, 0)], vec2(5, 0))).toBe(false);
  });
});

describe('distanceToBoundary', () => {
  it('measures to the nearest wall', () => {
    // Centre of a 4x3 room: nearest wall is 1500 away (top or bottom).
    expect(distanceToBoundary(room, vec2(2000, 1500))).toBe(1500);
    expect(distanceToBoundary(room, vec2(100, 1500))).toBe(100);
  });

  it('is non-negative for exterior points too', () => {
    expect(distanceToBoundary(room, vec2(-500, 1500))).toBe(500);
  });
});

describe('isPointInsidePolygon', () => {
  it('honours a margin', () => {
    expect(isPointInsidePolygon(room, vec2(100, 1500), 50)).toBe(true);
    expect(isPointInsidePolygon(room, vec2(100, 1500), 200)).toBe(false);
  });

  it('with no margin behaves like containsPoint', () => {
    expect(isPointInsidePolygon(room, vec2(1, 1500))).toBe(true);
    expect(isPointInsidePolygon(room, vec2(-1, 1500))).toBe(false);
  });
});

describe('representativePoint', () => {
  it('uses the centroid when it lands inside', () => {
    expect(representativePoint(room)).toEqual({ x: 2000, y: 1500 });
  });

  it('finds an interior point for a U-shape whose centroid is outside', () => {
    // A U: two legs joined at the bottom. Its centre of mass sits in the gap.
    const uShape = [
      vec2(0, 0),
      vec2(1000, 0),
      vec2(1000, 2000),
      vec2(2000, 2000),
      vec2(2000, 0),
      vec2(3000, 0),
      vec2(3000, 3000),
      vec2(0, 3000),
    ];

    expect(containsPoint(uShape, centroid(uShape))).toBe(false);

    const point = representativePoint(uShape);
    expect(containsPoint(uShape, point)).toBe(true);
  });
});
