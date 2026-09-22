/**
 * Joining what has been pushed together.
 *
 * `insertWall` keeps the graph planar while walls are being *drawn* — it cuts
 * what it crosses and refuses to stack a second wall on top of one that is
 * already there. Moving a room does not go through it: a move is a translation,
 * so a room slid up against its neighbour ends with two walls occupying the
 * same line, two pairs of corners in the same place, and no idea that they are
 * anything to do with each other. Face extraction then finds two rooms that
 * happen to be adjacent rather than two rooms sharing a wall, which is the
 * difference between a drawing and a house.
 *
 * Welding is the repair, in three steps, each of which is the obvious one:
 *
 *   1. **Corners in the same place become one corner.**
 *   2. **A corner sitting in the middle of a wall cuts it.** This is what turns
 *      partial overlaps into exact ones — a 4m wall against a 3m one is cut at
 *      the shorter one's end, leaving a 3m stretch that matches exactly and a
 *      1m stretch that does not.
 *   3. **Two walls between the same pair of corners become one wall.** After
 *      step 2 that is the only shape an overlap can be left in.
 *
 * Steps 1 and 2 feed each other — cutting a wall makes a new corner, which may
 * sit on another wall — so they run until nothing changes, and only then does
 * step 3 run.
 *
 * ## Which wall survives
 *
 * The thicker of the two, and the more structural kind. Two rooms cannot share
 * a wall and each keep their own thickness, so one of them has to give; taking
 * the greater is the answer that never makes a wall weaker than it was drawn.
 * Each room's usable floor is then inset by half of the shared wall, which is
 * the whole point of sharing it, and the areas on the plan update to say so.
 */

import {
  allNodes,
  allWalls,
  createIdAllocator,
  GEOMETRIC_TOLERANCE,
  splitWall,
  wallLength,
  wallSegment,
  type GraphWall,
  type NodeId,
  type WallGraph,
  type WallId,
  type WallKind,
  type WallSplit,
} from './wallGraph.ts';
import { isPointInsideSegment } from '../geometry/segment.ts';
import { type OperationResult } from './operations.ts';
import { type Mm } from '../units/length.ts';

/** Two walls in the same place, become one. */
export interface WallMerge {
  readonly fromWallId: WallId;
  readonly toWallId: WallId;
  /**
   * True when the surviving wall runs the opposite way to the one that died.
   *
   * Everything about an opening is measured from its wall's `a` end — the
   * distance along it, which end the hinge is at, and which side the leaf
   * swings towards. Move a door onto a wall pointing the other way without
   * turning all three round and it ends up at the far end of the wall, hinged
   * on the wrong side, opening into the neighbour's room.
   */
  readonly reversed: boolean;
  /** Length of the surviving wall, for mapping a distance onto a reversed one. */
  readonly length: Mm;
}

export interface WeldResult extends OperationResult {
  readonly merges: readonly WallMerge[];
}

/**
 * A cap on the merge-and-cut loop.
 *
 * Each pass either changes the graph or is the last; a plan needs one or two.
 * The limit is here so that a graph nobody anticipated cannot spin forever
 * inside a pointer handler.
 */
const MAX_PASSES = 8;

export function weld(graph: WallGraph, tolerance: Mm = GEOMETRIC_TOLERANCE): WeldResult {
  let working = graph;
  const splits: WallSplit[] = [];

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const joined = mergeNodes(working, tolerance);
    const cut = cutWallsAtNodes(joined, tolerance);
    splits.push(...cut.splits);

    if (cut.graph === working) break;
    working = cut.graph;
  }

  const merged = mergeDuplicateWalls(working);
  return { graph: merged.graph, splits, merges: merged.merges };
}

/** True when a graph has anything in it that welding would change. */
export function needsWelding(graph: WallGraph, tolerance: Mm = GEOMETRIC_TOLERANCE): boolean {
  return weld(graph, tolerance).graph !== graph;
}

// ---------------------------------------------------------------------------

/**
 * Corners in the same place become one corner.
 *
 * A wall whose two ends turn out to be the same corner has no length left and
 * goes. That can only happen to a wall that was already degenerate, so nothing
 * of substance is lost — but leaving it in would put a zero-length wall in the
 * graph, which every piece of geometry downstream would then have to guard
 * against.
 */
function mergeNodes(graph: WallGraph, tolerance: Mm): WallGraph {
  const nodes = allNodes(graph);
  const replacement = new Map<NodeId, NodeId>();

  for (let index = 0; index < nodes.length; index++) {
    const keep = nodes[index]!;
    if (replacement.has(keep.id)) continue;

    for (let other = index + 1; other < nodes.length; other++) {
      const drop = nodes[other]!;
      if (replacement.has(drop.id)) continue;

      if (Math.abs(keep.x - drop.x) <= tolerance && Math.abs(keep.y - drop.y) <= tolerance) {
        replacement.set(drop.id, keep.id);
      }
    }
  }

  if (replacement.size === 0) return graph;

  const walls: Record<WallId, GraphWall> = {};
  for (const wall of allWalls(graph)) {
    const a = replacement.get(wall.a) ?? wall.a;
    const b = replacement.get(wall.b) ?? wall.b;
    if (a === b) continue;
    walls[wall.id] = { ...wall, a, b };
  }

  const remaining = Object.fromEntries(
    nodes.filter((node) => !replacement.has(node.id)).map((node) => [node.id, node]),
  );

  return { nodes: remaining, walls };
}

/**
 * A corner sitting in the middle of a wall cuts it.
 *
 * The cut makes its own corner in the same place as the one that caused it;
 * the next round of {@link mergeNodes} collapses the pair. Going through
 * `splitWall` rather than surgery here is what produces the split record an
 * opening needs to find its way onto the right half.
 */
function cutWallsAtNodes(
  graph: WallGraph,
  tolerance: Mm,
): { graph: WallGraph; splits: WallSplit[] } {
  const allocator = createIdAllocator(graph);
  const splits: WallSplit[] = [];

  let working = graph;
  let cutting = true;

  while (cutting) {
    cutting = false;

    for (const wall of allWalls(working)) {
      const segment = wallSegment(working, wall);

      for (const node of allNodes(working)) {
        if (node.id === wall.a || node.id === wall.b) continue;
        if (!isPointInsideSegment(segment, { x: node.x, y: node.y }, tolerance)) continue;

        const result = splitWall(working, wall.id, { x: node.x, y: node.y }, allocator);
        working = result.graph;
        splits.push(result.split);
        cutting = true;
        break;
      }

      if (cutting) break;
    }
  }

  return { graph: working, splits };
}

/** How much wall a kind implies, for deciding which survives a merge. */
const KIND_RANK: Record<WallKind, number> = { partition: 0, interior: 1, exterior: 2 };

function strongerKind(first: WallKind, second: WallKind): WallKind {
  return KIND_RANK[second] > KIND_RANK[first] ? second : first;
}

/** Two walls between the same pair of corners become one. */
function mergeDuplicateWalls(graph: WallGraph): { graph: WallGraph; merges: WallMerge[] } {
  const survivors = new Map<string, GraphWall>();
  const merges: WallMerge[] = [];
  const walls: Record<WallId, GraphWall> = {};

  for (const wall of allWalls(graph)) {
    const key = [wall.a, wall.b].sort().join('\u0000');
    const existing = survivors.get(key);

    if (!existing) {
      survivors.set(key, wall);
      walls[wall.id] = wall;
      continue;
    }

    const survivor: GraphWall = {
      ...existing,
      thickness: Math.max(existing.thickness, wall.thickness),
      kind: strongerKind(existing.kind, wall.kind),
    };

    survivors.set(key, survivor);
    walls[existing.id] = survivor;

    merges.push({
      fromWallId: wall.id,
      toWallId: existing.id,
      reversed: wall.a !== existing.a,
      length: wallLength(graph, existing),
    });
  }

  if (merges.length === 0) return { graph, merges };
  return { graph: { nodes: graph.nodes, walls }, merges };
}
