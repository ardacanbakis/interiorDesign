import { describe, expect, it } from 'vitest';

import { area as polygonArea, boundingBox } from '../geometry/polygon.ts';
import { vec2 } from '../geometry/vec2.ts';
import { extractFaces } from './faces.ts';
import { insetRing, roomGeometry } from './roomGeometry.ts';
import { graphFromSegments, insertWall, rectangleSegments } from './wallGraph.ts';

const squareMetres = (value: number) => Number((value / 1_000_000).toFixed(4));

describe('insetRing', () => {
  // A 4m x 3m ring, wound clockwise on screen.
  const ring = [vec2(0, 0), vec2(4000, 0), vec2(4000, 3000), vec2(0, 3000)];

  it('pulls every edge in by a uniform amount', () => {
    const result = insetRing(ring, [50, 50, 50, 50])!;

    expect(boundingBox(result)).toEqual({ minX: 50, minY: 50, maxX: 3950, maxY: 2950 });
  });

  it('pulls each edge in by its own amount', () => {
    // Thick wall on top (125), thin ones elsewhere (50).
    const result = insetRing(ring, [125, 50, 50, 50])!;

    expect(boundingBox(result)).toEqual({ minX: 50, minY: 125, maxX: 3950, maxY: 2950 });
  });

  it('works the same for a ring wound the other way', () => {
    const anticlockwise = [...ring].reverse();
    const result = insetRing(anticlockwise, [50, 50, 50, 50])!;

    expect(boundingBox(result)).toEqual({ minX: 50, minY: 50, maxX: 3950, maxY: 2950 });
  });

  it('insets a concave (L-shaped) ring', () => {
    const lShape = [
      vec2(0, 0),
      vec2(4000, 0),
      vec2(4000, 1500),
      vec2(2000, 1500),
      vec2(2000, 3000),
      vec2(0, 3000),
    ];

    const result = insetRing(lShape, new Array(6).fill(50))!;

    expect(boundingBox(result)).toEqual({ minX: 50, minY: 50, maxX: 3950, maxY: 2950 });

    // The reflex corner at (2000, 1500) moves to (1950, 1450) — the notch gets
    // *bigger*, because the two walls forming it take their thickness out of
    // this room just as the outer walls do.
    expect(result).toContainEqual({ x: 1950, y: 1450 });

    // Top strip 3900 x 1400 plus bottom-left 1900 x 1500.
    expect(Math.abs(polygonArea(result))).toBe(3900 * 1400 + 1900 * 1500);
  });

  it('returns null when the walls eat the room', () => {
    // A 300mm cupboard between two 250mm walls has no floor left.
    const tiny = [vec2(0, 0), vec2(300, 0), vec2(300, 300), vec2(0, 300)];
    expect(insetRing(tiny, [200, 200, 200, 200])).toBeNull();
  });

  it('returns null for degenerate input', () => {
    expect(insetRing([vec2(0, 0), vec2(1, 1)], [1, 1])).toBeNull();
    expect(insetRing([vec2(0, 0), vec2(10, 0), vec2(20, 0)], [1, 1, 1])).toBeNull();
    // Mismatched offset count.
    expect(insetRing([vec2(0, 0), vec2(10, 0), vec2(10, 10)], [1, 1])).toBeNull();
  });
});

describe('roomGeometry — a single room', () => {
  it('measures the floor inside the walls, not along their centrelines', () => {
    // Walls are drawn on their centrelines 4m apart, and are 250mm thick, so
    // the floor between them is 3.75m — which is what a tape measure reports.
    const graph = graphFromSegments(rectangleSegments(0, 0, 4000, 3000, 'exterior'));
    const face = extractFaces(graph)[0]!;
    const room = roomGeometry(graph, face);

    expect(boundingBox(room.outline)).toEqual({
      minX: 125,
      minY: 125,
      maxX: 3875,
      maxY: 2875,
    });
    expect(squareMetres(room.area)).toBe(squareMetres(3750 * 2750));
    expect(room.perimeter).toBe(2 * (3750 + 2750));
  });

  it('is smaller than the centreline area', () => {
    const graph = graphFromSegments(rectangleSegments(0, 0, 4000, 3000, 'exterior'));
    const face = extractFaces(graph)[0]!;

    expect(roomGeometry(graph, face).area).toBeLessThan(face.area);
  });

  it('puts the interior point inside the usable floor', () => {
    const graph = graphFromSegments(rectangleSegments(0, 0, 4000, 3000, 'exterior'));
    const room = roomGeometry(graph, extractFaces(graph)[0]!);

    expect(room.interiorPoint).toEqual({ x: 2000, y: 1500 });
  });
});

describe('roomGeometry — shared walls', () => {
  it('splits a shared wall evenly between the two rooms it separates', () => {
    // A 6m x 3m exterior shell divided by a single 100mm interior wall. The
    // divider must take 50mm from each side, not 100mm from both — the whole
    // reason walls are shared rather than duplicated.
    const shell = graphFromSegments(rectangleSegments(0, 0, 6000, 3000, 'exterior'));
    const graph = insertWall(shell, vec2(3000, 0), vec2(3000, 3000), { kind: 'interior' }).graph;

    const faces = extractFaces(graph);
    expect(faces).toHaveLength(2);

    const rooms = faces.map((face) => roomGeometry(graph, face));

    for (const room of rooms) {
      const box = boundingBox(room.outline);
      // Exterior walls are 250 thick (125 each side), the divider 100 (50 each).
      expect(box.maxX - box.minX).toBe(6000 / 2 - 125 - 50);
      expect(box.maxY - box.minY).toBe(3000 - 250);
    }

    // The two floors plus the material between them account for the whole shell.
    const floorWidths = rooms.map((room) => {
      const box = boundingBox(room.outline);
      return box.maxX - box.minX;
    });
    const wallWidths = 250 + 100; // two exterior halves plus the full divider
    expect(floorWidths[0]! + floorWidths[1]! + wallWidths).toBe(6000);
  });

  it('gives a thicker wall a bigger bite out of both rooms', () => {
    const shell = graphFromSegments(rectangleSegments(0, 0, 6000, 3000, 'exterior'));
    const thin = insertWall(shell, vec2(3000, 0), vec2(3000, 3000), { thickness: 100 }).graph;
    const thick = insertWall(shell, vec2(3000, 0), vec2(3000, 3000), { thickness: 300 }).graph;

    const thinArea = roomGeometry(thin, extractFaces(thin)[0]!).area;
    const thickArea = roomGeometry(thick, extractFaces(thick)[0]!).area;

    expect(thickArea).toBeLessThan(thinArea);
  });
});

describe('roomGeometry — awkward shapes', () => {
  it('handles an L-shaped room', () => {
    const graph = graphFromSegments([
      { from: [0, 0], to: [4000, 0], kind: 'exterior' },
      { from: [4000, 0], to: [4000, 1500], kind: 'exterior' },
      { from: [4000, 1500], to: [2000, 1500], kind: 'exterior' },
      { from: [2000, 1500], to: [2000, 3000], kind: 'exterior' },
      { from: [2000, 3000], to: [0, 3000], kind: 'exterior' },
      { from: [0, 3000], to: [0, 0], kind: 'exterior' },
    ]);

    const room = roomGeometry(graph, extractFaces(graph)[0]!);

    expect(room.outline).toHaveLength(6);
    expect(room.area).toBeGreaterThan(0);
    expect(room.area).toBeLessThan(9_000_000);
  });

  it('ignores a stub partition that divides nothing', () => {
    // The face traversal walks out along the stub and back, leaving a
    // zero-width spur in the ring. Without trimming it the offset would
    // self-intersect and the area would be nonsense.
    const shell = graphFromSegments(rectangleSegments(0, 0, 4000, 3000, 'exterior'));
    const withStub = insertWall(shell, vec2(2000, 0), vec2(2000, 1000)).graph;

    const plain = roomGeometry(shell, extractFaces(shell)[0]!);
    const stubbed = roomGeometry(withStub, extractFaces(withStub)[0]!);

    expect(stubbed.area).toBe(plain.area);
    expect(stubbed.outline).toHaveLength(4);
  });

  it('falls back to the centreline outline rather than returning a knot', () => {
    // A 200mm broom cupboard between 250mm walls: there is no floor left, but
    // the app must still get a usable polygon back rather than a crash.
    const graph = graphFromSegments(rectangleSegments(0, 0, 200, 200, 'exterior'));
    const face = extractFaces(graph)[0]!;
    const room = roomGeometry(graph, face);

    expect(room.outline).toEqual(face.polygon);
  });
});

describe('roomGeometry — holes', () => {
  it('grows a freestanding column by its own wall thickness', () => {
    const graph = graphFromSegments([
      ...rectangleSegments(0, 0, 4000, 4000, 'exterior'),
      ...rectangleSegments(1500, 1500, 1000, 1000, 'exterior'),
    ]);

    const face = extractFaces(graph).find((entry) => entry.holes.length === 1)!;
    const room = roomGeometry(graph, face);

    expect(room.holes).toHaveLength(1);

    // The column's centreline footprint is 1m square; with 250mm walls the
    // solid outside of it is 1.25m square.
    const box = boundingBox(room.holes[0]!);
    expect(box.maxX - box.minX).toBe(1250);
    expect(box.maxY - box.minY).toBe(1250);

    // And the floor excludes it.
    expect(room.area).toBe(3750 * 3750 - 1250 * 1250);
  });
});
