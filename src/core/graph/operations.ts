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
import { roundMm, type Mm } from '../units/length.ts';
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

export interface RoomSizeSpec {
  /** Clear distance between the wall faces, left to right. */
  readonly width: Mm;
  /** Clear distance between the wall faces, front to back. */
  readonly depth: Mm;
  readonly thickness: Mm;
  readonly kind?: WallKind;
  /** Inside corner the room grows from. Defaults to the origin. */
  readonly origin?: Vec2;
}

/**
 * Build a room from the measurements someone actually took.
 *
 * This is the distinction the whole function exists for. A tape measure reports
 * the distance between wall *faces*; the graph stores wall *centrelines*. Typing
 * 3600 x 4200 has to produce a room whose usable floor is 3600 x 4200, which
 * means the centreline rectangle is one wall thickness larger in each direction
 * — half a wall at each end.
 *
 * Getting this backwards is not a rounding error. It makes every room silently
 * smaller than the number typed into it, by 100mm in a partitioned room and
 * 250mm against an exterior wall, which is the difference between a wardrobe
 * fitting and not.
 */
export function createRoomFromInnerSize(graph: WallGraph, spec: RoomSizeSpec): OperationResult {
  const origin = spec.origin ?? { x: 0, y: 0 };
  const half = spec.thickness / 2;

  if (spec.width <= 0 || spec.depth <= 0) return { graph, splits: [] };

  // Grow outwards from the inner rectangle by half a wall on every side, so the
  // centrelines land where they have to for the floor to measure what was asked.
  //
  // Only one corner is rounded; the opposite one is derived from it. An odd
  // thickness — 135mm is an ordinary brick-and-plaster wall — gives a half of
  // 67.5, and rounding both corners independently pushes each of them outwards,
  // so a room asked for as 3600 comes back as 3601. Deriving the far corner
  // keeps the centreline span at exactly `width + thickness` however the halves
  // fall, which is what makes the floor exact.
  const left = roundMm(origin.x - half);
  const top = roundMm(origin.y - half);

  return drawRoomRect(
    graph,
    { x: left, y: top },
    { x: left + spec.width + spec.thickness, y: top + spec.depth + spec.thickness },
    spec.kind ?? 'exterior',
    spec.thickness,
  );
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
  thickness?: Mm,
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
      ...(thickness === undefined ? {} : { thickness }),
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
  thickness?: Mm,
): OperationResult {
  let working = graph;
  const splits: WallSplit[] = [];

  for (let index = 0; index < points.length - 1; index++) {
    const result = insertWall(working, points[index]!, points[index + 1]!, {
      kind,
      ...(thickness === undefined ? {} : { thickness }),
    });
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

// ---------------------------------------------------------------------------
// L-shaped rooms
// ---------------------------------------------------------------------------

/** Which corner of the overall rectangle the room is missing. */
export type NotchCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface LRoomSpec extends RoomSizeSpec {
  /** Width of the missing corner, measured between wall faces like the rest. */
  readonly notchWidth: Mm;
  readonly notchDepth: Mm;
  readonly notchCorner: NotchCorner;
}

/**
 * The narrowest arm an L is allowed to have.
 *
 * Not a rule about architecture, just about arithmetic: an arm thinner than
 * this produces walls that overlap their own neighbours, and a graph that
 * describes a shape nobody asked for. The panel refuses it before it gets here.
 */
export const MIN_ARM: Mm = 200;

export function isValidLRoom(spec: LRoomSpec): boolean {
  return (
    spec.width > 0 &&
    spec.depth > 0 &&
    spec.notchWidth > 0 &&
    spec.notchDepth > 0 &&
    spec.width - spec.notchWidth >= MIN_ARM &&
    spec.depth - spec.notchDepth >= MIN_ARM
  );
}

/**
 * Build an L-shaped room from the measurements someone actually took.
 *
 * The same promise the rectangle makes, on a harder shape: every number typed
 * is a distance between wall *faces*, so a 5m × 4m room with a 2m × 1.5m corner
 * taken out of it has exactly those five measurements when the tape comes out
 * again. Rooms with a chimney breast, a stair bulkhead or a bathroom cut into
 * the corner are ordinary, and a planner that only does rectangles cannot
 * describe most real houses.
 *
 * ## Why the coordinates are derived rather than computed
 *
 * The graph stores centrelines, so every face measurement has to be pushed out
 * by half a wall. At an odd thickness — 135mm is an ordinary brick-and-plaster
 * wall — half is 67.5, and rounding each corner independently pushes each of
 * them outwards by its own half-millimetre, which shows up as a room 1mm wider
 * than the one that was asked for.
 *
 * So exactly two numbers are rounded, the top-left centrelines, and every other
 * coordinate is derived from them by adding whole millimetres. The absolute
 * position can then sit half a millimetre off the origin — which nobody can
 * measure and nothing depends on — while every *span* is exact, which is the
 * thing the tape measure will check.
 */
export function createLShapedRoom(graph: WallGraph, spec: LRoomSpec): OperationResult {
  if (!isValidLRoom(spec)) return { graph, splits: [] };

  const origin = spec.origin ?? { x: 0, y: 0 };
  const thickness = spec.thickness;
  const half = thickness / 2;

  // The only two rounded values. Everything below is one of these plus an
  // integer, so no span can drift.
  const left = roundMm(origin.x - half);
  const top = roundMm(origin.y - half);

  const right = left + spec.width + thickness;
  const bottom = top + spec.depth + thickness;

  // The two walls that form the notch. Which side of its face each one's
  // centreline falls on depends on which corner is missing, so each case
  // spells out its own.
  const ring = notchRing(spec, { left, top, right, bottom, thickness });

  // Closed by repeating the first point: `drawWallRun` walks pairs, so the
  // last pair is the wall back to the start.
  return drawWallRun(graph, [...ring, ring[0]!], spec.kind ?? 'exterior', thickness);
}

interface Frame {
  readonly left: Mm;
  readonly top: Mm;
  readonly right: Mm;
  readonly bottom: Mm;
  readonly thickness: Mm;
}

/** The centreline ring, clockwise on screen, for each missing corner. */
function notchRing(spec: LRoomSpec, frame: Frame): Vec2[] {
  const { left, top, right, bottom, thickness } = frame;
  const { width, depth, notchWidth, notchDepth } = spec;

  switch (spec.notchCorner) {
    case 'top-right': {
      // The notch's vertical wall keeps the room on its left, so its centreline
      // sits a full wall in from the right-hand side.
      const vertical = left + (width - notchWidth) + thickness;
      const horizontal = top + notchDepth;
      return [
        { x: left, y: top },
        { x: vertical, y: top },
        { x: vertical, y: horizontal },
        { x: right, y: horizontal },
        { x: right, y: bottom },
        { x: left, y: bottom },
      ];
    }

    case 'top-left': {
      const vertical = left + notchWidth;
      const horizontal = top + notchDepth;
      return [
        { x: vertical, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom },
        { x: left, y: horizontal },
        { x: vertical, y: horizontal },
      ];
    }

    case 'bottom-right': {
      const vertical = left + (width - notchWidth) + thickness;
      const horizontal = top + (depth - notchDepth) + thickness;
      return [
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: horizontal },
        { x: vertical, y: horizontal },
        { x: vertical, y: bottom },
        { x: left, y: bottom },
      ];
    }

    case 'bottom-left': {
      const vertical = left + notchWidth;
      const horizontal = top + (depth - notchDepth) + thickness;
      return [
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: vertical, y: bottom },
        { x: vertical, y: horizontal },
        { x: left, y: horizontal },
      ];
    }
  }
}
