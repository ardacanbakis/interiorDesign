import { describe, expect, it } from 'vitest';

import { vec2 } from '../geometry/vec2.ts';
import {
  allNodes,
  allWalls,
  createIdAllocator,
  DEFAULT_WALL_THICKNESS,
  EMPTY_GRAPH,
  findNodeAt,
  findWallAt,
  findWallBetween,
  getNode,
  graphFromSegments,
  incidentWalls,
  insertWall,
  moveNode,
  nodeDegree,
  pruneOrphanNodes,
  rectangleSegments,
  removeNode,
  removeWall,
  splitWall,
  updateWall,
  wallLength,
  type WallGraph,
} from './wallGraph.ts';

/**
 * Assert the invariant the whole module exists to maintain: no two walls may
 * cross or overlap except at a shared node.
 *
 * Every mutation test runs this, because a graph that looks right by wall count
 * but is secretly non-planar produces wrong rooms later, a long way from the
 * code that broke it.
 */
function expectPlanar(graph: WallGraph): void {
  const walls = allWalls(graph);

  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const first = walls[i]!;
      const second = walls[j]!;

      const sharesNode =
        first.a === second.a ||
        first.a === second.b ||
        first.b === second.a ||
        first.b === second.b;

      const a = { a: pointOf(graph, first.a), b: pointOf(graph, first.b) };
      const b = { a: pointOf(graph, second.a), b: pointOf(graph, second.b) };

      const hit = intersect(a, b);

      if (hit === 'overlap') {
        throw new Error(`Walls ${first.id} and ${second.id} overlap along a shared line`);
      }

      if (hit === 'crossing' && !sharesNode) {
        throw new Error(`Walls ${first.id} and ${second.id} cross without a shared node`);
      }
    }
  }

  // Every wall must reference nodes that exist.
  for (const wall of walls) {
    expect(graph.nodes[wall.a], `wall ${wall.id} node a`).toBeDefined();
    expect(graph.nodes[wall.b], `wall ${wall.id} node b`).toBeDefined();
  }
}

function pointOf(graph: WallGraph, id: string) {
  const node = getNode(graph, id);
  return { x: node.x, y: node.y };
}

/** Minimal independent intersection check, so the test does not lean on the code it is testing. */
function intersect(
  first: { a: { x: number; y: number }; b: { x: number; y: number } },
  second: { a: { x: number; y: number }; b: { x: number; y: number } },
): 'none' | 'crossing' | 'overlap' {
  const r = { x: first.b.x - first.a.x, y: first.b.y - first.a.y };
  const s = { x: second.b.x - second.a.x, y: second.b.y - second.a.y };
  const denominator = r.x * s.y - r.y * s.x;
  const qp = { x: second.a.x - first.a.x, y: second.a.y - first.a.y };

  if (denominator === 0) {
    if (qp.x * r.y - qp.y * r.x !== 0) return 'none';
    // Collinear — do the extents share more than a point?
    const lenSq = r.x * r.x + r.y * r.y;
    const t0 = (qp.x * r.x + qp.y * r.y) / lenSq;
    const t1 = t0 + (s.x * r.x + s.y * r.y) / lenSq;
    const low = Math.max(0, Math.min(t0, t1));
    const high = Math.min(1, Math.max(t0, t1));
    return high - low > 1e-9 ? 'overlap' : 'none';
  }

  const t = (qp.x * s.y - qp.y * s.x) / denominator;
  const u = (qp.x * r.y - qp.y * r.x) / denominator;
  const inside = t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
  return inside ? 'crossing' : 'none';
}

// ---------------------------------------------------------------------------

describe('createIdAllocator', () => {
  it('continues from the highest existing id', () => {
    const graph = graphFromSegments([{ from: [0, 0], to: [1000, 0] }]);
    const allocator = createIdAllocator(graph);

    // The first insert used n1, n2, w1.
    expect(allocator.node()).toBe('n3');
    expect(allocator.wall()).toBe('w2');
  });

  it('starts from one on an empty graph', () => {
    const allocator = createIdAllocator(EMPTY_GRAPH);
    expect(allocator.node()).toBe('n1');
    expect(allocator.wall()).toBe('w1');
  });

  it('ignores ids that do not follow the scheme', () => {
    const graph: WallGraph = {
      nodes: { custom: { id: 'custom', x: 0, y: 0 } },
      walls: {},
    };
    expect(createIdAllocator(graph).node()).toBe('n1');
  });
});

describe('insertWall — the simple cases', () => {
  it('adds a single wall between two fresh nodes', () => {
    const { graph, wallIds, splits } = insertWall(EMPTY_GRAPH, vec2(0, 0), vec2(4000, 0));

    expect(allNodes(graph)).toHaveLength(2);
    expect(allWalls(graph)).toHaveLength(1);
    expect(wallIds).toHaveLength(1);
    expect(splits).toHaveLength(0);
    expectPlanar(graph);
  });

  it('ignores a zero-length run', () => {
    const { graph, wallIds } = insertWall(EMPTY_GRAPH, vec2(100, 100), vec2(100, 100));
    expect(allWalls(graph)).toHaveLength(0);
    expect(wallIds).toHaveLength(0);
  });

  it('rounds coordinates to whole millimetres', () => {
    const { graph } = insertWall(EMPTY_GRAPH, vec2(0.4, -0.4), vec2(999.6, 0.2));
    const points = allNodes(graph).map((n) => ({ x: n.x, y: n.y }));
    expect(points).toContainEqual({ x: 0, y: 0 });
    expect(points).toContainEqual({ x: 1000, y: 0 });
  });

  it('uses the default thickness for the wall kind', () => {
    const { graph } = insertWall(EMPTY_GRAPH, vec2(0, 0), vec2(1000, 0), { kind: 'exterior' });
    expect(allWalls(graph)[0]!.thickness).toBe(DEFAULT_WALL_THICKNESS.exterior);
  });

  it('accepts an explicit thickness', () => {
    const { graph } = insertWall(EMPTY_GRAPH, vec2(0, 0), vec2(1000, 0), { thickness: 135 });
    expect(allWalls(graph)[0]!.thickness).toBe(135);
  });

  it('reuses an existing node at a shared corner', () => {
    let graph = insertWall(EMPTY_GRAPH, vec2(0, 0), vec2(1000, 0)).graph;
    graph = insertWall(graph, vec2(1000, 0), vec2(1000, 800)).graph;

    expect(allNodes(graph)).toHaveLength(3);
    expect(allWalls(graph)).toHaveLength(2);
    expectPlanar(graph);
  });
});

describe('insertWall — keeping the graph planar', () => {
  it('splits both walls at a proper crossing', () => {
    const horizontal = insertWall(EMPTY_GRAPH, vec2(0, 0), vec2(1000, 0)).graph;
    const { graph, splits } = insertWall(horizontal, vec2(500, -500), vec2(500, 500));

    // The horizontal wall is cut in two, and the vertical run arrives as two
    // walls meeting at the crossing: four in total.
    expect(allWalls(graph)).toHaveLength(4);
    expect(allNodes(graph)).toHaveLength(5);
    expect(splits).toHaveLength(1);
    expect(splits[0]!.originalWallId).toBe('w1');
    expect(splits[0]!.t).toBeCloseTo(0.5);
    expectPlanar(graph);
  });

  it('splits the crossed wall at a T-junction', () => {
    const horizontal = insertWall(EMPTY_GRAPH, vec2(0, 0), vec2(1000, 0)).graph;
    const { graph, splits } = insertWall(horizontal, vec2(500, 0), vec2(500, 500));

    expect(allWalls(graph)).toHaveLength(3);
    expect(allNodes(graph)).toHaveLength(4);
    expect(splits).toHaveLength(1);
    expectPlanar(graph);
  });

  it('subdivides a room — the operation this module exists for', () => {
    // A 4m x 3m room, then a wall straight down the middle.
    const room = graphFromSegments(rectangleSegments(0, 0, 4000, 3000));
    expect(allWalls(room)).toHaveLength(4);

    const { graph } = insertWall(room, vec2(2000, 0), vec2(2000, 3000), { kind: 'interior' });

    // Top and bottom walls each split in two, plus the new divider: 4 - 2 + 4 + 1 = 7.
    expect(allWalls(graph)).toHaveLength(7);
    expect(allNodes(graph)).toHaveLength(6);
    expectPlanar(graph);
  });

  it('splits a wall crossed by a run that also crosses another', () => {
    // A plus sign drawn across two parallel walls.
    let graph = graphFromSegments([
      { from: [0, 0], to: [1000, 0] },
      { from: [0, 1000], to: [1000, 1000] },
    ]);

    const result = insertWall(graph, vec2(500, -200), vec2(500, 1200));
    graph = result.graph;

    expect(result.splits).toHaveLength(2);
    // Two originals become four, plus the run split into three parts.
    expect(allWalls(graph)).toHaveLength(7);
    expectPlanar(graph);
  });

  it('does not duplicate a wall drawn exactly over an existing one', () => {
    const once = insertWall(EMPTY_GRAPH, vec2(0, 0), vec2(1000, 0)).graph;
    const { graph, wallIds } = insertWall(once, vec2(0, 0), vec2(1000, 0));

    expect(allWalls(graph)).toHaveLength(1);
    // The run reports the wall that was already there.
    expect(wallIds).toEqual(['w1']);
    expectPlanar(graph);
  });

  it('handles a wall drawn over an existing one in the opposite direction', () => {
    const once = insertWall(EMPTY_GRAPH, vec2(0, 0), vec2(1000, 0)).graph;
    const { graph } = insertWall(once, vec2(1000, 0), vec2(0, 0));

    expect(allWalls(graph)).toHaveLength(1);
    expectPlanar(graph);
  });

  it('splits an existing wall when a new one partially overlaps it', () => {
    const once = insertWall(EMPTY_GRAPH, vec2(0, 0), vec2(1000, 0)).graph;
    const { graph } = insertWall(once, vec2(500, 0), vec2(1500, 0));

    // 0-500 and 500-1000 from the original, plus 1000-1500 from the new run.
    expect(allWalls(graph)).toHaveLength(3);
    expect(allNodes(graph)).toHaveLength(4);
    expectPlanar(graph);
  });

  it('splits an existing wall when a new one sits entirely inside it', () => {
    const once = insertWall(EMPTY_GRAPH, vec2(0, 0), vec2(1000, 0)).graph;
    const { graph } = insertWall(once, vec2(200, 0), vec2(800, 0));

    expect(allWalls(graph)).toHaveLength(3);
    expect(allNodes(graph)).toHaveLength(4);
    expectPlanar(graph);
  });

  it('extends a wall drawn on from its endpoint', () => {
    const once = insertWall(EMPTY_GRAPH, vec2(0, 0), vec2(1000, 0)).graph;
    const { graph } = insertWall(once, vec2(1000, 0), vec2(2000, 0));

    expect(allWalls(graph)).toHaveLength(2);
    expect(allNodes(graph)).toHaveLength(3);
    expectPlanar(graph);
  });

  it('keeps a closed rectangle planar with exactly four walls', () => {
    const graph = graphFromSegments(rectangleSegments(0, 0, 4000, 3000));

    expect(allWalls(graph)).toHaveLength(4);
    expect(allNodes(graph)).toHaveLength(4);
    for (const node of allNodes(graph)) {
      expect(nodeDegree(graph, node.id)).toBe(2);
    }
    expectPlanar(graph);
  });

  it('builds a two-room plan with one shared wall', () => {
    // Two 3x3 rooms side by side, sharing the wall at x=3000.
    const graph = graphFromSegments([
      ...rectangleSegments(0, 0, 3000, 3000),
      ...rectangleSegments(3000, 0, 3000, 3000),
    ]);

    expectPlanar(graph);

    // The shared wall exists exactly once, not twice.
    const sharedWalls = allWalls(graph).filter((wall) => {
      const a = pointOf(graph, wall.a);
      const b = pointOf(graph, wall.b);
      return a.x === 3000 && b.x === 3000;
    });
    expect(sharedWalls).toHaveLength(1);
  });
});

describe('splitWall', () => {
  it('replaces one wall with two and reports what happened', () => {
    const before = insertWall(EMPTY_GRAPH, vec2(0, 0), vec2(1000, 0)).graph;
    const { graph, split } = splitWall(before, 'w1', vec2(400, 0));

    expect(graph.walls['w1']).toBeUndefined();
    expect(allWalls(graph)).toHaveLength(2);
    expect(split.originalWallId).toBe('w1');
    expect(split.t).toBeCloseTo(0.4);
    expect(split.parts).toHaveLength(2);

    // The parts are reported in the original's a-to-b order, which is what
    // lets an opening's offset be remapped without guessing.
    const first = graph.walls[split.parts[0]]!;
    const second = graph.walls[split.parts[1]]!;
    expect(first.a).toBe(before.walls['w1']!.a);
    expect(second.b).toBe(before.walls['w1']!.b);
    expect(first.b).toBe(split.nodeId);
    expect(second.a).toBe(split.nodeId);

    expectPlanar(graph);
  });

  it('carries the original thickness and kind onto both parts', () => {
    const before = insertWall(EMPTY_GRAPH, vec2(0, 0), vec2(1000, 0), {
      kind: 'exterior',
      thickness: 300,
    }).graph;
    const { graph, split } = splitWall(before, 'w1', vec2(400, 0));

    for (const id of split.parts) {
      expect(graph.walls[id]!.thickness).toBe(300);
      expect(graph.walls[id]!.kind).toBe('exterior');
    }
  });
});

describe('removeWall / removeNode / pruneOrphanNodes', () => {
  it('removes a wall and the nodes it orphans', () => {
    const before = insertWall(EMPTY_GRAPH, vec2(0, 0), vec2(1000, 0)).graph;
    const graph = removeWall(before, 'w1');

    expect(allWalls(graph)).toHaveLength(0);
    expect(allNodes(graph)).toHaveLength(0);
  });

  it('keeps nodes that other walls still use', () => {
    const graph = removeWall(graphFromSegments(rectangleSegments(0, 0, 1000, 1000)), 'w1');

    expect(allWalls(graph)).toHaveLength(3);
    expect(allNodes(graph)).toHaveLength(4);
  });

  it('is a no-op for an unknown wall', () => {
    const before = graphFromSegments(rectangleSegments(0, 0, 1000, 1000));
    expect(removeWall(before, 'nope')).toBe(before);
  });

  it('removes a node together with every wall touching it', () => {
    const before = graphFromSegments(rectangleSegments(0, 0, 1000, 1000));
    const corner = allNodes(before)[0]!;
    const graph = removeNode(before, corner.id);

    expect(allWalls(graph)).toHaveLength(2);
    expect(graph.nodes[corner.id]).toBeUndefined();
    expectPlanar(graph);
  });

  it('prunes nodes with nothing attached', () => {
    const withOrphan: WallGraph = {
      nodes: { n1: { id: 'n1', x: 0, y: 0 } },
      walls: {},
    };
    expect(allNodes(pruneOrphanNodes(withOrphan))).toHaveLength(0);
  });

  it('leaves a graph with no orphans untouched', () => {
    const graph = graphFromSegments(rectangleSegments(0, 0, 1000, 1000));
    expect(pruneOrphanNodes(graph)).toBe(graph);
  });
});

describe('moveNode', () => {
  it('moves a node, taking its walls with it', () => {
    const before = insertWall(EMPTY_GRAPH, vec2(0, 0), vec2(1000, 0)).graph;
    const graph = moveNode(before, 'n2', vec2(1500, 0));

    expect(getNode(graph, 'n2')).toMatchObject({ x: 1500, y: 0 });
    expect(wallLength(graph, graph.walls['w1']!)).toBe(1500);
  });

  it('returns the same graph when nothing moves', () => {
    const before = insertWall(EMPTY_GRAPH, vec2(0, 0), vec2(1000, 0)).graph;
    expect(moveNode(before, 'n2', vec2(1000, 0))).toBe(before);
  });

  it('rounds the destination', () => {
    const before = insertWall(EMPTY_GRAPH, vec2(0, 0), vec2(1000, 0)).graph;
    expect(getNode(moveNode(before, 'n2', vec2(1500.6, 0.2)), 'n2')).toMatchObject({
      x: 1501,
      y: 0,
    });
  });
});

describe('updateWall', () => {
  it('changes thickness and kind independently', () => {
    const before = insertWall(EMPTY_GRAPH, vec2(0, 0), vec2(1000, 0)).graph;

    expect(updateWall(before, 'w1', { thickness: 300 }).walls['w1']).toMatchObject({
      thickness: 300,
      kind: 'interior',
    });
    expect(updateWall(before, 'w1', { kind: 'exterior' }).walls['w1']).toMatchObject({
      thickness: DEFAULT_WALL_THICKNESS.interior,
      kind: 'exterior',
    });
  });

  it('does not mutate the original graph', () => {
    const before = insertWall(EMPTY_GRAPH, vec2(0, 0), vec2(1000, 0)).graph;
    updateWall(before, 'w1', { thickness: 999 });
    expect(before.walls['w1']!.thickness).toBe(DEFAULT_WALL_THICKNESS.interior);
  });
});

describe('queries', () => {
  const graph = graphFromSegments(rectangleSegments(0, 0, 4000, 3000));

  it('finds a node by proximity', () => {
    expect(findNodeAt(graph, vec2(0, 0))).not.toBeNull();
    expect(findNodeAt(graph, vec2(50, 0))).toBeNull();
    expect(findNodeAt(graph, vec2(50, 0), 100)).not.toBeNull();
  });

  it('finds the nearest node when several are in range', () => {
    const found = findNodeAt(graph, vec2(300, 10), 5000);
    expect(found).not.toBeNull();
    expect({ x: found!.x, y: found!.y }).toEqual({ x: 0, y: 0 });
  });

  it('finds a wall by proximity to its body', () => {
    expect(findWallAt(graph, vec2(2000, 0))).not.toBeNull();
    expect(findWallAt(graph, vec2(2000, 1500))).toBeNull();
    expect(findWallAt(graph, vec2(2000, 20), 50)).not.toBeNull();
  });

  it('finds the wall joining two nodes, in either direction', () => {
    const wall = allWalls(graph)[0]!;
    expect(findWallBetween(graph, wall.a, wall.b)?.id).toBe(wall.id);
    expect(findWallBetween(graph, wall.b, wall.a)?.id).toBe(wall.id);
  });

  it('returns null when two nodes are not joined', () => {
    const [first, , third] = allNodes(graph);
    expect(findWallBetween(graph, first!.id, third!.id)).toBeNull();
  });

  it('lists the walls at a node', () => {
    const corner = allNodes(graph)[0]!;
    expect(incidentWalls(graph, corner.id)).toHaveLength(2);
    expect(nodeDegree(graph, corner.id)).toBe(2);
  });
});

describe('error handling', () => {
  it('fails loudly on a dangling node reference', () => {
    const broken: WallGraph = {
      nodes: {},
      walls: { w1: { id: 'w1', a: 'missing', b: 'alsoMissing', thickness: 100, kind: 'interior' } },
    };
    expect(() => getNode(broken, 'missing')).toThrow(/inconsistent/);
  });
});
