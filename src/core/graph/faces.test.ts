import { describe, expect, it } from 'vitest';

import { containsPoint } from '../geometry/polygon.ts';
import { vec2 } from '../geometry/vec2.ts';
import { extractFaces } from './faces.ts';
import {
  EMPTY_GRAPH,
  graphFromSegments,
  insertWall,
  rectangleSegments,
  removeWall,
  type WallGraph,
} from './wallGraph.ts';

/** Areas in square metres, largest first — the readable form for assertions. */
function areasInSquareMetres(graph: WallGraph): number[] {
  return extractFaces(graph).map((face) => Number((face.area / 1_000_000).toFixed(4)));
}

describe('extractFaces — nothing to find', () => {
  it('finds no faces in an empty graph', () => {
    expect(extractFaces(EMPTY_GRAPH)).toHaveLength(0);
  });

  it('finds no faces in a single wall', () => {
    expect(extractFaces(insertWall(EMPTY_GRAPH, vec2(0, 0), vec2(1000, 0)).graph)).toHaveLength(0);
  });

  it('finds no faces in an open run of walls', () => {
    // Three sides of a rectangle: no enclosed area.
    const graph = graphFromSegments([
      { from: [0, 0], to: [4000, 0] },
      { from: [4000, 0], to: [4000, 3000] },
      { from: [4000, 3000], to: [0, 3000] },
    ]);
    expect(extractFaces(graph)).toHaveLength(0);
  });

  it('finds no faces in a tree of walls', () => {
    // A spine with two stubs — connected, but no cycle anywhere.
    const graph = graphFromSegments([
      { from: [0, 0], to: [3000, 0] },
      { from: [1000, 0], to: [1000, 1000] },
      { from: [2000, 0], to: [2000, -1000] },
    ]);
    expect(extractFaces(graph)).toHaveLength(0);
  });
});

describe('extractFaces — single rooms', () => {
  it('finds one face in a closed rectangle, with the right area', () => {
    const graph = graphFromSegments(rectangleSegments(0, 0, 4000, 3000));
    const faces = extractFaces(graph);

    expect(faces).toHaveLength(1);
    expect(faces[0]!.area).toBe(12_000_000);
    expect(faces[0]!.nodeIds).toHaveLength(4);
    expect(faces[0]!.wallIds).toHaveLength(4);
    expect(faces[0]!.holes).toHaveLength(0);
  });

  it('winds the face clockwise on screen, so its signed area is positive', () => {
    // This pins the traversal direction. Rotating the other way in
    // `nextInFace` still produces closed rings, but they are the outsides of
    // rooms rather than the insides.
    const graph = graphFromSegments(rectangleSegments(0, 0, 4000, 3000));
    const face = extractFaces(graph)[0]!;

    const first = face.polygon[0]!;
    const second = face.polygon[1]!;
    const third = face.polygon[2]!;
    const turn =
      (second.x - first.x) * (third.y - second.y) - (second.y - first.y) * (third.x - second.x);
    expect(turn).toBeGreaterThan(0);
  });

  it('puts the interior point inside the room', () => {
    const graph = graphFromSegments(rectangleSegments(0, 0, 4000, 3000));
    const face = extractFaces(graph)[0]!;

    expect(containsPoint(face.polygon, face.interiorPoint)).toBe(true);
  });

  it('finds an L-shaped room', () => {
    // 4x3 with a 2x1.5 bite out of the bottom-right: 12 - 3 = 9 m²
    const graph = graphFromSegments([
      { from: [0, 0], to: [4000, 0] },
      { from: [4000, 0], to: [4000, 1500] },
      { from: [4000, 1500], to: [2000, 1500] },
      { from: [2000, 1500], to: [2000, 3000] },
      { from: [2000, 3000], to: [0, 3000] },
      { from: [0, 3000], to: [0, 0] },
    ]);

    expect(areasInSquareMetres(graph)).toEqual([9]);
    expect(extractFaces(graph)[0]!.nodeIds).toHaveLength(6);
  });

  it('finds a U-shaped room', () => {
    const graph = graphFromSegments([
      { from: [0, 0], to: [1000, 0] },
      { from: [1000, 0], to: [1000, 2000] },
      { from: [1000, 2000], to: [2000, 2000] },
      { from: [2000, 2000], to: [2000, 0] },
      { from: [2000, 0], to: [3000, 0] },
      { from: [3000, 0], to: [3000, 3000] },
      { from: [3000, 3000], to: [0, 3000] },
      { from: [0, 3000], to: [0, 0] },
    ]);

    // 3x3 = 9, minus the 1x2 notch = 7 m²
    expect(areasInSquareMetres(graph)).toEqual([7]);

    const face = extractFaces(graph)[0]!;
    expect(containsPoint(face.polygon, face.interiorPoint)).toBe(true);
  });

  it('ignores a dangling stub inside a closed room', () => {
    // A partition attached to one wall but not reaching the other. It does not
    // divide the room, so there is still exactly one face.
    let graph = graphFromSegments(rectangleSegments(0, 0, 4000, 3000));
    graph = insertWall(graph, vec2(2000, 0), vec2(2000, 1000)).graph;

    const faces = extractFaces(graph);
    expect(faces).toHaveLength(1);
    expect(faces[0]!.area).toBe(12_000_000);
  });
});

describe('extractFaces — subdivision', () => {
  it('splits one room into two when a wall is drawn across it', () => {
    const room = graphFromSegments(rectangleSegments(0, 0, 4000, 3000));
    expect(areasInSquareMetres(room)).toEqual([12]);

    const divided = insertWall(room, vec2(2000, 0), vec2(2000, 3000), { kind: 'interior' }).graph;
    expect(areasInSquareMetres(divided)).toEqual([6, 6]);
  });

  it('splits unevenly where the wall actually is', () => {
    const room = graphFromSegments(rectangleSegments(0, 0, 4000, 3000));
    const divided = insertWall(room, vec2(1000, 0), vec2(1000, 3000)).graph;

    expect(areasInSquareMetres(divided)).toEqual([9, 3]);
  });

  it('merges two rooms back into one when the dividing wall is deleted', () => {
    const room = graphFromSegments(rectangleSegments(0, 0, 4000, 3000));
    const { graph: divided, wallIds } = insertWall(room, vec2(2000, 0), vec2(2000, 3000));

    expect(areasInSquareMetres(divided)).toEqual([6, 6]);

    const merged = removeWall(divided, wallIds[0]!);
    expect(areasInSquareMetres(merged)).toEqual([12]);
  });

  it('produces a four-room grid from two crossing walls', () => {
    let graph = graphFromSegments(rectangleSegments(0, 0, 4000, 4000));
    graph = insertWall(graph, vec2(2000, 0), vec2(2000, 4000)).graph;
    graph = insertWall(graph, vec2(0, 2000), vec2(4000, 2000)).graph;

    expect(areasInSquareMetres(graph)).toEqual([4, 4, 4, 4]);
  });

  it('handles a six-room plan with uneven divisions', () => {
    // A 6m x 4m footprint cut into a 2x3 grid of unequal rooms.
    let graph = graphFromSegments(rectangleSegments(0, 0, 6000, 4000));
    graph = insertWall(graph, vec2(0, 1500), vec2(6000, 1500)).graph;
    graph = insertWall(graph, vec2(2000, 0), vec2(2000, 4000)).graph;
    graph = insertWall(graph, vec2(4500, 0), vec2(4500, 4000)).graph;

    // Top strip (h=1500): 2.0 x 1.5, 2.5 x 1.5, 1.5 x 1.5 = 3.0, 3.75, 2.25
    // Bottom strip (h=2500): 2.0 x 2.5, 2.5 x 2.5, 1.5 x 2.5 = 5.0, 6.25, 3.75
    expect(areasInSquareMetres(graph)).toEqual([6.25, 5, 3.75, 3.75, 3, 2.25]);
  });

  it('finds rooms in a plan built from separate overlapping rectangles', () => {
    // Two rooms drawn independently that happen to share a wall. The shared
    // wall exists once, and both rooms are found.
    const graph = graphFromSegments([
      ...rectangleSegments(0, 0, 3000, 3000),
      ...rectangleSegments(3000, 0, 2000, 3000),
    ]);

    expect(areasInSquareMetres(graph)).toEqual([9, 6]);
  });

  it('finds rooms of a T-shaped plan', () => {
    // A wide top room with a narrower room hanging below it.
    let graph = graphFromSegments(rectangleSegments(0, 0, 6000, 2000));
    graph = insertWall(graph, vec2(2000, 2000), vec2(2000, 5000)).graph;
    graph = insertWall(graph, vec2(2000, 5000), vec2(4000, 5000)).graph;
    graph = insertWall(graph, vec2(4000, 5000), vec2(4000, 2000)).graph;

    // 6x2 = 12 up top, 2x3 = 6 below.
    expect(areasInSquareMetres(graph)).toEqual([12, 6]);
  });
});

describe('extractFaces — disconnected plans', () => {
  it('finds rooms in two buildings that do not touch', () => {
    const graph = graphFromSegments([
      ...rectangleSegments(0, 0, 2000, 2000),
      ...rectangleSegments(10_000, 0, 3000, 3000),
    ]);

    // Each component has its own unbounded face; neither is mistaken for a room.
    expect(areasInSquareMetres(graph)).toEqual([9, 4]);
  });
});

describe('extractFaces — holes', () => {
  it('subtracts a freestanding column from the room it stands in', () => {
    // A 4x4 room with a 1x1 column floating in the middle, touching nothing.
    const graph = graphFromSegments([
      ...rectangleSegments(0, 0, 4000, 4000),
      ...rectangleSegments(1500, 1500, 1000, 1000),
    ]);

    const faces = extractFaces(graph);

    // The room, and the column's own interior — which is a bounded face too.
    expect(faces).toHaveLength(2);

    const room = faces[0]!;
    expect(room.holes).toHaveLength(1);
    // 16 m² less the 1 m² column.
    expect(room.area).toBe(15_000_000);

    const column = faces[1]!;
    expect(column.area).toBe(1_000_000);
    expect(column.holes).toHaveLength(0);
  });

  it('attaches a hole to the innermost room containing it', () => {
    // A column inside a small room, inside a larger building outline.
    const graph = graphFromSegments([
      ...rectangleSegments(0, 0, 10_000, 10_000),
      ...rectangleSegments(1000, 1000, 4000, 4000),
      ...rectangleSegments(2000, 2000, 1000, 1000),
    ]);

    const faces = extractFaces(graph);
    const inner = faces.find((face) => Math.round(face.area / 1_000_000) === 15);

    // The 4x4 inner room keeps the column, not the 10x10 outer one.
    expect(inner).toBeDefined();
    expect(inner!.holes).toHaveLength(1);
  });
});

describe('extractFaces — face ids', () => {
  it('gives the same id regardless of which half-edge the trace starts from', () => {
    const graph = graphFromSegments(rectangleSegments(0, 0, 4000, 3000));
    const first = extractFaces(graph)[0]!.id;

    // Rebuilding the same plan by drawing the walls in a different order
    // produces the same ring, so the same id.
    const reordered = graphFromSegments([
      { from: [0, 3000], to: [0, 0], kind: 'exterior' },
      { from: [0, 0], to: [4000, 0], kind: 'exterior' },
      { from: [4000, 0], to: [4000, 3000], kind: 'exterior' },
      { from: [4000, 3000], to: [0, 3000], kind: 'exterior' },
    ]);

    expect(extractFaces(reordered)[0]!.id).toBe(first);
  });

  it('gives distinct ids to distinct rooms', () => {
    const graph = insertWall(
      graphFromSegments(rectangleSegments(0, 0, 4000, 3000)),
      vec2(2000, 0),
      vec2(2000, 3000),
    ).graph;

    const [left, right] = extractFaces(graph);
    expect(left!.id).not.toBe(right!.id);
  });
});

describe('extractFaces — ordering', () => {
  it('returns faces largest first', () => {
    let graph = graphFromSegments(rectangleSegments(0, 0, 6000, 3000));
    graph = insertWall(graph, vec2(1000, 0), vec2(1000, 3000)).graph;
    graph = insertWall(graph, vec2(4000, 0), vec2(4000, 3000)).graph;

    const areas = extractFaces(graph).map((face) => face.area);
    expect(areas).toEqual([...areas].sort((left, right) => right - left));
  });
});
