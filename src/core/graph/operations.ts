/**
 * Editing operations, as a person thinks of them.
 *
 * `wallGraph.ts` deals in nodes and edges and keeping the graph planar. This is
 * the layer above: "draw a room", "make this wall 3.6 metres", "move this wall
 * 200mm that way". Each is a pure function from graph to graph, so each is
 * testable on its own and the UI layer above holds no geometry at all.
 */

import {
  distance,
  normalize,
  perpendicular,
  scale,
  sub,
  add,
  type Vec2,
} from '../geometry/vec2.ts';
import { type Mm } from '../units/length.ts';
import {
  getWall,
  incidentWalls,
  insertWall,
  moveNode,
  nodePoint,
  type NodeId,
  type WallGraph,
  type WallId,
  type WallKind,
  type WallSplit,
} from './wallGraph.ts';

export interface OperationResult {
  readonly graph: WallGraph;
  readonly splits: readonly WallSplit[];
}

/**
 * Draw a rectangular room from two opposite corners.
 *
 * The four walls go in through `insertWall`, so a rectangle drawn overlapping
 * an existing room shares its walls rather than stacking a second set on top —
 * which is how a plan gets built up room by room without the junctions coming
 * out doubled.
 *
 * A rectangle with no width or height is not a room and is ignored, so a stray
 * click during the draw does nothing.
 */
export function drawRoomRect(
  graph: WallGraph,
  from: Vec2,
  to: Vec2,
  kind: WallKind = 'exterior',
): OperationResult {
  const left = Math.min(from.x, to.x);
  const right = Math.max(from.x, to.x);
  const top = Math.min(from.y, to.y);
  const bottom = Math.max(from.y, to.y);

  if (right - left <= 0 || bottom - top <= 0) return { graph, splits: [] };

  const corners: Vec2[] = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];

  let working = graph;
  const splits: WallSplit[] = [];

  for (let index = 0; index < corners.length; index++) {
    const result = insertWall(working, corners[index]!, corners[(index + 1) % corners.length]!, {
      kind,
    });
    working = result.graph;
    splits.push(...result.splits);
  }

  return { graph: working, splits };
}

/** Draw a run of walls through a list of points. */
export function drawWallRun(
  graph: WallGraph,
  points: readonly Vec2[],
  kind: WallKind = 'interior',
): OperationResult {
  let working = graph;
  const splits: WallSplit[] = [];

  for (let index = 0; index < points.length - 1; index++) {
    const result = insertWall(working, points[index]!, points[index + 1]!, { kind });
    working = result.graph;
    splits.push(...result.splits);
  }

  return { graph: working, splits };
}

/**
 * Set a wall's length by moving one end along its own direction.
 *
 * Which end moves matters. By default the `a` node stays put and `b` moves, but
 * an end joined to other walls should be the one that stays — moving it would
 * drag every wall meeting there and tear the corner open. When both ends are
 * junctions there is no safe choice and `b` moves, which at least leaves the
 * start of the wall where the user was looking.
 *
 * The graph is *not* re-planarised afterwards. Stretching a wall across another
 * leaves them crossing without a node, which the caller has to resolve; the
 * editor keeps lengths within the room being edited, and M3's wall dragging
 * will handle the general case.
 */
export function setWallLength(graph: WallGraph, wallId: WallId, length: Mm): WallGraph {
  if (length <= 0) return graph;

  const wall = getWall(graph, wallId);
  const a = nodePoint(graph, wall.a);
  const b = nodePoint(graph, wall.b);

  const current = distance(a, b);
  if (current === 0 || Math.round(current) === Math.round(length)) return graph;

  const aIsJunction = incidentWalls(graph, wall.a).length > 1;
  const bIsJunction = incidentWalls(graph, wall.b).length > 1;

  // Prefer to move a free end. If only `a` is free, move that instead.
  const moveB = bIsJunction === aIsJunction || !bIsJunction;

  if (moveB) {
    const direction = normalize(sub(b, a));
    return moveNode(graph, wall.b, add(a, scale(direction, length)));
  }

  const direction = normalize(sub(a, b));
  return moveNode(graph, wall.a, add(b, scale(direction, length)));
}

/**
 * Slide a wall sideways, carrying its ends with it.
 *
 * Positive `offset` moves it to the right-hand side walking from `a` to `b`.
 *
 * Only the wall's own two nodes move. Every other wall attached to them follows,
 * because they share those nodes — which is exactly what should happen when a
 * partition is nudged: the walls it meets stretch to stay attached rather than
 * coming adrift.
 */
export function moveWallSideways(graph: WallGraph, wallId: WallId, offset: Mm): WallGraph {
  if (offset === 0) return graph;

  const wall = getWall(graph, wallId);
  const a = nodePoint(graph, wall.a);
  const b = nodePoint(graph, wall.b);

  const shift = scale(perpendicular(normalize(sub(b, a))), offset);

  let working = moveNode(graph, wall.a, add(a, shift));
  working = moveNode(working, wall.b, add(b, shift));
  return working;
}

/**
 * How far a wall can be nudged before it collides with something.
 *
 * Not a safety net — the editor lets a wall be moved anywhere — but the number
 * the inspector shows, so that typing a new position has some context.
 */
export function nodesOf(graph: WallGraph, wallId: WallId): { a: NodeId; b: NodeId } {
  const wall = getWall(graph, wallId);
  return { a: wall.a, b: wall.b };
}
