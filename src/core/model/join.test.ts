/**
 * Two rooms becoming one house.
 *
 * The whole path, as the editor runs it: work out where the drag should land,
 * move the room there, weld what is now in the same place, and put the result
 * on the floor with its doors still attached. Each piece has its own tests;
 * this is the one that says they add up to the thing the user asked for.
 *
 * The claim being checked is not that the walls line up. It is that after the
 * join there is **one** wall between the two rooms, that each room's floor area
 * is what sharing that wall implies, and that a door in it still works — which
 * is the difference between a house and two boxes drawn next to each other.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { allWalls, graphFromSegments, rectangleSegments } from '../graph/wallGraph.ts';
import { weld } from '../graph/weld.ts';
import { openingFrame } from '../openings/geometry.ts';
import { createFloor } from './document.ts';
import { reconcileFloor, roomsOf } from './derive.ts';
import { applyWeld } from './edits.ts';
import { alignRoomStep, moveRoomBy, planRoomMove } from './moveRoom.ts';
import { type Floor, type Opening } from './schema.ts';

/**
 * Two 4m × 3m rooms on 200mm walls, a metre apart — which is where the "Add
 * room" button puts the second one.
 */
function twoRooms(): Floor {
  return reconcileFloor({
    ...createFloor('f1', 0, 'Ground floor'),
    graph: graphFromSegments(
      [
        ...rectangleSegments(0, 0, 4200, 3200, 'exterior'),
        ...rectangleSegments(5200, 0, 4200, 3200, 'exterior'),
      ].map((segment) => ({ ...segment, thickness: 200 })),
    ),
  });
}

let floor: Floor;

beforeEach(() => {
  floor = twoRooms();
});

function leftRoom() {
  return roomsOf(floor).find((room) => room.geometry.interiorPoint.x < 5000)!;
}

function rightRoom() {
  return roomsOf(floor).find((room) => room.geometry.interiorPoint.x > 5000)!;
}

/** The gap to close: the right room's left wall is 1000 from the left room's right wall. */
const GAP = 1000;

/** Drag the right room left until it meets the left one, then join. */
function pushTogether(overshoot = 0) {
  const room = rightRoom().props.id;
  const move = planRoomMove(floor, room)!;

  // What the pointer asked for, deliberately not exact — landing a drag on the
  // millimetre is the thing the snapping exists to make unnecessary.
  const asked = { x: -GAP + overshoot, y: 0 };
  const snapped = alignRoomStep(floor, move, asked, 200);

  floor = moveRoomBy(floor, room, snapped.step);
  floor = reconcileFloor(applyWeld(floor, weld(floor.graph)).floor);
}

// ---------------------------------------------------------------------------

describe('before they are joined', () => {
  it('has two rooms and eight walls', () => {
    expect(roomsOf(floor)).toHaveLength(2);
    expect(allWalls(floor.graph)).toHaveLength(8);
  });
});

describe('pushing one room against the other', () => {
  it('lands exactly on the wall even when the drag is a few millimetres out', () => {
    const move = planRoomMove(floor, rightRoom().props.id)!;
    const snapped = alignRoomStep(floor, move, { x: -GAP + 37, y: 0 }, 200);

    expect(snapped.step.x).toBe(-GAP);
  });

  it('draws a guide along the line it locked onto', () => {
    const move = planRoomMove(floor, rightRoom().props.id)!;
    const snapped = alignRoomStep(floor, move, { x: -GAP + 37, y: 0 }, 200);

    expect(snapped.guides.length).toBeGreaterThan(0);
    expect(snapped.guides[0]!.from.x).toBe(4200);
  });

  it('leaves the step alone when there is nothing within reach', () => {
    const move = planRoomMove(floor, rightRoom().props.id)!;
    expect(alignRoomStep(floor, move, { x: -400, y: 0 }, 200).step).toEqual({ x: -400, y: 0 });
  });

  it('leaves them sharing exactly one wall', () => {
    pushTogether(37);

    expect(roomsOf(floor)).toHaveLength(2);
    // Eight walls become seven.
    expect(allWalls(floor.graph)).toHaveLength(7);
  });

  it('makes them one structure, so dragging either moves both', () => {
    pushTogether();

    const move = planRoomMove(floor, leftRoom().props.id)!;
    expect(move.roomIds).toHaveLength(2);
  });

  it('gives each room the floor area that sharing a wall implies', () => {
    // 4200 × 3200 centrelines on 200mm walls: 4000 × 3000 of usable floor,
    // and it stays that way, because the wall they now share is the same
    // thickness each of them was already giving up half of.
    pushTogether();

    for (const room of roomsOf(floor)) {
      expect(room.geometry.area).toBe(4000 * 3000);
    }
  });

  it('keeps both rooms their own name and id', () => {
    floor = {
      ...floor,
      rooms: floor.rooms.map((room, index) => ({
        ...room,
        name: index === 0 ? 'Salon' : 'Mutfak',
      })),
    };
    const before = floor.rooms.map((room) => `${room.id}:${room.name}`).sort();

    pushTogether();

    expect(floor.rooms.map((room) => `${room.id}:${room.name}`).sort()).toEqual(before);
  });
});

describe('a door in the wall they share', () => {
  /** A door in the right room's left wall — the one that is about to be merged. */
  function addDoor(): Opening {
    const wall = allWalls(floor.graph).find((entry) => {
      const a = floor.graph.nodes[entry.a]!;
      const b = floor.graph.nodes[entry.b]!;
      return a.x === 5200 && b.x === 5200;
    })!;

    const door: Opening = {
      id: 'o1',
      kind: 'door',
      label: 'Door',
      wallId: wall.id,
      offset: 1000,
      width: 800,
      height: 2050,
      sillHeight: 0,
      hinge: 'a',
      side: 'right',
      openAmount: 0,
    };

    floor = { ...floor, openings: [door] };
    return door;
  }

  it('survives the merge', () => {
    addDoor();
    pushTogether();

    expect(floor.openings).toHaveLength(1);
    expect(floor.graph.walls[floor.openings[0]!.wallId]).toBeDefined();
  });

  it('is still in the same place on the wall, in the world', () => {
    // The wall it was on may be gone and the survivor may run the other way.
    // What has to hold is that the door has not moved.
    const door = addDoor();
    const wall = floor.graph.walls[door.wallId]!;
    const before = openingFrame(floor.graph, wall, door).centre;

    pushTogether();

    const after = floor.openings[0]!;
    const centre = openingFrame(floor.graph, floor.graph.walls[after.wallId]!, after).centre;

    expect(centre.x).toBe(before.x - GAP);
    expect(centre.y).toBe(before.y);
  });

  it('still opens the way it did', () => {
    // Hinge and side are measured from the wall's own direction, so a door
    // moved onto a wall pointing the other way has to have both turned round
    // or it swings into the wrong room.
    const door = addDoor();
    const wall = floor.graph.walls[door.wallId]!;
    const before = openingFrame(floor.graph, wall, door);

    pushTogether();

    const after = floor.openings[0]!;
    const frame = openingFrame(floor.graph, floor.graph.walls[after.wallId]!, after);

    // The hinge end of the opening is where it was, a metre to the left.
    const hingeBefore = door.hinge === 'a' ? before.startPoint : before.endPoint;
    const hingeAfter = after.hinge === 'a' ? frame.startPoint : frame.endPoint;

    expect(hingeAfter.x).toBeCloseTo(hingeBefore.x - GAP, 6);
    expect(hingeAfter.y).toBeCloseTo(hingeBefore.y, 6);
  });
});

describe('furniture in the rooms', () => {
  it('comes along and stays where it was put, relative to its room', () => {
    floor = {
      ...floor,
      items: [
        {
          id: 'i1',
          kind: 'wardrobe',
          label: 'Wardrobe',
          x: 6000,
          y: 400,
          rotation: 0,
          width: 1200,
          depth: 600,
          height: 2200,
          elevation: 0,
          mount: 'floor',
          params: {},
        },
      ],
    };

    pushTogether();

    expect(floor.items[0]).toMatchObject({ x: 6000 - GAP, y: 400 });
  });
});
