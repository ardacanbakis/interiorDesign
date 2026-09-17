/**
 * Planar face extraction — turning a wall graph into rooms.
 *
 * Rooms are never stored. They are the bounded faces of the wall graph, and
 * this module recovers them. That is what makes shared walls work: draw a wall
 * across a bedroom and two rooms appear, because the graph now has two bounded
 * faces where it had one. Delete it and they become one again. Nothing had to
 * be told that a room was created or destroyed.
 *
 * ## The algorithm
 *
 * Every wall becomes two directed half-edges, one each way. At each node the
 * outgoing half-edges are sorted by angle. Then, for a half-edge arriving at a
 * node, the next half-edge in its face is found by taking its twin and rotating
 * to the **next smaller angle**, cyclically.
 *
 * That rule is the whole algorithm, and the direction matters. Rotating the
 * other way traces the same graph but follows the outside of each room instead
 * of the inside — on a two-room plan it returns the building's outline once
 * rather than the two rooms, which looks plausible right up until the areas are
 * wrong.
 *
 * Following `next` from an unvisited half-edge and continuing until it comes
 * back around yields one face. Doing that until every half-edge is used yields
 * all of them.
 *
 * ## Telling rooms from the outside world
 *
 * With this traversal and the y-down convention from `vec2.ts`, **bounded faces
 * come out wound clockwise on screen, so their signed area is positive**. The
 * unbounded face surrounding the whole graph comes out negative. Each
 * disconnected part of the graph produces its own negative face, so the test is
 * the sign, not "the biggest one".
 *
 * Faces with zero area are walls that enclose nothing — a dangling stub, or a
 * plan that is still just a line. They are discarded.
 *
 * ## Holes
 *
 * A freestanding structure inside a room — a column, a partition that touches
 * nothing — is a separate connected component, so it produces a negative face
 * of its own that happens to lie inside a positive one. Those are matched up
 * and attached as holes, which keeps the room's area honest.
 */

import {
  area as polygonArea,
  boundingBox,
  containsPoint,
  representativePoint,
  signedArea,
  type Polygon,
} from '../geometry/polygon.ts';
import { angleOf, sub, type Vec2 } from '../geometry/vec2.ts';
import { type Mm2 } from '../units/length.ts';
import { allWalls, nodePoint, type NodeId, type WallGraph, type WallId } from './wallGraph.ts';

/**
 * A bounded region of the floor — a room, before anyone has named it.
 *
 * The polygon runs along wall **centrelines**. The usable floor area bounded by
 * the inner faces of the walls is a separate calculation; see `roomGeometry.ts`.
 */
export interface Face {
  /**
   * Derived from the ring's node ids. Stable while the surrounding walls are,
   * which is enough to key a list against — persistent room identity across
   * edits is `roomIdentity.ts`'s job, not this one.
   */
  readonly id: string;
  /** The outer ring, wound clockwise on screen. */
  readonly nodeIds: readonly NodeId[];
  readonly polygon: Polygon;
  /** Freestanding structures enclosed by this face. */
  readonly holes: readonly Polygon[];
  /** Centreline area, with any holes subtracted. */
  readonly area: Mm2;
  /** The walls bounding the outer ring. */
  readonly wallIds: readonly WallId[];
  /** A point comfortably inside, for labels and for anchoring room data. */
  readonly interiorPoint: Vec2;
}

interface HalfEdge {
  readonly key: string;
  readonly wallId: WallId;
  readonly from: NodeId;
  readonly to: NodeId;
  readonly angle: number;
  readonly twinKey: string;
}

interface Cycle {
  readonly nodeIds: NodeId[];
  readonly wallIds: WallId[];
  readonly polygon: Vec2[];
  readonly signed: number;
  /** Which connected part of the graph this cycle belongs to. */
  readonly component: number;
}

const FORWARD = 0;
const REVERSE = 1;

function halfEdgeKey(wallId: WallId, direction: number): string {
  return `${wallId}:${direction}`;
}

/**
 * Extract every bounded face of the graph.
 *
 * Returned largest first, so that a room containing another still renders
 * underneath it when faces are drawn in order.
 */
export function extractFaces(graph: WallGraph): Face[] {
  const halfEdges = buildHalfEdges(graph);
  const outgoing = groupByOrigin(halfEdges);
  const components = findConnectedComponents(graph);
  const cycles = traceCycles(graph, halfEdges, outgoing, components);

  const bounded: Cycle[] = [];
  const unbounded: Cycle[] = [];

  for (const cycle of cycles) {
    if (cycle.signed > 0) bounded.push(cycle);
    else if (cycle.signed < 0) unbounded.push(cycle);
    // Exactly zero: walls enclosing nothing. Discarded.
  }

  const holesByFace = assignHoles(bounded, unbounded);

  const faces = bounded.map((cycle, index) => {
    const holes = holesByFace.get(index) ?? [];
    const holeArea = holes.reduce((total, hole) => total + polygonArea(hole), 0);

    return {
      id: faceId(cycle.nodeIds),
      nodeIds: cycle.nodeIds,
      polygon: cycle.polygon,
      holes,
      area: Math.abs(cycle.signed) - holeArea,
      wallIds: cycle.wallIds,
      interiorPoint: representativePoint(cycle.polygon),
    } satisfies Face;
  });

  // Largest first, with the id as a tiebreak so that a plan split into two
  // equal halves still produces a stable, repeatable order — room
  // reconciliation depends on this being deterministic.
  return faces.sort((left, right) => right.area - left.area || left.id.localeCompare(right.id));
}

function buildHalfEdges(graph: WallGraph): Map<string, HalfEdge> {
  const halfEdges = new Map<string, HalfEdge>();

  for (const wall of allWalls(graph)) {
    const a = nodePoint(graph, wall.a);
    const b = nodePoint(graph, wall.b);

    const forwardKey = halfEdgeKey(wall.id, FORWARD);
    const reverseKey = halfEdgeKey(wall.id, REVERSE);

    halfEdges.set(forwardKey, {
      key: forwardKey,
      wallId: wall.id,
      from: wall.a,
      to: wall.b,
      angle: angleOf(sub(b, a)),
      twinKey: reverseKey,
    });

    halfEdges.set(reverseKey, {
      key: reverseKey,
      wallId: wall.id,
      from: wall.b,
      to: wall.a,
      angle: angleOf(sub(a, b)),
      twinKey: forwardKey,
    });
  }

  return halfEdges;
}

/** Outgoing half-edges per node, sorted by angle ascending. */
function groupByOrigin(halfEdges: Map<string, HalfEdge>): Map<NodeId, HalfEdge[]> {
  const outgoing = new Map<NodeId, HalfEdge[]>();

  for (const halfEdge of halfEdges.values()) {
    const list = outgoing.get(halfEdge.from);
    if (list) list.push(halfEdge);
    else outgoing.set(halfEdge.from, [halfEdge]);
  }

  for (const list of outgoing.values()) {
    list.sort((left, right) => left.angle - right.angle);
  }

  return outgoing;
}

/**
 * The next half-edge in the same face.
 *
 * Take the twin — which points back the way we came — and rotate to the next
 * smaller angle around the shared node, wrapping past the start of the list.
 * That is the sharpest available clockwise turn on screen, which is what keeps
 * the traversal hugging the inside of a room rather than escaping around the
 * outside of it.
 */
function nextInFace(
  halfEdge: HalfEdge,
  halfEdges: Map<string, HalfEdge>,
  outgoing: Map<NodeId, HalfEdge[]>,
): HalfEdge {
  const twin = halfEdges.get(halfEdge.twinKey);
  if (!twin) throw new Error(`Half-edge ${halfEdge.key} has no twin`);

  const siblings = outgoing.get(halfEdge.to);
  if (!siblings || siblings.length === 0) {
    throw new Error(`Node ${halfEdge.to} has no outgoing half-edges`);
  }

  const index = siblings.findIndex((candidate) => candidate.key === twin.key);
  if (index < 0) throw new Error(`Twin of ${halfEdge.key} missing from node ${halfEdge.to}`);

  return siblings[(index - 1 + siblings.length) % siblings.length]!;
}

/**
 * Label each node with the connected part of the graph it belongs to.
 *
 * Needed to tell a room's own outer boundary apart from an island standing
 * inside it. For a plain rectangle those two cycles trace the same four
 * corners, differing only in direction, so no amount of containment testing can
 * separate them — but they always belong to the same component, and an island
 * never does.
 */
function findConnectedComponents(graph: WallGraph): Map<NodeId, number> {
  const neighbours = new Map<NodeId, NodeId[]>();
  for (const wall of allWalls(graph)) {
    (neighbours.get(wall.a) ?? neighbours.set(wall.a, []).get(wall.a)!).push(wall.b);
    (neighbours.get(wall.b) ?? neighbours.set(wall.b, []).get(wall.b)!).push(wall.a);
  }

  const component = new Map<NodeId, number>();
  let next = 0;

  for (const start of neighbours.keys()) {
    if (component.has(start)) continue;

    const id = next++;
    const stack = [start];
    component.set(start, id);

    while (stack.length > 0) {
      const node = stack.pop()!;
      for (const neighbour of neighbours.get(node) ?? []) {
        if (component.has(neighbour)) continue;
        component.set(neighbour, id);
        stack.push(neighbour);
      }
    }
  }

  return component;
}

function traceCycles(
  graph: WallGraph,
  halfEdges: Map<string, HalfEdge>,
  outgoing: Map<NodeId, HalfEdge[]>,
  components: Map<NodeId, number>,
): Cycle[] {
  const visited = new Set<string>();
  const cycles: Cycle[] = [];

  for (const start of halfEdges.values()) {
    if (visited.has(start.key)) continue;

    const nodeIds: NodeId[] = [];
    const wallIds: WallId[] = [];
    const polygon: Vec2[] = [];

    let current = start;
    // Bound the walk so a malformed graph fails fast rather than hanging.
    const limit = halfEdges.size + 1;

    for (let step = 0; step < limit; step++) {
      visited.add(current.key);
      nodeIds.push(current.from);
      wallIds.push(current.wallId);
      polygon.push(nodePoint(graph, current.from));

      current = nextInFace(current, halfEdges, outgoing);
      if (current.key === start.key) break;

      if (visited.has(current.key)) {
        throw new Error(`Face traversal re-entered half-edge ${current.key}`);
      }
    }

    if (current.key !== start.key) {
      throw new Error('Face traversal failed to close; the wall graph is malformed');
    }

    cycles.push({
      nodeIds,
      wallIds,
      polygon,
      signed: signedArea(polygon),
      component: components.get(start.from) ?? -1,
    });
  }

  return cycles;
}

/**
 * Match each unbounded cycle that stands inside a bounded face to that face.
 *
 * Two guards, and both are load-bearing:
 *
 * - **Different components.** Every connected part of the graph produces its
 *   own unbounded cycle, and for a lone rectangle that cycle traces exactly the
 *   same four corners as the room, only backwards. Containment cannot tell them
 *   apart — it reports the room as standing inside itself, and the room's area
 *   comes out as zero. An island is always a separate component, so that is the
 *   test.
 * - **Innermost wins.** Where components nest more than one deep, a column
 *   inside a room inside a building belongs to the room.
 */
function assignHoles(
  bounded: readonly Cycle[],
  unbounded: readonly Cycle[],
): Map<number, Polygon[]> {
  const holes = new Map<number, Polygon[]>();
  if (bounded.length === 0) return holes;

  for (const candidate of unbounded) {
    const probe = representativePoint(candidate.polygon);

    let bestIndex = -1;
    let bestArea = Infinity;

    for (let index = 0; index < bounded.length; index++) {
      const face = bounded[index]!;
      if (face.component === candidate.component) continue;
      if (Math.abs(face.signed) >= bestArea) continue;
      if (!boundingBoxContains(face.polygon, candidate.polygon)) continue;
      if (!containsPoint(face.polygon, probe)) continue;

      bestIndex = index;
      bestArea = Math.abs(face.signed);
    }

    if (bestIndex < 0) continue;

    const list = holes.get(bestIndex);
    if (list) list.push(candidate.polygon);
    else holes.set(bestIndex, [candidate.polygon]);
  }

  return holes;
}

/** Cheap rejection before the point-in-polygon test. */
function boundingBoxContains(outer: Polygon, inner: Polygon): boolean {
  const a = boundingBox(outer);
  const b = boundingBox(inner);
  return a.minX <= b.minX && a.minY <= b.minY && a.maxX >= b.maxX && a.maxY >= b.maxY;
}

/**
 * A face id derived from its ring.
 *
 * Rotation-independent, so the same ring traced from a different starting
 * half-edge gets the same id, but direction-preserving, so it still reflects
 * the actual set of corners.
 */
function faceId(nodeIds: readonly NodeId[]): string {
  if (nodeIds.length === 0) return 'face:empty';

  let pivot = 0;
  for (let index = 1; index < nodeIds.length; index++) {
    if (nodeIds[index]! < nodeIds[pivot]!) pivot = index;
  }

  const rotated = [...nodeIds.slice(pivot), ...nodeIds.slice(0, pivot)];
  return `face:${rotated.join('-')}`;
}
