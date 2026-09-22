/**
 * Taking a room back out of the house.
 *
 * The inverse of joining, and the thing that makes joining safe to try. What
 * has to hold afterwards is that both rooms are still rooms — the one taken
 * out, and the one it was taken out of, which must not be left with a gap
 * where its wall used to be.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { allWalls, graphFromSegments, rectangleSegments } from '../graph/wallGraph.ts';
import { weld } from '../graph/weld.ts';
import { createItem } from '../catalog/registry.ts';
import { createFloor } from './document.ts';
import { reconcileFloor, roomsOf } from './derive.ts';
import { applyWeld } from './edits.ts';
import { separateRoom, sharesWall } from './separateRoom.ts';
import { type Floor, type Opening } from './schema.ts';

/** Two 4m × 3m rooms side by side, already welded into one structure. */
function joinedPair(): Floor {
  const floor = reconcileFloor({
    ...createFloor('f1', 0, 'Ground floor'),
    graph: graphFromSegments(
      [
        ...rectangleSegments(0, 0, 4200, 3200, 'exterior'),
        ...rectangleSegments(4200, 0, 4200, 3200, 'exterior'),
      ].map((segment) => ({ ...segment, thickness: 200 })),
    ),
  });

  return reconcileFloor(applyWeld(floor, weld(floor.graph)).floor);
}

let floor: Floor;

beforeEach(() => {
  floor = joinedPair();
});

function left() {
  return roomsOf(floor).find((room) => room.geometry.interiorPoint.x < 4200)!;
}

function right() {
  return roomsOf(floor).find((room) => room.geometry.interiorPoint.x > 4200)!;
}

function place(kind: string, x: number, y: number) {
  const item = createItem(kind, `i${floor.items.length + 1}`, x, y);
  floor = { ...floor, items: [...floor.items, item] };
  return item;
}

// ---------------------------------------------------------------------------

describe('the fixture', () => {
  it('is two rooms sharing one wall', () => {
    expect(roomsOf(floor)).toHaveLength(2);
    expect(allWalls(floor.graph)).toHaveLength(7);
  });
});

describe('knowing whether there is anything to separate', () => {
  it('says yes for a room that shares a wall', () => {
    expect(sharesWall(floor, left().props.id)).toBe(true);
  });

  it('says no for a room standing on its own', () => {
    const alone = reconcileFloor({
      ...createFloor('f2', 0, 'Ground floor'),
      graph: graphFromSegments(rectangleSegments(0, 0, 4200, 3200, 'exterior')),
    });

    expect(sharesWall(alone, alone.rooms[0]!.id)).toBe(false);
  });

  it('says no for a room that is not there', () => {
    expect(sharesWall(floor, 'nope')).toBe(false);
  });
});

describe('separating a room', () => {
  it('leaves two rooms, both still closed', () => {
    floor = reconcileFloor(separateRoom(floor, right().props.id));
    expect(roomsOf(floor)).toHaveLength(2);
  });

  it('gives the room its own copy of the wall it was sharing', () => {
    // Seven walls become eight: the shared one stays with the neighbour, and
    // the room that left has a new one of its own.
    floor = reconcileFloor(separateRoom(floor, right().props.id));
    expect(allWalls(floor.graph)).toHaveLength(8);
  });

  it('stands it clear, so the two no longer touch', () => {
    floor = reconcileFloor(separateRoom(floor, right().props.id));

    const gap =
      Math.min(...right().face.polygon.map((point) => point.x)) -
      Math.max(...left().face.polygon.map((point) => point.x));

    expect(gap).toBeGreaterThanOrEqual(1000);
  });

  it('makes them two structures again, so each moves on its own', () => {
    floor = reconcileFloor(separateRoom(floor, right().props.id));

    // Which is the point of the whole operation.
    expect(sharesWall(floor, left().props.id)).toBe(false);
    expect(sharesWall(floor, right().props.id)).toBe(false);
  });

  it('leaves both rooms exactly the size they were', () => {
    const before = roomsOf(floor)
      .map((room) => room.geometry.area)
      .sort();

    floor = reconcileFloor(separateRoom(floor, right().props.id));

    expect(
      roomsOf(floor)
        .map((room) => room.geometry.area)
        .sort(),
    ).toEqual(before);
  });

  it('keeps both rooms their name and id', () => {
    floor = {
      ...floor,
      rooms: floor.rooms.map((room, index) => ({
        ...room,
        name: index === 0 ? 'Salon' : 'Mutfak',
      })),
    };
    const before = floor.rooms.map((room) => `${room.id}:${room.name}`).sort();

    floor = reconcileFloor(separateRoom(floor, right().props.id));

    expect(floor.rooms.map((room) => `${room.id}:${room.name}`).sort()).toEqual(before);
  });

  it('does nothing to a room that is already on its own', () => {
    const alone = reconcileFloor({
      ...createFloor('f2', 0, 'Ground floor'),
      graph: graphFromSegments(rectangleSegments(0, 0, 4200, 3200, 'exterior')),
    });

    expect(separateRoom(alone, alone.rooms[0]!.id)).toBe(alone);
  });

  it('does nothing for a room that is not there', () => {
    expect(separateRoom(floor, 'nope')).toBe(floor);
  });
});

describe('what goes with it and what stays', () => {
  it('takes the furniture in the room that left', () => {
    const wardrobe = place('wardrobe', 6000, 1600);

    floor = reconcileFloor(separateRoom(floor, right().props.id));

    expect(floor.items[0]!.x).toBeGreaterThan(wardrobe.x);
  });

  it("leaves the neighbour's furniture where it is", () => {
    const sofa = place('sofa-3', 2000, 1600);

    floor = reconcileFloor(separateRoom(floor, right().props.id));

    expect(floor.items[0]).toMatchObject({ id: sofa.id, x: 2000, y: 1600 });
  });

  it("takes a door in a wall that was only ever the room's own", () => {
    const wall = allWalls(floor.graph).find((entry) => {
      const a = floor.graph.nodes[entry.a]!;
      const b = floor.graph.nodes[entry.b]!;
      return a.x === 8400 && b.x === 8400;
    })!;

    const door: Opening = {
      id: 'o1',
      kind: 'door',
      label: 'Door',
      wallId: wall.id,
      offset: 1600,
      width: 800,
      height: 2050,
      sillHeight: 0,
      hinge: 'a',
      side: 'right',
      openAmount: 0,
    };
    floor = { ...floor, openings: [door] };

    floor = reconcileFloor(separateRoom(floor, right().props.id));

    // On a different wall now, but still on one that exists, and still the
    // same distance along it.
    expect(floor.openings[0]!.wallId).not.toBe(wall.id);
    expect(floor.graph.walls[floor.openings[0]!.wallId]).toBeDefined();
    expect(floor.openings[0]!.offset).toBe(1600);
  });

  it('leaves a door in the shared wall with the room that kept it', () => {
    const shared = allWalls(floor.graph).find((entry) => {
      const a = floor.graph.nodes[entry.a]!;
      const b = floor.graph.nodes[entry.b]!;
      return a.x === 4200 && b.x === 4200;
    })!;

    floor = {
      ...floor,
      openings: [
        {
          id: 'o1',
          kind: 'door',
          label: 'Door',
          wallId: shared.id,
          offset: 1600,
          width: 800,
          height: 2050,
          sillHeight: 0,
          hinge: 'a',
          side: 'right',
          openAmount: 0,
        },
      ],
    };

    floor = reconcileFloor(separateRoom(floor, right().props.id));

    // The door was in the wall and the wall did not move.
    expect(floor.openings[0]!.wallId).toBe(shared.id);
    expect(floor.graph.walls[shared.id]).toBeDefined();
  });
});

describe('joining and separating are inverses', () => {
  it('comes back to two separate rooms of the same size', () => {
    const before = roomsOf(floor)
      .map((room) => room.geometry.area)
      .sort();

    floor = reconcileFloor(separateRoom(floor, right().props.id));

    expect(allWalls(floor.graph)).toHaveLength(8);
    expect(
      roomsOf(floor)
        .map((room) => room.geometry.area)
        .sort(),
    ).toEqual(before);
  });
});
