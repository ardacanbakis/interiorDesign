/**
 * Everything the app reads but never stores.
 *
 * Rooms, their usable floor area, and which room a given point is in are all
 * computed from the wall graph rather than kept alongside it. That is what
 * stops the document from being able to contradict itself — there is no room
 * list that can fall out of step with the walls, because there is no room list.
 *
 * The cost is that face extraction would otherwise run on every render. Graphs
 * are immutable and replaced wholesale when edited, so the results are cached
 * against the graph object itself: a render that changes no walls does no work,
 * and a graph that is edited cannot serve a stale answer because it is a
 * different object.
 */

import { extractFaces, type Face } from '../graph/faces.ts';
import { roomGeometry, type RoomGeometry } from '../graph/roomGeometry.ts';
import { reconcileRooms, type Room, type RoomProps } from '../graph/roomIdentity.ts';
import { containsPoint } from '../geometry/polygon.ts';
import { type Vec2 } from '../geometry/vec2.ts';
import { type WallGraph } from '../graph/wallGraph.ts';
import { pruneOrphanedOpenings } from './edits.ts';
import { type Floor } from './schema.ts';

const facesCache = new WeakMap<WallGraph, Face[]>();
const geometryCache = new WeakMap<Face, RoomGeometry>();

/** Faces of a graph, computed once per graph. */
export function facesOf(graph: WallGraph): Face[] {
  const cached = facesCache.get(graph);
  if (cached) return cached;

  const faces = extractFaces(graph);
  facesCache.set(graph, faces);
  return faces;
}

/** A face's usable floor, computed once per face. */
export function geometryOf(graph: WallGraph, face: Face): RoomGeometry {
  const cached = geometryCache.get(face);
  if (cached) return cached;

  const geometry = roomGeometry(graph, face);
  geometryCache.set(face, geometry);
  return geometry;
}

/** A room, its face, and the floor it encloses. */
export interface DerivedRoom extends Room {
  readonly geometry: RoomGeometry;
}

/**
 * The rooms on a floor, matched to the stored room data.
 *
 * Read-only: this reports what the floor currently contains without changing
 * it. Persisting the match — so that a renamed room stays renamed — is
 * {@link reconcileFloor}'s job, and happens as part of the edit that moved the
 * walls.
 */
export function roomsOf(floor: Floor): DerivedRoom[] {
  const faces = facesOf(floor.graph);
  const { rooms } = reconcileRooms(faces, floor.rooms);

  return rooms.map((room) => ({
    ...room,
    geometry: geometryOf(floor.graph, room.face),
  }));
}

/**
 * Bring a floor's stored room data back in line with its walls.
 *
 * Returns the same floor object when nothing needs to change, so that running
 * this after every edit does not mark the document as modified when it was not.
 * Without that, opening a plan and clicking around would leave it looking
 * unsaved.
 */
export function reconcileFloor(floor: Floor): Floor {
  // Openings first: an opening whose wall has been deleted would throw the
  // moment anything tried to draw it.
  const pruned = pruneOrphanedOpenings(floor);

  const { props } = reconcileRooms(facesOf(pruned.graph), pruned.rooms);
  return roomPropsEqual(props, pruned.rooms) ? pruned : { ...pruned, rooms: [...props] };
}

function roomPropsEqual(left: readonly RoomProps[], right: readonly RoomProps[]): boolean {
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index++) {
    const a = left[index]!;
    const b = right[index]!;
    if (
      a.id !== b.id ||
      a.name !== b.name ||
      a.type !== b.type ||
      a.lastArea !== b.lastArea ||
      a.anchor.x !== b.anchor.x ||
      a.anchor.y !== b.anchor.y
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Which room a point falls in, or null for a point in a wall or outside the
 * plan. Used to work out which room an item has been dropped into.
 */
export function roomAt(floor: Floor, point: Vec2): DerivedRoom | null {
  // Smallest first, so a room inside another claims the point.
  const candidates = [...roomsOf(floor)].sort((a, b) => a.face.area - b.face.area);

  for (const room of candidates) {
    if (!containsPoint(room.geometry.outline, point)) continue;
    if (room.geometry.holes.some((hole) => containsPoint(hole, point))) continue;
    return room;
  }

  return null;
}

/** Total usable floor area across every room on a floor. */
export function floorArea(floor: Floor): number {
  return roomsOf(floor).reduce((total, room) => total + room.geometry.area, 0);
}
