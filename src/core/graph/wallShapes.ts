/**
 * The shapes walls actually occupy.
 *
 * A wall in the graph is a centreline plus a thickness. To draw it — or to ask
 * whether a wardrobe is standing in it — that has to become a rectangle:
 * the centreline offset by half the thickness to each side.
 *
 * ## Corners
 *
 * Nothing here mitres anything. Where two walls meet, their rectangles simply
 * overlap, and drawing them as one filled region in a single colour produces
 * exactly the corner a mitre would have produced. Computing true mitre
 * geometry would be a good deal of work to arrive at an identical picture, and
 * it would still have to fall back to something when three or more walls meet
 * at a node — which happens at every T-junction in a real house.
 *
 * The inner edges that give a plan its crispness come from the room outlines in
 * `roomGeometry.ts`, which are offset per wall and therefore correct at
 * junctions between walls of different thickness.
 */

import { type Polygon } from '../geometry/polygon.ts';
import { normalize, perpendicular, scale, sub, add, type Vec2 } from '../geometry/vec2.ts';
import { type Mm } from '../units/length.ts';
import { allWalls, type GraphWall, nodePoint, type WallGraph, type WallId } from './wallGraph.ts';

/**
 * The rectangle a wall occupies, as four corners in order.
 *
 * Ordered so that `[0, 1]` is the left-hand face walking from `a` to `b` and
 * `[2, 3]` is the right-hand one — which is how an opening knows which side of
 * the wall it swings towards.
 */
export function wallPolygon(graph: WallGraph, wall: GraphWall): Polygon {
  const a = nodePoint(graph, wall.a);
  const b = nodePoint(graph, wall.b);
  return wallPolygonBetween(a, b, wall.thickness);
}

export function wallPolygonBetween(a: Vec2, b: Vec2, thickness: Mm): Polygon {
  const direction = sub(b, a);
  // `perpendicular` turns clockwise on screen, so this points to the
  // right-hand side of the a-to-b direction.
  const right = scale(perpendicular(normalize(direction)), thickness / 2);
  const left = scale(right, -1);

  return [add(a, left), add(b, left), add(b, right), add(a, right)];
}

/** Every wall's rectangle, for drawing the whole floor's masonry in one pass. */
export function allWallPolygons(graph: WallGraph): { id: WallId; polygon: Polygon }[] {
  return allWalls(graph).map((wall) => ({ id: wall.id, polygon: wallPolygon(graph, wall) }));
}

/** The midpoint of a wall's centreline, where its label and handle sit. */
export function wallMidpoint(graph: WallGraph, wall: GraphWall): Vec2 {
  const a = nodePoint(graph, wall.a);
  const b = nodePoint(graph, wall.b);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * A point on a wall's centreline, and the wall's direction there.
 *
 * `offset` is measured from the `a` node. Used to place openings, which are
 * stored as a distance along their host wall rather than as coordinates, so
 * that moving the wall carries them with it.
 */
export function pointAlongWall(
  graph: WallGraph,
  wall: GraphWall,
  offset: Mm,
): { point: Vec2; direction: Vec2 } {
  const a = nodePoint(graph, wall.a);
  const b = nodePoint(graph, wall.b);
  const direction = normalize(sub(b, a));

  return { point: add(a, scale(direction, offset)), direction };
}

/**
 * The two faces of a wall as line segments, left then right walking a to b.
 * Wanted wherever something is measured to the surface of a wall rather than
 * to its centre — which is every clearance the app checks.
 */
export function wallFaces(
  graph: WallGraph,
  wall: GraphWall,
): { left: readonly [Vec2, Vec2]; right: readonly [Vec2, Vec2] } {
  const corners = wallPolygon(graph, wall);
  return {
    left: [corners[0]!, corners[1]!],
    right: [corners[3]!, corners[2]!],
  };
}
