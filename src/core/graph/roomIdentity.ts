/**
 * Persistent room identity across graph edits.
 *
 * Rooms are derived from the wall graph, so they have no inherent identity —
 * each edit produces a fresh set of faces with no memory of the last one. But a
 * room has things attached to it that must survive: its name, what it is for,
 * eventually its furniture. Something has to decide that *this* new face is the
 * same room the user called "Yatak Odası" a moment ago.
 *
 * ## Anchors, not indices
 *
 * Each room's data is stored against an **anchor point** — a coordinate known
 * to be inside it. After every edit the faces are re-extracted and each set of
 * room data is matched to whichever face now contains its anchor.
 *
 * That single rule gives the right behaviour for the two edits that would
 * otherwise be hardest:
 *
 * - **Splitting.** Draw a wall across a bedroom and it becomes two faces. The
 *   old anchor is inside exactly one of them, so that half keeps the name and
 *   the other appears as a new, unnamed room. No prompt, no guessing.
 * - **Merging.** Delete the wall and two anchors land in one face. The larger
 *   of the two rooms wins, which is what people expect: knock through between a
 *   living room and a store cupboard and you have a living room.
 *
 * Indices could not do this — face order changes for reasons that have nothing
 * to do with which room is which — and neither could ids derived from the
 * bounding walls, since those change whenever a wall is split.
 */

import { containsPoint, distanceToBoundary } from '../geometry/polygon.ts';
import { distance, type Vec2 } from '../geometry/vec2.ts';
import { type Mm2 } from '../units/length.ts';
import { type Face } from './faces.ts';

export type RoomId = string;

/**
 * What a room is for. Drives the default name, which fixtures the catalogue
 * offers first, and which clearance rules apply.
 */
export type RoomType =
  | 'bedroom'
  | 'living'
  | 'kitchen'
  | 'dining'
  | 'bathroom'
  | 'wc'
  | 'hall'
  | 'corridor'
  | 'office'
  | 'utility'
  | 'storage'
  | 'garage'
  | 'stairwell'
  | 'balcony'
  | 'terrace'
  | 'garden'
  | 'other';

export const ROOM_TYPES: readonly RoomType[] = [
  'bedroom',
  'living',
  'kitchen',
  'dining',
  'bathroom',
  'wc',
  'hall',
  'corridor',
  'office',
  'utility',
  'storage',
  'garage',
  'stairwell',
  'balcony',
  'terrace',
  'garden',
  'other',
];

/** Room data that persists, independent of the faces it is matched to. */
export interface RoomProps {
  readonly id: RoomId;
  /** A point inside the room. Refreshed after each reconcile. */
  readonly anchor: Vec2;
  readonly name: string;
  readonly type: RoomType;
  /**
   * The room's area at the last reconcile.
   *
   * A cache, not user data: it exists so that when two rooms merge, the larger
   * one's name can be the one that survives. Refreshed on every reconcile.
   */
  readonly lastArea: Mm2;
}

/** A face paired with the room data that belongs to it. */
export interface Room {
  readonly props: RoomProps;
  readonly face: Face;
}

export interface ReconcileResult {
  /** The rooms that now exist, in face order (largest first). */
  readonly rooms: readonly Room[];
  /** The room data to persist, with anchors and areas refreshed. */
  readonly props: readonly RoomProps[];
  /** Rooms that no longer exist — their walls were removed. */
  readonly removed: readonly RoomProps[];
  /** Ids of rooms that appeared in this edit. */
  readonly created: readonly RoomId[];
}

export interface ReconcileOptions {
  /** Names for newly discovered rooms. Defaults to "Room 1", "Room 2", … */
  readonly nameNewRoom?: (ordinal: number) => string;
}

/**
 * Match room data onto the current set of faces.
 *
 * Runs in three passes:
 *
 *   1. Claim by containment — each room takes the face holding its anchor.
 *      Where two rooms claim the same face they have merged, and the larger
 *      one wins.
 *   2. Rescue by proximity — a room whose anchor ended up outside every face
 *      (dragging a wall past it, or a split that landed the anchor exactly on
 *      the new wall) takes the nearest unclaimed face.
 *   3. Anything still unclaimed is a new room; anything still unmatched is a
 *      room that has ceased to exist.
 */
export function reconcileRooms(
  faces: readonly Face[],
  existing: readonly RoomProps[],
  options: ReconcileOptions = {},
): ReconcileResult {
  const nameNewRoom = options.nameNewRoom ?? ((ordinal: number) => `Room ${ordinal}`);

  const claimedBy = new Map<number, RoomProps>();
  const unmatched: RoomProps[] = [];

  // Pass 1 — containment.
  for (const props of existing) {
    const index = faces.findIndex((face) => isInsideFace(face, props.anchor));

    if (index < 0) {
      unmatched.push(props);
      continue;
    }

    const incumbent = claimedBy.get(index);
    if (!incumbent) {
      claimedBy.set(index, props);
      continue;
    }

    // Two rooms in one face: they have been merged. The bigger room's name is
    // the one worth keeping.
    const winner = props.lastArea > incumbent.lastArea ? props : incumbent;
    const loser = winner === props ? incumbent : props;
    claimedBy.set(index, winner);
    unmatched.push(loser);
  }

  // Pass 2 — proximity, for anchors that fell outside every face.
  const stillUnmatched: RoomProps[] = [];
  for (const props of unmatched) {
    const index = nearestUnclaimedFace(faces, claimedBy, props.anchor);
    if (index === null) {
      stillUnmatched.push(props);
      continue;
    }
    claimedBy.set(index, props);
  }

  // Pass 3 — assemble, naming whatever is left over.
  let nextOrdinal = highestRoomOrdinal(existing) + 1;
  let nextId = highestIdSuffix(existing) + 1;

  const rooms: Room[] = [];
  const created: RoomId[] = [];

  faces.forEach((face, index) => {
    const claimed = claimedBy.get(index);

    if (claimed) {
      rooms.push({
        face,
        props: { ...claimed, anchor: face.interiorPoint, lastArea: face.area },
      });
      return;
    }

    const id = `r${nextId++}`;
    created.push(id);
    rooms.push({
      face,
      props: {
        id,
        anchor: face.interiorPoint,
        name: nameNewRoom(nextOrdinal++),
        type: 'other',
        lastArea: face.area,
      },
    });
  });

  return {
    rooms,
    props: rooms.map((room) => room.props),
    removed: stillUnmatched,
    created,
  };
}

/**
 * Inside the face, and not inside one of its holes.
 *
 * Without the hole check, a room whose anchor happened to sit where a column
 * was later built would keep claiming a spot it no longer occupies.
 */
function isInsideFace(face: Face, point: Vec2): boolean {
  if (!containsPoint(face.polygon, point)) return false;
  return !face.holes.some((hole) => containsPoint(hole, point));
}

/**
 * The unclaimed face nearest to a point.
 *
 * Distance is measured to the face's interior point, with the room's own
 * boundary distance as a tiebreak, so an exact tie — a room split perfectly
 * down the middle — resolves the same way every time rather than by
 * floating-point luck.
 */
function nearestUnclaimedFace(
  faces: readonly Face[],
  claimedBy: ReadonlyMap<number, RoomProps>,
  point: Vec2,
): number | null {
  let bestIndex: number | null = null;
  let bestDistance = Infinity;
  let bestDepth = -Infinity;

  faces.forEach((face, index) => {
    if (claimedBy.has(index)) return;

    const d = distance(point, face.interiorPoint);
    const depth = distanceToBoundary(face.polygon, face.interiorPoint);

    if (d < bestDistance || (d === bestDistance && depth > bestDepth)) {
      bestIndex = index;
      bestDistance = d;
      bestDepth = depth;
    }
  });

  return bestIndex;
}

function highestIdSuffix(rooms: readonly RoomProps[]): number {
  let highest = 0;
  for (const room of rooms) {
    if (!room.id.startsWith('r')) continue;
    const suffix = Number(room.id.slice(1));
    if (Number.isInteger(suffix) && suffix > highest) highest = suffix;
  }
  return highest;
}

/**
 * The highest "Room N" already in use, so new rooms carry on from there rather
 * than reusing a number that is still on screen.
 */
function highestRoomOrdinal(rooms: readonly RoomProps[]): number {
  let highest = 0;
  for (const room of rooms) {
    const match = /^Room (\d+)$/.exec(room.name);
    if (!match) continue;
    const ordinal = Number(match[1]);
    if (Number.isInteger(ordinal) && ordinal > highest) highest = ordinal;
  }
  return highest;
}
