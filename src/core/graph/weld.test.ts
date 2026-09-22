/**
 * Joining what has been pushed together.
 *
 * Two rooms slid against each other have to end up genuinely sharing one wall,
 * not standing next to each other with two walls on the same line. The
 * difference is invisible on screen and total in the model: shared walls are
 * what make a room's floor area right, what make a door serve both sides, and
 * what make the whole thing a house rather than a collection of boxes.
 */

import { describe, expect, it } from 'vitest';

import {
  allNodes,
  allWalls,
  EMPTY_GRAPH,
  graphFromSegments,
  rectangleSegments,
  wallLength,
  type WallGraph,
} from './wallGraph.ts';
import { extractFaces } from './faces.ts';
import { needsWelding, weld } from './weld.ts';

/**
 * Two 4m × 3m rooms whose facing walls land on the same line.
 *
 * Built as two separate rectangles rather than one drawn graph, which is
 * exactly what translating a room produces — and exactly what `insertWall`
 * would never produce on its own.
 */
function pushedTogether(): WallGraph {
  return {
    nodes: {
      // Left room.
      n1: { id: 'n1', x: 0, y: 0 },
      n2: { id: 'n2', x: 4000, y: 0 },
      n3: { id: 'n3', x: 4000, y: 3000 },
      n4: { id: 'n4', x: 0, y: 3000 },
      // Right room, sharing the line x = 4000.
      n5: { id: 'n5', x: 4000, y: 0 },
      n6: { id: 'n6', x: 8000, y: 0 },
      n7: { id: 'n7', x: 8000, y: 3000 },
      n8: { id: 'n8', x: 4000, y: 3000 },
    },
    walls: {
      w1: { id: 'w1', a: 'n1', b: 'n2', thickness: 100, kind: 'exterior' },
      w2: { id: 'w2', a: 'n2', b: 'n3', thickness: 100, kind: 'exterior' },
      w3: { id: 'w3', a: 'n3', b: 'n4', thickness: 100, kind: 'exterior' },
      w4: { id: 'w4', a: 'n4', b: 'n1', thickness: 100, kind: 'exterior' },
      w5: { id: 'w5', a: 'n5', b: 'n6', thickness: 100, kind: 'exterior' },
      w6: { id: 'w6', a: 'n6', b: 'n7', thickness: 100, kind: 'exterior' },
      w7: { id: 'w7', a: 'n7', b: 'n8', thickness: 100, kind: 'exterior' },
      w8: { id: 'w8', a: 'n8', b: 'n5', thickness: 100, kind: 'exterior' },
    },
  };
}

describe('two rooms pushed together', () => {
  it('starts out as two structures that merely touch', () => {
    const before = pushedTogether();
    expect(allWalls(before)).toHaveLength(8);
    expect(allNodes(before)).toHaveLength(8);
  });

  it('ends up sharing one wall', () => {
    const { graph } = weld(pushedTogether());

    // Eight walls become seven: the two on the line x = 4000 are now one.
    expect(allWalls(graph)).toHaveLength(7);
    expect(allNodes(graph)).toHaveLength(6);
  });

  it('still describes two rooms afterwards', () => {
    const faces = extractFaces(weld(pushedTogether()).graph);
    expect(faces).toHaveLength(2);
  });

  it('says which wall went where', () => {
    const { merges } = weld(pushedTogether());
    expect(merges).toHaveLength(1);
    expect(merges[0]).toMatchObject({ fromWallId: 'w8', toWallId: 'w2', length: 3000 });
  });

  it('notices that the two walls run in opposite directions', () => {
    // w2 runs down the line and w8 runs up it. Anything hosted on w8 has to be
    // turned round when it moves across, which is what this flag is for.
    expect(weld(pushedTogether()).merges[0]!.reversed).toBe(true);
  });

  it('does not touch a graph that was already sound', () => {
    const tidy = graphFromSegments(rectangleSegments(0, 0, 4000, 3000));
    expect(weld(tidy).graph).toBe(tidy);
    expect(needsWelding(tidy)).toBe(false);
  });

  it('knows when there is work to do', () => {
    expect(needsWelding(pushedTogether())).toBe(true);
  });

  it('is idempotent — welding a welded graph changes nothing', () => {
    const once = weld(pushedTogether()).graph;
    expect(weld(once).graph).toBe(once);
  });
});

describe('rooms of different depths', () => {
  /** A 3m-deep room against the middle of a 6m-deep one. */
  function unevenPair(): WallGraph {
    return {
      nodes: {
        n1: { id: 'n1', x: 0, y: 0 },
        n2: { id: 'n2', x: 4000, y: 0 },
        n3: { id: 'n3', x: 4000, y: 6000 },
        n4: { id: 'n4', x: 0, y: 6000 },
        n5: { id: 'n5', x: 4000, y: 1000 },
        n6: { id: 'n6', x: 7000, y: 1000 },
        n7: { id: 'n7', x: 7000, y: 4000 },
        n8: { id: 'n8', x: 4000, y: 4000 },
      },
      walls: {
        w1: { id: 'w1', a: 'n1', b: 'n2', thickness: 100, kind: 'exterior' },
        w2: { id: 'w2', a: 'n2', b: 'n3', thickness: 100, kind: 'exterior' },
        w3: { id: 'w3', a: 'n3', b: 'n4', thickness: 100, kind: 'exterior' },
        w4: { id: 'w4', a: 'n4', b: 'n1', thickness: 100, kind: 'exterior' },
        w5: { id: 'w5', a: 'n5', b: 'n6', thickness: 100, kind: 'exterior' },
        w6: { id: 'w6', a: 'n6', b: 'n7', thickness: 100, kind: 'exterior' },
        w7: { id: 'w7', a: 'n7', b: 'n8', thickness: 100, kind: 'exterior' },
        w8: { id: 'w8', a: 'n8', b: 'n5', thickness: 100, kind: 'exterior' },
      },
    };
  }

  it('cuts the longer wall where the shorter one starts and stops', () => {
    // The 6m wall becomes three: 0–1000, 1000–4000 and 4000–6000. The middle
    // stretch is the one now shared.
    const { graph } = weld(unevenPair());

    const onTheLine = allWalls(graph).filter(
      (wall) => graph.nodes[wall.a]!.x === 4000 && graph.nodes[wall.b]!.x === 4000,
    );

    expect(onTheLine.map((wall) => wallLength(graph, wall)).sort((a, b) => a - b)).toEqual([
      1000, 2000, 3000,
    ]);
  });

  it('reports the cuts, so a door on the wall that was cut can find its half', () => {
    expect(weld(unevenPair()).splits.length).toBeGreaterThan(0);
  });

  it('leaves two rooms, sharing only the stretch that overlapped', () => {
    expect(extractFaces(weld(unevenPair()).graph)).toHaveLength(2);
  });
});

describe('walls of different thickness', () => {
  function mismatched(): WallGraph {
    const graph = pushedTogether();
    return {
      nodes: graph.nodes,
      walls: {
        ...graph.walls,
        w2: { ...graph.walls['w2']!, thickness: 100, kind: 'interior' },
        w8: { ...graph.walls['w8']!, thickness: 250, kind: 'exterior' },
      },
    };
  }

  it('keeps the thicker of the two', () => {
    // Two rooms cannot share a wall and each keep their own thickness, so one
    // has to give. Taking the greater never makes a wall weaker than it was
    // drawn — and the rooms' floor areas update to say what it cost them.
    const { graph } = weld(mismatched());
    const shared = allWalls(graph).find(
      (wall) => graph.nodes[wall.a]!.x === 4000 && graph.nodes[wall.b]!.x === 4000,
    )!;

    expect(shared.thickness).toBe(250);
  });

  it('keeps the more structural kind', () => {
    const { graph } = weld(mismatched());
    const shared = allWalls(graph).find(
      (wall) => graph.nodes[wall.a]!.x === 4000 && graph.nodes[wall.b]!.x === 4000,
    )!;

    expect(shared.kind).toBe('exterior');
  });
});

describe('corners that land in the middle of a wall', () => {
  it('cut it, so the junction is real rather than merely near', () => {
    // A room pushed against the middle of a longer wall. Without the cut the
    // two are not connected at all and face extraction finds one room with a
    // spike in it rather than two rooms.
    const graph: WallGraph = {
      nodes: {
        n1: { id: 'n1', x: 0, y: 0 },
        n2: { id: 'n2', x: 0, y: 6000 },
        n3: { id: 'n3', x: 0, y: 2000 },
        n4: { id: 'n4', x: 3000, y: 2000 },
      },
      walls: {
        w1: { id: 'w1', a: 'n1', b: 'n2', thickness: 100, kind: 'exterior' },
        w2: { id: 'w2', a: 'n3', b: 'n4', thickness: 100, kind: 'interior' },
      },
    };

    const { graph: welded, splits } = weld(graph);

    expect(allWalls(welded)).toHaveLength(3);
    expect(splits).toHaveLength(1);
    // n3 was a corner of its own; now it is the junction.
    expect(allNodes(welded)).toHaveLength(4);
  });
});

describe('the awkward inputs', () => {
  it('has nothing to do with an empty graph', () => {
    expect(weld(EMPTY_GRAPH).graph).toBe(EMPTY_GRAPH);
  });

  it('drops a wall whose two ends turn out to be the same corner', () => {
    const graph: WallGraph = {
      nodes: {
        n1: { id: 'n1', x: 1000, y: 1000 },
        n2: { id: 'n2', x: 1000, y: 1000 },
      },
      walls: { w1: { id: 'w1', a: 'n1', b: 'n2', thickness: 100, kind: 'interior' } },
    };

    const { graph: welded } = weld(graph);
    expect(allWalls(welded)).toHaveLength(0);
  });

  it('collapses three corners in the same place into one', () => {
    const graph: WallGraph = {
      nodes: {
        n1: { id: 'n1', x: 0, y: 0 },
        n2: { id: 'n2', x: 0, y: 0 },
        n3: { id: 'n3', x: 0, y: 0 },
        n4: { id: 'n4', x: 2000, y: 0 },
        n5: { id: 'n5', x: 0, y: 2000 },
      },
      walls: {
        w1: { id: 'w1', a: 'n1', b: 'n4', thickness: 100, kind: 'interior' },
        w2: { id: 'w2', a: 'n2', b: 'n5', thickness: 100, kind: 'interior' },
      },
    };

    const { graph: welded } = weld(graph);
    // n2 and n3 fold into n1; the two walls now meet at a corner.
    expect(
      allNodes(welded)
        .map((node) => node.id)
        .sort(),
    ).toEqual(['n1', 'n4', 'n5']);
    expect(allWalls(welded)).toHaveLength(2);
  });

  it('leaves corners a millimetre or two apart alone if they are further than the tolerance', () => {
    const graph: WallGraph = {
      nodes: {
        n1: { id: 'n1', x: 0, y: 0 },
        n2: { id: 'n2', x: 2000, y: 0 },
        n3: { id: 'n3', x: 0, y: 5 },
        n4: { id: 'n4', x: 2000, y: 5 },
      },
      walls: {
        w1: { id: 'w1', a: 'n1', b: 'n2', thickness: 100, kind: 'interior' },
        w2: { id: 'w2', a: 'n3', b: 'n4', thickness: 100, kind: 'interior' },
      },
    };

    // 5mm apart is a plan somebody drew, not a join. Welding it would be the
    // editor quietly deciding it knew better.
    expect(weld(graph).graph).toBe(graph);
  });
});
