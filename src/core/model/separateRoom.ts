/**
 * Taking a room back out of the house.
 *
 * The other half of joining, and it has to exist. Once two rooms share a wall
 * they are one structure, so dragging either moves both — which means that
 * without this, pushing two rooms together is a decision you can only take
 * back with ctrl-Z, and only until the session ends. An editor whose most
 * satisfying operation is also a trap is not one to trust with a plan of your
 * house.
 *
 * The move is the obvious one: give the room its own copy of every wall it was
 * sharing, take away the walls that were only ever its, and stand the whole
 * thing clear. The neighbour is left exactly as it was — it keeps the shared
 * wall, and any door in that wall stays in it, because the door was in the
 * wall and the wall did not move.
 */

import { boundingBox, centroid, containsPoint } from '../geometry/polygon.ts';
import { type Vec2 } from '../geometry/vec2.ts';
import { type Mm } from '../units/length.ts';
import {
  allWalls,
  createIdAllocator,
  pruneOrphanNodes,
  type GraphNode,
  type GraphWall,
  type NodeId,
  type WallId,
} from '../graph/wallGraph.ts';
import { type RoomId } from '../graph/roomIdentity.ts';
import { planRoomMove } from './moveRoom.ts';
import { roomsOf, type DerivedRoom } from './derive.ts';
import { type Floor } from './schema.ts';

/** How far a separated room is stood clear of what it was attached to. */
export const SEPARATION_GAP: Mm = 1000;

/**
 * Does this room share any of its walls with another?
 *
 * What the Separate button is shown by. A room with nothing to separate from
 * should not be offered the choice.
 */
export function sharesWall(floor: Floor, roomId: RoomId): boolean {
  const rooms = roomsOf(floor);
  const room = rooms.find((entry) => entry.props.id === roomId);
  if (!room) return false;

  return room.face.wallIds.some((wallId) => countFaces(rooms, wallId) > 1);
}

/**
 * Detach a room from its neighbours and stand it clear.
 *
 * Returns the floor unchanged when the room is already free-standing, so the
 * action is safe to run on anything.
 */
export function separateRoom(floor: Floor, roomId: RoomId, gap: Mm = SEPARATION_GAP): Floor {
  const rooms = roomsOf(floor);
  const room = rooms.find((entry) => entry.props.id === roomId);
  if (!room || !sharesWall(floor, roomId)) return floor;

  const ring = new Set(room.face.wallIds);
  const shared = new Set(room.face.wallIds.filter((id) => countFaces(rooms, id) > 1));

  const step = clearanceStep(floor, room, gap);
  const allocator = createIdAllocator(floor.graph);

  // A fresh corner for every corner of the room, standing where the room is
  // going rather than where it was.
  const nodeFor = new Map<NodeId, NodeId>();
  const nodes: Record<NodeId, GraphNode> = { ...floor.graph.nodes };

  for (const nodeId of room.face.nodeIds) {
    const original = floor.graph.nodes[nodeId];
    if (!original || nodeFor.has(nodeId)) continue;

    const id = allocator.node();
    nodeFor.set(nodeId, id);
    nodes[id] = { id, x: original.x + step.x, y: original.y + step.y };
  }

  // Every wall of the ring is rebuilt for the room, in the same direction as
  // the one it replaces — which is what lets a door keep its distance along it
  // without any arithmetic.
  const walls: Record<WallId, GraphWall> = { ...floor.graph.walls };
  const replacement = new Map<WallId, WallId>();

  for (const wallId of ring) {
    const wall = floor.graph.walls[wallId];
    const a = wall && nodeFor.get(wall.a);
    const b = wall && nodeFor.get(wall.b);
    if (!wall || a === undefined || b === undefined) continue;

    const id = allocator.wall();
    walls[id] = { id, a, b, thickness: wall.thickness, kind: wall.kind };
    replacement.set(wallId, id);

    // A wall that was only ever this room's goes with it. A shared one stays
    // where it is, because the room on the other side is still using it.
    if (!shared.has(wallId)) delete walls[wallId];
  }

  const move = planRoomMove(floor, roomId);
  const carried = new Set(move?.itemIds ?? []);

  // Items belong to whichever room they stand in, and a move that took the
  // whole structure would have taken the neighbour's furniture too — so only
  // the ones in this room travel.
  const inThisRoom = new Set(
    floor.items.filter((item) => carried.has(item.id) && holds(room, item)).map((item) => item.id),
  );

  return {
    ...floor,
    graph: pruneOrphanNodes({ nodes, walls }),
    rooms: floor.rooms.map((entry) =>
      entry.id === roomId
        ? { ...entry, anchor: { x: entry.anchor.x + step.x, y: entry.anchor.y + step.y } }
        : entry,
    ),
    openings: floor.openings.map((opening) => {
      const moved = replacement.get(opening.wallId);
      // Only the walls that left; a door in a shared wall stays in the wall,
      // and the wall stays with the neighbour.
      return moved !== undefined && !shared.has(opening.wallId)
        ? { ...opening, wallId: moved }
        : opening;
    }),
    items: floor.items.map((item) =>
      inThisRoom.has(item.id) ? { ...item, x: item.x + step.x, y: item.y + step.y } : item,
    ),
  };
}

/** How many rooms have this wall on their boundary. */
function countFaces(rooms: readonly DerivedRoom[], wallId: WallId): number {
  return rooms.filter((room) => room.face.wallIds.includes(wallId)).length;
}

/**
 * Which way to stand the room, and how far.
 *
 * Away from whatever it was attached to, along whichever axis it is already
 * furthest out on, and far enough that the two no longer touch anywhere. Any
 * fixed direction would sooner or later push a room straight through its
 * neighbour, which would look like the operation had failed.
 */
function clearanceStep(floor: Floor, room: DerivedRoom, gap: Mm): Vec2 {
  const mine = new Set(room.face.nodeIds);

  const roomPoints = room.face.polygon;
  const otherPoints = allWalls(floor.graph)
    .filter((wall) => !mine.has(wall.a) || !mine.has(wall.b))
    .flatMap((wall) => [floor.graph.nodes[wall.a], floor.graph.nodes[wall.b]])
    .filter((node): node is GraphNode => node !== undefined)
    .map((node) => ({ x: node.x, y: node.y }));

  if (otherPoints.length === 0) return { x: 0, y: gap };

  const here = centroid(roomPoints);
  const there = centroid(otherPoints);
  const mineBox = boundingBox(roomPoints);
  const restBox = boundingBox(otherPoints);

  const away = { x: here.x - there.x, y: here.y - there.y };

  // The axis it is already further out on is the one with the least in the way.
  if (Math.abs(away.x) >= Math.abs(away.y)) {
    return {
      x: away.x >= 0 ? restBox.maxX + gap - mineBox.minX : restBox.minX - gap - mineBox.maxX,
      y: 0,
    };
  }

  return {
    x: 0,
    y: away.y >= 0 ? restBox.maxY + gap - mineBox.minY : restBox.minY - gap - mineBox.maxY,
  };
}

/** Is this item standing in this one room? Measured as `moveRoom` measures it. */
function holds(room: DerivedRoom, item: { readonly x: number; readonly y: number }): boolean {
  const point = { x: item.x, y: item.y };
  if (!containsPoint(room.face.polygon, point)) return false;
  return !room.face.holes.some((hole) => containsPoint(hole, point));
}
