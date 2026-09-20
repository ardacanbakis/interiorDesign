/**
 * Picking a room up and putting it down somewhere else.
 *
 * Harder than it sounds, because a room is not a thing the document contains.
 * It is a face of the wall graph, so "move the room" has to become "move these
 * walls", and everything that was standing in it has to come too — otherwise
 * you drag a bedroom two metres and leave the bed behind in the garden.
 *
 * ## What comes with it
 *
 * **The whole connected structure.** Two rooms sharing a wall are one piece of
 * building; moving one of them while the other stays put would mean stretching
 * the wall between them, which is a different operation and already has a
 * handle on it. So dragging either moves both, the way picking up a model of a
 * flat would.
 *
 * **The furniture standing in it**, by where it is rather than by any stored
 * link. Items have no room id — which room a wardrobe is in is a question about
 * where it is, and the moment one is stored it can disagree with the plan.
 *
 * **The room anchors.** Room names and types are held against a point known to
 * be inside the room (see `roomIdentity.ts`). Move the walls and leave the
 * anchor behind and the room is no longer the room it was — it would come back
 * unnamed, with a fresh id, and the muted warnings about it would come back
 * too. This is the one that is invisible until it goes wrong.
 *
 * **The doors and windows**, for free. An opening is stored as a distance along
 * its wall, so moving the wall moves the opening — which is exactly why it is
 * stored that way.
 *
 * ## What does not happen
 *
 * The graph is translated, not rebuilt, so a room pushed up against another one
 * ends up with its wall lying on top of the neighbour's rather than merging
 * into a single shared wall. That is the same thing dragging a corner does, and
 * joining two structures into one is a larger operation than moving one: it has
 * to re-planarise the graph, which hands out new wall ids and would take the
 * doors off the walls they are in.
 */

import { containsPoint } from '../geometry/polygon.ts';
import { type Vec2 } from '../geometry/vec2.ts';
import { roundMm } from '../units/length.ts';
import { connectedNodes, type NodeId } from '../graph/wallGraph.ts';
import { type RoomId } from '../graph/roomIdentity.ts';
import { roomsOf, type DerivedRoom } from './derive.ts';
import { type Floor, type ItemId } from './schema.ts';

/** What a move would take with it. Worked out before anything is changed. */
export interface RoomMove {
  /** Corners of the wall graph that will be translated. */
  readonly nodeIds: ReadonlySet<NodeId>;
  /** Rooms carried along — the one grabbed, and anything joined to it. */
  readonly roomIds: readonly RoomId[];
  /** Furniture standing in any of those rooms. */
  readonly itemIds: readonly ItemId[];
}

/**
 * Work out what moving a room would take with it.
 *
 * Separate from doing it so the answer can be shown before the drag commits,
 * and so the rule about what travels is one testable thing rather than a
 * condition buried in a loop.
 */
export function planRoomMove(floor: Floor, roomId: RoomId): RoomMove | null {
  const rooms = roomsOf(floor);
  const grabbed = rooms.find((room) => room.props.id === roomId);
  if (!grabbed) return null;

  const seed = grabbed.face.nodeIds[0];
  if (seed === undefined) return null;

  const nodeIds = connectedNodes(floor.graph, seed);
  if (nodeIds.size === 0) return null;

  const carried = rooms.filter((room) => room.face.nodeIds.some((id) => nodeIds.has(id)));

  const itemIds = floor.items
    .filter((item) => carried.some((room) => holds(room, item)))
    .map((item) => item.id);

  return { nodeIds, roomIds: carried.map((room) => room.props.id), itemIds };
}

/**
 * Move a room by a distance, with everything that belongs to it.
 *
 * Returns the floor unchanged — the same object — when the move would do
 * nothing, so that a drag which goes nowhere does not mark the plan as edited.
 */
export function moveRoomBy(floor: Floor, roomId: RoomId, delta: Vec2): Floor {
  const step = { x: roundMm(delta.x), y: roundMm(delta.y) };
  if (step.x === 0 && step.y === 0) return floor;

  const move = planRoomMove(floor, roomId);
  if (!move) return floor;

  const moved = new Set(move.roomIds);
  const movedItems = new Set(move.itemIds);

  const nodes = Object.fromEntries(
    Object.entries(floor.graph.nodes).map(([id, node]) => [
      id,
      move.nodeIds.has(id) ? { ...node, x: node.x + step.x, y: node.y + step.y } : node,
    ]),
  );

  return {
    ...floor,
    graph: { nodes, walls: floor.graph.walls },
    rooms: floor.rooms.map((room) =>
      moved.has(room.id)
        ? { ...room, anchor: { x: room.anchor.x + step.x, y: room.anchor.y + step.y } }
        : room,
    ),
    items: floor.items.map((item) =>
      movedItems.has(item.id) ? { ...item, x: item.x + step.x, y: item.y + step.y } : item,
    ),
  };
}

/**
 * Is this item standing in this room?
 *
 * Measured against the face — the polygon through the wall centrelines —
 * rather than the usable floor, so that a radiator or a television fixed to the
 * inside of a wall counts as being in the room it faces rather than as being
 * in no room at all.
 */
function holds(room: DerivedRoom, item: { readonly x: number; readonly y: number }): boolean {
  const point = { x: item.x, y: item.y };
  if (!containsPoint(room.face.polygon, point)) return false;
  return !room.face.holes.some((hole) => containsPoint(hole, point));
}
