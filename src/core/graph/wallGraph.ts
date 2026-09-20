/**
 * The wall graph — the document's source of truth for a floor's geometry.
 *
 * A floor is stored as a **planar graph**: nodes at wall junctions, edges for
 * the walls between them. Rooms are not stored at all; they are derived as the
 * bounded faces of this graph (see `faces.ts`).
 *
 * That choice is forced by shared walls. If two adjacent bedrooms each owned
 * their own outline, the wall between them would exist twice — doubled
 * thickness at the junction, and a connecting door that had to be drawn and
 * kept in sync on both sides. Here it is one edge, of one thickness, and a door
 * hosted on it is automatically correct from both rooms.
 *
 * ## The invariant
 *
 * The graph must stay **planar**: no two walls may cross or overlap except at a
 * shared node. Every mutation in this module preserves that, which is why
 * {@link insertWall} is more than a push onto an array — it has to split
 * whatever it crosses, and be split by it in turn.
 *
 * ## Walls are not rooms' property
 *
 * Nothing here knows what a room is. This module maintains a correct planar
 * subdivision; `faces.ts` reads rooms out of it; `roomIdentity.ts` decides
 * which derived face inherits which name. Keeping those three concerns apart is
 * what makes each of them testable.
 */

import { distance, nearlyEquals, roundVec2, type Vec2, vec2 } from '../geometry/vec2.ts';
import {
  isPointInsideSegment,
  parameterAlong,
  pointAt,
  segmentIntersection,
  type Segment,
} from '../geometry/segment.ts';
import { type Mm } from '../units/length.ts';

export type NodeId = string;
export type WallId = string;

/**
 * What a wall is for. This drives default thickness, how it is drawn, and
 * whether an opening in it is an internal door or a window to the outside.
 */
export type WallKind = 'exterior' | 'interior' | 'partition';

export interface GraphNode {
  readonly id: NodeId;
  readonly x: Mm;
  readonly y: Mm;
}

export interface GraphWall {
  readonly id: WallId;
  readonly a: NodeId;
  readonly b: NodeId;
  readonly thickness: Mm;
  readonly kind: WallKind;
}

export interface WallGraph {
  readonly nodes: Readonly<Record<NodeId, GraphNode>>;
  readonly walls: Readonly<Record<WallId, GraphWall>>;
}

/**
 * Record of a wall that was split in two.
 *
 * Openings are hosted on a wall by id and an offset along it, so when a wall is
 * split they have to be re-homed onto whichever part now contains them. The
 * graph does not know about openings, so it reports what it did and the model
 * layer acts on it.
 */
export interface WallSplit {
  readonly originalWallId: WallId;
  /** The node inserted at the split point. */
  readonly nodeId: NodeId;
  /** The two replacement walls, in the original's a-to-b order. */
  readonly parts: readonly [WallId, WallId];
  /** Where along the original wall the split fell, in [0, 1] from a to b. */
  readonly t: number;
  /**
   * How long the original wall was.
   *
   * Recorded because re-homing an opening needs the distance the split fell at,
   * in millimetres, and by the time the caller sees this the original wall is
   * gone. Deriving it from the two parts works only for a single split; a run
   * that cuts the same wall twice leaves the second record referring to a part
   * whose length has already changed.
   */
  readonly originalLength: Mm;
}

/**
 * Geometric tolerance in millimetres.
 *
 * This is deliberately tight — it exists to absorb floating-point error, not to
 * be a user-facing snap radius. The editor snaps the pointer to a much larger
 * radius before ever calling in here.
 */
export const GEOMETRIC_TOLERANCE: Mm = 1;

export const EMPTY_GRAPH: WallGraph = { nodes: {}, walls: {} };

/** Default thickness for each kind of wall, in millimetres. */
export const DEFAULT_WALL_THICKNESS: Record<WallKind, Mm> = {
  // Turkish construction: exterior ~20-30cm with insulation, interior brick
  // plus plaster ~10-13cm, and a lightweight partition ~8cm.
  exterior: 250,
  interior: 100,
  partition: 80,
};

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/**
 * Look up a node, throwing if it is missing.
 *
 * A dangling id is a broken invariant rather than a runtime condition to
 * handle, so it fails loudly instead of propagating `undefined`.
 */
export function getNode(graph: WallGraph, id: NodeId): GraphNode {
  const node = graph.nodes[id];
  if (!node) throw new Error(`Wall graph is inconsistent: no node "${id}"`);
  return node;
}

export function getWall(graph: WallGraph, id: WallId): GraphWall {
  const wall = graph.walls[id];
  if (!wall) throw new Error(`Wall graph is inconsistent: no wall "${id}"`);
  return wall;
}

export function nodePoint(graph: WallGraph, id: NodeId): Vec2 {
  const node = getNode(graph, id);
  return { x: node.x, y: node.y };
}

/** The segment a wall occupies, from its `a` node to its `b` node. */
export function wallSegment(graph: WallGraph, wall: GraphWall): Segment {
  return { a: nodePoint(graph, wall.a), b: nodePoint(graph, wall.b) };
}

export function wallLength(graph: WallGraph, wall: GraphWall): Mm {
  return distance(nodePoint(graph, wall.a), nodePoint(graph, wall.b));
}

export function allWalls(graph: WallGraph): GraphWall[] {
  return Object.values(graph.walls);
}

export function allNodes(graph: WallGraph): GraphNode[] {
  return Object.values(graph.nodes);
}

/** Every wall touching a node. */
export function incidentWalls(graph: WallGraph, nodeId: NodeId): GraphWall[] {
  return allWalls(graph).filter((wall) => wall.a === nodeId || wall.b === nodeId);
}

export function nodeDegree(graph: WallGraph, nodeId: NodeId): number {
  return incidentWalls(graph, nodeId).length;
}

/**
 * Every node reachable from one, walking along walls.
 *
 * What makes it possible to move a room: a room is a face, but the thing that
 * can actually be picked up and put down somewhere else is the whole structure
 * the face belongs to. Two rooms sharing a wall are one such structure, and
 * moving one of them without the other would mean stretching the wall between
 * them — which is a different operation, and one that already has a handle on
 * it.
 */
export function connectedNodes(graph: WallGraph, start: NodeId): Set<NodeId> {
  const seen = new Set<NodeId>();
  if (!graph.nodes[start]) return seen;

  const walls = allWalls(graph);
  const pending: NodeId[] = [start];
  seen.add(start);

  while (pending.length > 0) {
    const current = pending.pop()!;

    for (const wall of walls) {
      const other = wall.a === current ? wall.b : wall.b === current ? wall.a : null;
      if (other === null || seen.has(other)) continue;
      seen.add(other);
      pending.push(other);
    }
  }

  return seen;
}

/** The wall joining two nodes, in either direction, if there is one. */
export function findWallBetween(graph: WallGraph, a: NodeId, b: NodeId): GraphWall | null {
  return (
    allWalls(graph).find(
      (wall) => (wall.a === a && wall.b === b) || (wall.a === b && wall.b === a),
    ) ?? null
  );
}

/** The nearest node within `tolerance`, or null. */
export function findNodeAt(
  graph: WallGraph,
  point: Vec2,
  tolerance: Mm = GEOMETRIC_TOLERANCE,
): GraphNode | null {
  let best: GraphNode | null = null;
  let bestDistance = tolerance;

  for (const node of allNodes(graph)) {
    const d = distance(point, { x: node.x, y: node.y });
    if (d <= bestDistance) {
      bestDistance = d;
      best = node;
    }
  }

  return best;
}

/** The nearest wall whose body passes within `tolerance` of a point, or null. */
export function findWallAt(
  graph: WallGraph,
  point: Vec2,
  tolerance: Mm = GEOMETRIC_TOLERANCE,
): GraphWall | null {
  let best: GraphWall | null = null;
  let bestDistance = tolerance;

  for (const wall of allWalls(graph)) {
    const segment = wallSegment(graph, wall);
    const t = Math.min(1, Math.max(0, parameterAlong(segment, point)));
    const d = distance(point, pointAt(segment, t));
    if (d <= bestDistance) {
      bestDistance = d;
      best = wall;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Id allocation
// ---------------------------------------------------------------------------

export interface IdAllocator {
  node(): NodeId;
  wall(): WallId;
}

/**
 * Ids are `n1`, `n2`, … and `w1`, `w2`, …, continuing from the highest already
 * in the graph.
 *
 * Deriving the counter from the graph rather than a module-level variable keeps
 * operations pure and repeatable: the same graph and the same edit always
 * produce the same ids, which makes the tests below readable and means a
 * reloaded document cannot collide with itself.
 */
export function createIdAllocator(graph: WallGraph): IdAllocator {
  let nextNode = highestSuffix(Object.keys(graph.nodes), 'n') + 1;
  let nextWall = highestSuffix(Object.keys(graph.walls), 'w') + 1;

  return {
    node: () => `n${nextNode++}`,
    wall: () => `w${nextWall++}`,
  };
}

function highestSuffix(ids: readonly string[], prefix: string): number {
  let highest = 0;
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const suffix = Number(id.slice(prefix.length));
    if (Number.isInteger(suffix) && suffix > highest) highest = suffix;
  }
  return highest;
}

// ---------------------------------------------------------------------------
// Mutation — every function returns a new graph; none mutate their input
// ---------------------------------------------------------------------------

function cloneGraph(graph: WallGraph): {
  nodes: Record<NodeId, GraphNode>;
  walls: Record<WallId, GraphWall>;
} {
  return { nodes: { ...graph.nodes }, walls: { ...graph.walls } };
}

/** Add a free-standing node. Mostly useful for building graphs in tests. */
export function addNode(
  graph: WallGraph,
  point: Vec2,
  allocator?: IdAllocator,
): {
  graph: WallGraph;
  nodeId: NodeId;
} {
  const alloc = allocator ?? createIdAllocator(graph);
  const rounded = roundVec2(point);
  const id = alloc.node();

  const next = cloneGraph(graph);
  next.nodes[id] = { id, x: rounded.x, y: rounded.y };
  return { graph: next, nodeId: id };
}

export interface InsertWallOptions {
  readonly kind?: WallKind;
  readonly thickness?: Mm;
  readonly tolerance?: Mm;
}

export interface InsertWallResult {
  readonly graph: WallGraph;
  /** The walls making up the run that was just drawn, in order from `from`. */
  readonly wallIds: readonly WallId[];
  /** Existing walls that had to be split to keep the graph planar. */
  readonly splits: readonly WallSplit[];
}

/**
 * Draw a wall from one point to another, keeping the graph planar.
 *
 * This is the operation the whole module exists for. A wall drawn across a
 * room has to cut the walls it crosses and be cut by them, so that the result
 * is a proper planar subdivision and face extraction can find the two rooms
 * that now exist instead of one.
 *
 * The work is:
 *
 *   1. Find every point where the new run meets the existing graph — proper
 *      crossings, T-junctions, shared corners, and the endpoints of any
 *      collinear overlap with a wall that is already there.
 *   2. Turn each of those points into a node, splitting whichever existing wall
 *      it lands in the middle of.
 *   3. Join consecutive nodes with walls, skipping any pair that is already
 *      joined — which is how drawing over an existing wall leaves it alone
 *      rather than stacking a duplicate on top of it.
 *
 * An existing wall that the new run overlaps keeps its own thickness and kind.
 * Redrawing over a wall is far more often a slip of the pointer than a request
 * to change it, and changing it is one click away in the inspector.
 */
export function insertWall(
  graph: WallGraph,
  from: Vec2,
  to: Vec2,
  options: InsertWallOptions = {},
): InsertWallResult {
  const kind = options.kind ?? 'interior';
  const thickness = options.thickness ?? DEFAULT_WALL_THICKNESS[kind];
  const tolerance = options.tolerance ?? GEOMETRIC_TOLERANCE;

  const start = roundVec2(from);
  const end = roundVec2(to);

  // A zero-length run is a click, not a wall.
  if (distance(start, end) <= tolerance) {
    return { graph, wallIds: [], splits: [] };
  }

  const run: Segment = { a: start, b: end };
  const cutPoints = collectCutPoints(graph, run, tolerance);

  const allocator = createIdAllocator(graph);
  let working = graph;
  const splits: WallSplit[] = [];

  // Resolve every cut point to a node, splitting walls as needed. This runs
  // against the working graph, not the original, so a point landing inside a
  // wall that an earlier point already split still finds the right half.
  const nodeIds: NodeId[] = [];
  for (const point of cutPoints) {
    const resolved = resolveNodeAt(working, point, tolerance, allocator);
    working = resolved.graph;
    splits.push(...resolved.splits);
    nodeIds.push(resolved.nodeId);
  }

  // Join consecutive nodes.
  const wallIds: WallId[] = [];
  const next = cloneGraph(working);

  for (let i = 0; i < nodeIds.length - 1; i++) {
    const a = nodeIds[i]!;
    const b = nodeIds[i + 1]!;
    if (a === b) continue;

    const existing = findWallBetween({ nodes: next.nodes, walls: next.walls }, a, b);
    if (existing) {
      wallIds.push(existing.id);
      continue;
    }

    const id = allocator.wall();
    next.walls[id] = { id, a, b, thickness, kind };
    wallIds.push(id);
  }

  return { graph: next, wallIds, splits };
}

/**
 * Every point along `run` that must become a node: its own endpoints, plus
 * wherever it meets an existing wall. Returned in order from `run.a`, with
 * near-duplicates collapsed.
 */
function collectCutPoints(graph: WallGraph, run: Segment, tolerance: Mm): Vec2[] {
  const parameters: number[] = [0, 1];

  for (const wall of allWalls(graph)) {
    const hit = segmentIntersection(run, wallSegment(graph, wall), tolerance);

    if (hit.kind === 'point') {
      parameters.push(hit.t);
    } else if (hit.kind === 'collinear') {
      // Both ends of the shared span become nodes, so the overlapping stretch
      // maps exactly onto the wall that is already there.
      parameters.push(parameterAlong(run, hit.overlap[0]));
      parameters.push(parameterAlong(run, hit.overlap[1]));
    }
  }

  const runLength = distance(run.a, run.b);
  const slack = tolerance / runLength;

  const sorted = parameters
    .map((t) => Math.min(1, Math.max(0, t)))
    .sort((left, right) => left - right);

  const points: Vec2[] = [];
  let previous = -Infinity;
  for (const t of sorted) {
    if (t - previous <= slack) continue;
    previous = t;
    points.push(roundVec2(pointAt(run, t)));
  }

  // Rounding to whole millimetres can collapse two parameters onto one point.
  return dedupePoints(points, tolerance);
}

function dedupePoints(points: readonly Vec2[], tolerance: Mm): Vec2[] {
  const result: Vec2[] = [];
  for (const point of points) {
    const last = result[result.length - 1];
    if (last && nearlyEquals(last, point, tolerance)) continue;
    result.push(point);
  }
  return result;
}

interface ResolvedNode {
  readonly graph: WallGraph;
  readonly nodeId: NodeId;
  readonly splits: readonly WallSplit[];
}

/**
 * Get a node at a point, creating one if needed.
 *
 * Reuses an existing node when there is one close enough. Otherwise, if the
 * point falls in the middle of a wall, that wall is split so the new node sits
 * on the graph rather than merely near it — this is what stops a T-junction
 * from leaving two rooms silently joined.
 */
function resolveNodeAt(
  graph: WallGraph,
  point: Vec2,
  tolerance: Mm,
  allocator: IdAllocator,
): ResolvedNode {
  const existing = findNodeAt(graph, point, tolerance);
  if (existing) return { graph, nodeId: existing.id, splits: [] };

  const host = allWalls(graph).find((wall) =>
    isPointInsideSegment(wallSegment(graph, wall), point, tolerance),
  );

  if (!host) {
    const added = addNode(graph, point, allocator);
    return { graph: added.graph, nodeId: added.nodeId, splits: [] };
  }

  const split = splitWall(graph, host.id, point, allocator);
  return { graph: split.graph, nodeId: split.split.nodeId, splits: [split.split] };
}

/**
 * Split a wall in two at a point on it.
 *
 * The original wall id disappears; the two halves get fresh ids. The returned
 * {@link WallSplit} is what lets the model layer move any openings hosted on
 * the original onto whichever half now contains them.
 */
export function splitWall(
  graph: WallGraph,
  wallId: WallId,
  point: Vec2,
  allocator?: IdAllocator,
): { graph: WallGraph; split: WallSplit } {
  const alloc = allocator ?? createIdAllocator(graph);
  const wall = getWall(graph, wallId);
  const segment = wallSegment(graph, wall);

  const rounded = roundVec2(point);
  const t = Math.min(1, Math.max(0, parameterAlong(segment, rounded)));

  const nodeId = alloc.node();
  const firstId = alloc.wall();
  const secondId = alloc.wall();

  const next = cloneGraph(graph);
  next.nodes[nodeId] = { id: nodeId, x: rounded.x, y: rounded.y };
  delete next.walls[wallId];
  next.walls[firstId] = {
    id: firstId,
    a: wall.a,
    b: nodeId,
    thickness: wall.thickness,
    kind: wall.kind,
  };
  next.walls[secondId] = {
    id: secondId,
    a: nodeId,
    b: wall.b,
    thickness: wall.thickness,
    kind: wall.kind,
  };

  return {
    graph: next,
    split: {
      originalWallId: wallId,
      nodeId,
      parts: [firstId, secondId],
      t,
      originalLength: distance(segment.a, segment.b),
    },
  };
}

/** Remove a wall, and any node it leaves with nothing attached. */
export function removeWall(graph: WallGraph, wallId: WallId): WallGraph {
  if (!graph.walls[wallId]) return graph;

  const next = cloneGraph(graph);
  delete next.walls[wallId];
  return pruneOrphanNodes(next);
}

/** Remove a node along with every wall attached to it. */
export function removeNode(graph: WallGraph, nodeId: NodeId): WallGraph {
  if (!graph.nodes[nodeId]) return graph;

  const next = cloneGraph(graph);
  delete next.nodes[nodeId];
  for (const wall of Object.values(next.walls)) {
    if (wall.a === nodeId || wall.b === nodeId) delete next.walls[wall.id];
  }
  return pruneOrphanNodes(next);
}

/** Move a node. Used for dragging a corner; does not re-planarise the graph. */
export function moveNode(graph: WallGraph, nodeId: NodeId, point: Vec2): WallGraph {
  const node = getNode(graph, nodeId);
  const rounded = roundVec2(point);
  if (node.x === rounded.x && node.y === rounded.y) return graph;

  const next = cloneGraph(graph);
  next.nodes[nodeId] = { id: nodeId, x: rounded.x, y: rounded.y };
  return next;
}

/** Change a wall's thickness or kind. */
export function updateWall(
  graph: WallGraph,
  wallId: WallId,
  changes: { thickness?: Mm; kind?: WallKind },
): WallGraph {
  const wall = getWall(graph, wallId);
  const next = cloneGraph(graph);
  next.walls[wallId] = {
    ...wall,
    ...(changes.thickness === undefined ? {} : { thickness: changes.thickness }),
    ...(changes.kind === undefined ? {} : { kind: changes.kind }),
  };
  return next;
}

/** Drop nodes with no walls attached. */
export function pruneOrphanNodes(graph: WallGraph): WallGraph {
  const used = new Set<NodeId>();
  for (const wall of Object.values(graph.walls)) {
    used.add(wall.a);
    used.add(wall.b);
  }

  const orphans = Object.keys(graph.nodes).filter((id) => !used.has(id));
  if (orphans.length === 0) return graph;

  const next = cloneGraph(graph);
  for (const id of orphans) delete next.nodes[id];
  return next;
}

// ---------------------------------------------------------------------------
// Construction helpers
// ---------------------------------------------------------------------------

export interface SegmentSpec {
  readonly from: readonly [Mm, Mm];
  readonly to: readonly [Mm, Mm];
  readonly kind?: WallKind;
  readonly thickness?: Mm;
}

/**
 * Build a graph by drawing a list of segments in order.
 *
 * Each is inserted with {@link insertWall}, so the result is properly planar
 * however the segments overlap — which makes this the natural way to write a
 * test fixture and to describe a room template.
 */
export function graphFromSegments(segments: readonly SegmentSpec[]): WallGraph {
  let graph = EMPTY_GRAPH;

  for (const spec of segments) {
    const result = insertWall(
      graph,
      vec2(spec.from[0], spec.from[1]),
      vec2(spec.to[0], spec.to[1]),
      {
        ...(spec.kind === undefined ? {} : { kind: spec.kind }),
        ...(spec.thickness === undefined ? {} : { thickness: spec.thickness }),
      },
    );
    graph = result.graph;
  }

  return graph;
}

/**
 * Build a closed rectangle of walls. The workhorse for fixtures, and what the
 * editor's "draw a room" tool ultimately calls.
 */
export function rectangleSegments(
  x: Mm,
  y: Mm,
  width: Mm,
  height: Mm,
  kind: WallKind = 'exterior',
): SegmentSpec[] {
  const right = x + width;
  const bottom = y + height;
  return [
    { from: [x, y], to: [right, y], kind },
    { from: [right, y], to: [right, bottom], kind },
    { from: [right, bottom], to: [x, bottom], kind },
    { from: [x, bottom], to: [x, y], kind },
  ];
}
