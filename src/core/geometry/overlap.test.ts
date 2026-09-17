import { describe, expect, it } from 'vitest';

import {
  clipPolygon,
  heightsOverlap,
  isConvex,
  overlapArea,
  polygonInside,
  polygonsOverlap,
} from './overlap.ts';
import { type Polygon } from './polygon.ts';

function rect(x: number, y: number, width: number, depth: number): Polygon {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + depth },
    { x, y: y + depth },
  ];
}

describe('polygons overlapping', () => {
  it('sees two rectangles that cross', () => {
    expect(polygonsOverlap(rect(0, 0, 100, 100), rect(50, 50, 100, 100))).toBe(true);
  });

  it('sees one rectangle entirely inside another', () => {
    // No edges cross at all here, which is exactly the case an edge-crossing
    // test on its own would miss.
    expect(polygonsOverlap(rect(0, 0, 1000, 1000), rect(400, 400, 100, 100))).toBe(true);
    expect(polygonsOverlap(rect(400, 400, 100, 100), rect(0, 0, 1000, 1000))).toBe(true);
  });

  it('sees a plus sign, where neither holds a corner of the other', () => {
    const upright = rect(400, 0, 200, 1000);
    const across = rect(0, 400, 1000, 200);

    expect(polygonsOverlap(upright, across)).toBe(true);
  });

  it('does not count two shapes merely touching', () => {
    // A wardrobe flat against a wall, and a bedside table pushed up against the
    // bed. Everything here is placed to the millimetre and things are meant to
    // touch; flagging that would flag every well-planned room.
    expect(polygonsOverlap(rect(0, 0, 100, 100), rect(100, 0, 100, 100))).toBe(false);
    expect(polygonsOverlap(rect(0, 0, 100, 100), rect(100, 100, 100, 100))).toBe(false);
  });

  it('does not count a corner landing part-way along an edge', () => {
    // A bedside table against the side of a bed: the table's corners land in
    // the middle of the bed's long edge, sharing only part of it. This is the
    // arrangement a corner-in-shape or edge-crossing test gets wrong, and it is
    // the commonest thing in a furnished room.
    const bed = rect(300, 550, 1400, 1900);
    const table = rect(1700, 550, 450, 400);

    expect(polygonsOverlap(bed, table)).toBe(false);
  });

  it('does count the same table moved 50mm into the bed', () => {
    expect(polygonsOverlap(rect(300, 550, 1400, 1900), rect(1650, 550, 450, 400))).toBe(true);
  });

  it('does not count shapes that are simply apart', () => {
    expect(polygonsOverlap(rect(0, 0, 100, 100), rect(500, 500, 100, 100))).toBe(false);
  });

  it('sees a one-millimetre overlap', () => {
    // The threshold has to be tight: a wardrobe 1mm into a doorway really does
    // stop the door, and "nearly fits" is the answer this app exists to refuse.
    expect(polygonsOverlap(rect(0, 0, 100, 100), rect(98, 0, 100, 100))).toBe(true);
  });

  it('handles a shape that is not a rectangle', () => {
    const lShape: Polygon = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 300 },
      { x: 0, y: 300 },
    ];

    // In the notch of the L, which is outside it.
    expect(polygonsOverlap(lShape, rect(150, 150, 100, 100))).toBe(false);
    // In the arm of it.
    expect(polygonsOverlap(lShape, rect(150, 20, 100, 60))).toBe(true);
  });
});

describe('how much they overlap', () => {
  it('is zero for shapes that are apart', () => {
    expect(overlapArea(rect(0, 0, 100, 100), rect(500, 0, 100, 100))).toBe(0);
  });

  it('is the whole of the smaller when it is contained', () => {
    expect(overlapArea(rect(0, 0, 1000, 1000), rect(200, 200, 400, 400))).toBeCloseTo(160_000, -3);
  });

  it('is about a quarter for a corner overlap', () => {
    const shared = overlapArea(rect(0, 0, 1000, 1000), rect(500, 500, 1000, 1000));
    expect(shared / 1_000_000).toBeCloseTo(0.25, 1);
  });
});

describe('containment', () => {
  it('knows when a shape is wholly within another', () => {
    expect(polygonInside(rect(100, 100, 100, 100), rect(0, 0, 1000, 1000))).toBe(true);
    expect(polygonInside(rect(-50, 100, 100, 100), rect(0, 0, 1000, 1000))).toBe(false);
  });

  it('counts a shape flat against the boundary as inside', () => {
    // Furniture against a wall has its back exactly on the room's edge, which
    // must not read as "outside the room".
    expect(polygonInside(rect(0, 0, 100, 100), rect(0, 0, 1000, 1000))).toBe(true);
  });
});

describe('heights overlapping', () => {
  it('is what makes a rug under a table not a collision', () => {
    const rug = { bottom: 0, top: 15 };
    const tableTop = { bottom: 710, top: 750 };
    expect(heightsOverlap(rug, tableTop)).toBe(false);
  });

  it('is what makes a shelf over a desk not a collision', () => {
    expect(heightsOverlap({ bottom: 0, top: 750 }, { bottom: 1400, top: 1440 })).toBe(false);
  });

  it('sees two things at the same height', () => {
    expect(heightsOverlap({ bottom: 0, top: 850 }, { bottom: 0, top: 2100 })).toBe(true);
  });

  it('does not count things merely stacked', () => {
    expect(heightsOverlap({ bottom: 0, top: 500 }, { bottom: 500, top: 900 })).toBe(false);
  });
});

describe('clipping', () => {
  it('returns the shared rectangle of two rectangles', () => {
    const shared = clipPolygon(rect(0, 0, 100, 100), rect(50, 50, 100, 100));
    const box = shared.reduce(
      (acc, point) => ({
        minX: Math.min(acc.minX, point.x),
        maxX: Math.max(acc.maxX, point.x),
        minY: Math.min(acc.minY, point.y),
        maxY: Math.max(acc.maxY, point.y),
      }),
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
    );

    expect(box).toEqual({ minX: 50, maxX: 100, minY: 50, maxY: 100 });
  });

  it('returns nothing when they do not meet', () => {
    expect(clipPolygon(rect(0, 0, 100, 100), rect(500, 0, 100, 100))).toEqual([]);
  });

  it('knows a convex shape from a concave one', () => {
    expect(isConvex(rect(0, 0, 100, 100))).toBe(true);
    expect(
      isConvex([
        { x: 0, y: 0 },
        { x: 300, y: 0 },
        { x: 300, y: 100 },
        { x: 100, y: 100 },
        { x: 100, y: 300 },
        { x: 0, y: 300 },
      ]),
    ).toBe(false);
  });
});
