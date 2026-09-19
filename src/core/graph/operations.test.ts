import { describe, expect, it } from 'vitest';

import { boundingBox, containsPoint } from '../geometry/polygon.ts';
import { normalize, perpendicular, sub, vec2 } from '../geometry/vec2.ts';
import { extractFaces } from './faces.ts';
import {
  createLShapedRoom,
  createRoomFromInnerSize,
  drawRoomRect,
  drawWallRun,
  moveWallSideways,
  setWallLength,
} from './operations.ts';
import { roomGeometry } from './roomGeometry.ts';
import {
  allWalls,
  EMPTY_GRAPH,
  getWall,
  graphFromSegments,
  nodePoint,
  rectangleSegments,
  wallLength,
  type WallGraph,
} from './wallGraph.ts';

const areas = (graph: WallGraph) =>
  extractFaces(graph).map((face) => Number((face.area / 1_000_000).toFixed(4)));

describe('drawRoomRect', () => {
  it('draws a closed room from two corners', () => {
    const { graph } = drawRoomRect(EMPTY_GRAPH, vec2(0, 0), vec2(4000, 3000));

    expect(allWalls(graph)).toHaveLength(4);
    expect(areas(graph)).toEqual([12]);
  });

  it('works from any pair of opposite corners', () => {
    for (const [from, to] of [
      [vec2(4000, 3000), vec2(0, 0)],
      [vec2(0, 3000), vec2(4000, 0)],
      [vec2(4000, 0), vec2(0, 3000)],
    ] as const) {
      expect(areas(drawRoomRect(EMPTY_GRAPH, from, to).graph)).toEqual([12]);
    }
  });

  it('ignores a rectangle with no area', () => {
    expect(drawRoomRect(EMPTY_GRAPH, vec2(0, 0), vec2(0, 3000)).graph).toBe(EMPTY_GRAPH);
    expect(drawRoomRect(EMPTY_GRAPH, vec2(500, 500), vec2(500, 500)).graph).toBe(EMPTY_GRAPH);
  });

  it('shares walls with a room it is drawn against', () => {
    // Two rooms side by side, drawn separately, meeting at x = 4000.
    let graph = drawRoomRect(EMPTY_GRAPH, vec2(0, 0), vec2(4000, 3000)).graph;
    graph = drawRoomRect(graph, vec2(4000, 0), vec2(7000, 3000)).graph;

    expect(areas(graph)).toEqual([12, 9]);

    // The wall between them exists once, not twice.
    const shared = allWalls(graph).filter((wall) => {
      const a = nodePoint(graph, wall.a);
      const b = nodePoint(graph, wall.b);
      return a.x === 4000 && b.x === 4000;
    });
    expect(shared).toHaveLength(1);
  });

  it('subdivides a room it is drawn inside', () => {
    let graph = drawRoomRect(EMPTY_GRAPH, vec2(0, 0), vec2(6000, 4000)).graph;
    graph = drawRoomRect(graph, vec2(0, 0), vec2(2000, 4000), 'interior').graph;

    // A 2x4 carved out of a 6x4, leaving 4x4.
    expect(areas(graph)).toEqual([16, 8]);
  });

  it('reports the walls it had to split', () => {
    const shell = drawRoomRect(EMPTY_GRAPH, vec2(0, 0), vec2(6000, 4000)).graph;
    const result = drawRoomRect(shell, vec2(2000, 0), vec2(4000, 4000), 'interior');

    expect(result.splits.length).toBeGreaterThan(0);
  });
});

describe('createRoomFromInnerSize', () => {
  /**
   * The central claim: type a measurement, get a room that measures it.
   *
   * These assert against `roomGeometry`, which computes the floor from the
   * inner faces of the walls — the same calculation the app shows the user —
   * rather than against the centreline rectangle this function actually builds.
   * That is the whole point: the two differ by a wall thickness, and only one
   * of them is what a tape measure reports.
   */
  it('produces a floor of exactly the size asked for', () => {
    const { graph } = createRoomFromInnerSize(EMPTY_GRAPH, {
      width: 3600,
      depth: 4200,
      thickness: 100,
    });

    const room = roomGeometry(graph, extractFaces(graph)[0]!);
    expect(room.area).toBe(3600 * 4200);
  });

  it('holds at every wall thickness', () => {
    // A thicker wall must push the centrelines further out, not eat the floor.
    for (const thickness of [80, 100, 135, 250, 300]) {
      const { graph } = createRoomFromInnerSize(EMPTY_GRAPH, {
        width: 3600,
        depth: 4200,
        thickness,
      });

      const room = roomGeometry(graph, extractFaces(graph)[0]!);
      expect(room.area, `thickness ${thickness}`).toBe(3600 * 4200);

      const box = boundingBox(room.outline);
      expect(box.maxX - box.minX, `thickness ${thickness}`).toBe(3600);
      expect(box.maxY - box.minY, `thickness ${thickness}`).toBe(4200);
    }
  });

  it('stays exact at an odd wall thickness', () => {
    // 135mm (brick plus plaster) halves to 67.5. Rounding both outer corners
    // independently pushes each outwards and the room comes back a millimetre
    // too big in each direction.
    const { graph } = createRoomFromInnerSize(EMPTY_GRAPH, {
      width: 3600,
      depth: 4200,
      thickness: 135,
    });

    const box = boundingBox(roomGeometry(graph, extractFaces(graph)[0]!).outline);
    expect(box.maxX - box.minX).toBe(3600);
    expect(box.maxY - box.minY).toBe(4200);
  });

  it('puts the inside corner at the origin it was given', () => {
    const { graph } = createRoomFromInnerSize(EMPTY_GRAPH, {
      width: 3000,
      depth: 2000,
      thickness: 100,
      origin: vec2(5000, 7000),
    });

    const box = boundingBox(roomGeometry(graph, extractFaces(graph)[0]!).outline);
    expect(box).toEqual({ minX: 5000, minY: 7000, maxX: 8000, maxY: 9000 });
  });

  it('builds the walls at the thickness asked for', () => {
    const { graph } = createRoomFromInnerSize(EMPTY_GRAPH, {
      width: 3000,
      depth: 2000,
      thickness: 135,
    });

    for (const wall of allWalls(graph)) {
      expect(wall.thickness).toBe(135);
    }
  });

  it('is a closed room with four walls', () => {
    const { graph } = createRoomFromInnerSize(EMPTY_GRAPH, {
      width: 3000,
      depth: 2000,
      thickness: 100,
    });

    expect(allWalls(graph)).toHaveLength(4);
    expect(extractFaces(graph)).toHaveLength(1);
  });

  it('ignores a room with no size', () => {
    expect(
      createRoomFromInnerSize(EMPTY_GRAPH, { width: 0, depth: 2000, thickness: 100 }).graph,
    ).toBe(EMPTY_GRAPH);
    expect(
      createRoomFromInnerSize(EMPTY_GRAPH, { width: 3000, depth: -5, thickness: 100 }).graph,
    ).toBe(EMPTY_GRAPH);
  });

  it('shares walls with a room it is placed against', () => {
    // Proof that a room created this way is an ordinary part of a plan and can
    // grow into a house later, not a special case.
    const first = createRoomFromInnerSize(EMPTY_GRAPH, {
      width: 3000,
      depth: 3000,
      thickness: 100,
    }).graph;

    // Butt a second room up against the first one's right-hand wall.
    const second = createRoomFromInnerSize(first, {
      width: 2000,
      depth: 3000,
      thickness: 100,
      origin: vec2(3100, 0),
    }).graph;

    expect(extractFaces(second)).toHaveLength(2);

    // One wall on the boundary between them, not two back to back.
    const shared = allWalls(second).filter((wall) => {
      const a = nodePoint(second, wall.a);
      const b = nodePoint(second, wall.b);
      return a.x === 3050 && b.x === 3050;
    });
    expect(shared).toHaveLength(1);

    // And both rooms still measure what was typed.
    const areas = extractFaces(second)
      .map((face) => roomGeometry(second, face).area)
      .sort((left, right) => right - left);
    expect(areas).toEqual([3000 * 3000, 2000 * 3000]);
  });
});

describe('drawWallRun', () => {
  it('draws a chain of walls', () => {
    const { graph } = drawWallRun(EMPTY_GRAPH, [vec2(0, 0), vec2(3000, 0), vec2(3000, 2000)]);

    expect(allWalls(graph)).toHaveLength(2);
  });

  it('closes a room when the run returns to its start', () => {
    const { graph } = drawWallRun(EMPTY_GRAPH, [
      vec2(0, 0),
      vec2(4000, 0),
      vec2(4000, 3000),
      vec2(0, 3000),
      vec2(0, 0),
    ]);

    expect(areas(graph)).toEqual([12]);
  });

  it('does nothing for a run of fewer than two points', () => {
    expect(drawWallRun(EMPTY_GRAPH, [vec2(0, 0)]).graph).toBe(EMPTY_GRAPH);
    expect(drawWallRun(EMPTY_GRAPH, []).graph).toBe(EMPTY_GRAPH);
  });
});

describe('setWallLength', () => {
  it('stretches a free-standing wall from its start', () => {
    const graph = graphFromSegments([{ from: [0, 0], to: [1000, 0] }]);
    const stretched = setWallLength(graph, 'w1', 2500);

    expect(wallLength(stretched, getWall(stretched, 'w1'))).toBe(2500);
    // The start stayed put.
    expect(nodePoint(stretched, getWall(stretched, 'w1').a)).toEqual({ x: 0, y: 0 });
  });

  it('shortens as readily as it stretches', () => {
    const graph = graphFromSegments([{ from: [0, 0], to: [4000, 0] }]);
    expect(wallLength(setWallLength(graph, 'w1', 1200), getWall(graph, 'w1'))).toBe(1200);
  });

  it('keeps the direction it was drawn in', () => {
    const graph = graphFromSegments([{ from: [1000, 500], to: [1000, 3500] }]);
    const stretched = setWallLength(graph, 'w1', 1000);
    const wall = getWall(stretched, 'w1');

    expect(nodePoint(stretched, wall.a)).toEqual({ x: 1000, y: 500 });
    expect(nodePoint(stretched, wall.b)).toEqual({ x: 1000, y: 1500 });
  });

  it('moves the free end rather than tearing a corner open', () => {
    // An L: (0,0)-(3000,0) then (3000,0)-(3000,2000). For the second wall,
    // node `a` is the shared corner, so `b` is the one that should move.
    const graph = graphFromSegments([
      { from: [0, 0], to: [3000, 0] },
      { from: [3000, 0], to: [3000, 2000] },
    ]);

    const target = allWalls(graph).find((wall) => {
      const a = nodePoint(graph, wall.a);
      const b = nodePoint(graph, wall.b);
      return a.x === 3000 && b.x === 3000;
    })!;

    const stretched = setWallLength(graph, target.id, 5000);

    // The corner is untouched, so the first wall is unaffected.
    expect(allWalls(stretched).some((wall) => wallLength(stretched, wall) === 3000)).toBe(true);
    expect(wallLength(stretched, getWall(stretched, target.id))).toBe(5000);
  });

  it('refuses a zero or negative length', () => {
    const graph = graphFromSegments([{ from: [0, 0], to: [1000, 0] }]);
    expect(setWallLength(graph, 'w1', 0)).toBe(graph);
    expect(setWallLength(graph, 'w1', -500)).toBe(graph);
  });

  it('is a no-op when the length is already right', () => {
    const graph = graphFromSegments([{ from: [0, 0], to: [1000, 0] }]);
    expect(setWallLength(graph, 'w1', 1000)).toBe(graph);
  });

  it('resizes a room by its wall, keeping it closed', () => {
    const graph = graphFromSegments(rectangleSegments(0, 0, 4000, 3000));
    const top = allWalls(graph).find((wall) => {
      const a = nodePoint(graph, wall.a);
      const b = nodePoint(graph, wall.b);
      return a.y === 0 && b.y === 0;
    })!;

    // Both ends are corners, so `b` moves and the room is dragged out of square
    // — the room stays closed but is no longer a rectangle.
    const widened = setWallLength(graph, top.id, 6000);
    expect(wallLength(widened, getWall(widened, top.id))).toBe(6000);
    expect(extractFaces(widened)).toHaveLength(1);
  });
});

describe('moveWallSideways', () => {
  it('slides a wall and stretches what is attached to it', () => {
    // A 4m x 3m room; slide the left-hand wall 500mm further left.
    const graph = graphFromSegments(rectangleSegments(0, 0, 4000, 3000));
    expect(areas(graph)).toEqual([12]);

    const left = allWalls(graph).find((wall) => {
      const a = nodePoint(graph, wall.a);
      const b = nodePoint(graph, wall.b);
      return a.x === 0 && b.x === 0;
    })!;

    // Positive offset moves a wall to the right-hand side of the a-to-b
    // direction. Which way that points depends on how this particular wall was
    // wound, so derive it rather than guessing: take the right-hand normal and
    // see whether it aims at the middle of the room.
    const a = nodePoint(graph, left.a);
    const b = nodePoint(graph, left.b);
    const rightward = perpendicular(normalize(sub(b, a)));
    const towardsCentre = rightward.x * (2000 - a.x) + rightward.y * (1500 - a.y) > 0;
    const outward = towardsCentre ? -500 : 500;

    const moved = moveWallSideways(graph, left.id, outward);

    // The room got wider, and is still one closed room.
    expect(areas(moved)).toEqual([(4500 * 3000) / 1_000_000]);
    expect(extractFaces(moved)).toHaveLength(1);

    // And the opposite sign narrows it, which is the other half of the claim.
    expect(areas(moveWallSideways(graph, left.id, -outward))).toEqual([(3500 * 3000) / 1_000_000]);
  });

  it('is a no-op for a zero offset', () => {
    const graph = graphFromSegments(rectangleSegments(0, 0, 4000, 3000));
    expect(moveWallSideways(graph, allWalls(graph)[0]!.id, 0)).toBe(graph);
  });

  it('moves a lone wall without changing its length', () => {
    const graph = graphFromSegments([{ from: [0, 0], to: [1000, 0] }]);
    const moved = moveWallSideways(graph, 'w1', 300);

    expect(wallLength(moved, getWall(moved, 'w1'))).toBe(1000);
    expect(nodePoint(moved, getWall(moved, 'w1').a)).toEqual({ x: 0, y: 300 });
  });
});

describe('createLShapedRoom', () => {
  /** The usable floor of the one room the graph describes. */
  function floorOf(graph: WallGraph) {
    const faces = extractFaces(graph);
    const inner = faces.filter((face) => face.area > 0);
    expect(inner).toHaveLength(1);
    return roomGeometry(graph, inner[0]!);
  }

  const base = {
    width: 5000,
    depth: 4000,
    notchWidth: 2000,
    notchDepth: 1500,
    thickness: 100,
  } as const;

  it.each(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const)(
    'gives exactly the typed floor area with the notch at %s',
    (notchCorner) => {
      // The whole point of typing measurements: 5m x 4m less a 2m x 1.5m
      // corner is 17 m², and it has to be 17 m² however the corner is turned.
      const { graph } = createLShapedRoom(EMPTY_GRAPH, { ...base, notchCorner });

      expect(floorOf(graph).area).toBe(5000 * 4000 - 2000 * 1500);
    },
  );

  it('is exact at an odd wall thickness, where half a wall is not a whole number', () => {
    // 135mm is an ordinary brick-and-plaster wall. Rounding each corner on its
    // own would put the room 1mm out; the spans have to survive it.
    const { graph } = createLShapedRoom(EMPTY_GRAPH, {
      ...base,
      thickness: 135,
      notchCorner: 'top-right',
    });

    expect(floorOf(graph).area).toBe(5000 * 4000 - 2000 * 1500);
  });

  it('puts the missing corner where it was asked for', () => {
    const { graph } = createLShapedRoom(EMPTY_GRAPH, { ...base, notchCorner: 'top-right' });
    const { outline } = floorOf(graph);

    const xs = outline.map((point) => point.x);
    const ys = outline.map((point) => point.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);

    // The overall footprint is still the full rectangle...
    expect(Math.max(...xs) - minX).toBeCloseTo(5000, 6);
    expect(Math.max(...ys) - minY).toBeCloseTo(4000, 6);

    // ...and the top-right corner is the one that is not part of the floor.
    expect(containsPoint(outline, { x: minX + 4500, y: minY + 500 })).toBe(false);
    expect(containsPoint(outline, { x: minX + 500, y: minY + 500 })).toBe(true);
    expect(containsPoint(outline, { x: minX + 4500, y: minY + 3500 })).toBe(true);
  });

  it('draws six walls, not four', () => {
    const { graph } = createLShapedRoom(EMPTY_GRAPH, { ...base, notchCorner: 'bottom-left' });

    expect(allWalls(graph)).toHaveLength(6);
  });

  it('refuses a notch that would leave no room behind it', () => {
    for (const bad of [
      { ...base, notchWidth: 5000 },
      { ...base, notchDepth: 4000 },
      { ...base, notchWidth: 4900 },
      { ...base, notchWidth: 0 },
      { ...base, notchDepth: -100 },
    ]) {
      const { graph } = createLShapedRoom(EMPTY_GRAPH, { ...bad, notchCorner: 'top-right' });
      expect(allWalls(graph)).toHaveLength(0);
    }
  });

  it('agrees with the rectangle when the notch is the smallest allowed', () => {
    // A sanity check that the two paths describe the same world: an L whose
    // notch is a sliver still measures its full width and depth overall.
    const { graph } = createLShapedRoom(EMPTY_GRAPH, {
      width: 3000,
      depth: 3000,
      notchWidth: 200,
      notchDepth: 200,
      thickness: 100,
      notchCorner: 'bottom-right',
    });

    expect(floorOf(graph).area).toBe(3000 * 3000 - 200 * 200);
  });
});
