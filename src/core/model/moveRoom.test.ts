/**
 * Moving a room.
 *
 * The thing to prove is not that the walls end up 500mm to the left — that much
 * is addition. It is that everything which belongs to the room goes with it:
 * the furniture standing in it, the doors in its walls, and the name on it. A
 * move that leaves any of those behind is worse than no move at all, because
 * the damage is not obvious until later.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { createItem } from '../catalog/registry.ts';
import { openingFrame } from '../openings/geometry.ts';
import { graphFromSegments, rectangleSegments } from '../graph/wallGraph.ts';
import { createFloor } from './document.ts';
import { reconcileFloor, roomsOf } from './derive.ts';
import { moveRoomBy, planRoomMove } from './moveRoom.ts';
import { type Floor, type Opening } from './schema.ts';

/** A 4m × 5m room of usable floor, on 100mm walls, cornered at the origin. */
function room(originX = 0, originY = 0, width = 4100, depth = 5100): Floor {
  return reconcileFloor({
    ...createFloor('f1', 0, 'Ground floor'),
    graph: graphFromSegments(
      rectangleSegments(originX - 50, originY - 50, width, depth, 'exterior').map((segment) => ({
        ...segment,
        thickness: 100,
      })),
    ),
  });
}

let floor: Floor;

beforeEach(() => {
  floor = room();
});

function firstRoomId(): string {
  return floor.rooms[0]!.id;
}

function place(kind: string, x: number, y: number) {
  const item = createItem(kind, `i${floor.items.length + 1}`, x, y);
  floor = { ...floor, items: [...floor.items, item] };
  return item;
}

function bounds() {
  const xs = Object.values(floor.graph.nodes).map((node) => node.x);
  const ys = Object.values(floor.graph.nodes).map((node) => node.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys) };
}

/** Add a second, separate room clear of the first. */
function addDetachedRoom() {
  let graph = floor.graph;
  for (const segment of rectangleSegments(10_000, 0, 3000, 3000, 'exterior')) {
    graph = graphFromSegments([
      ...Object.values(graph.walls).map((wall) => ({
        from: [graph.nodes[wall.a]!.x, graph.nodes[wall.a]!.y] as [number, number],
        to: [graph.nodes[wall.b]!.x, graph.nodes[wall.b]!.y] as [number, number],
        kind: wall.kind,
        thickness: wall.thickness,
      })),
      { ...segment, thickness: 100 },
    ]);
  }
  floor = reconcileFloor({ ...floor, graph });
}

// ---------------------------------------------------------------------------

describe('moving a room', () => {
  it('moves every wall by exactly the distance asked for', () => {
    const before = bounds();
    floor = moveRoomBy(floor, firstRoomId(), { x: 1500, y: -800 });

    expect(bounds().minX).toBe(before.minX + 1500);
    expect(bounds().minY).toBe(before.minY - 800);
  });

  it('leaves the room exactly the size it was', () => {
    const before = roomsOf(floor)[0]!.geometry.area;
    floor = moveRoomBy(floor, firstRoomId(), { x: 2500, y: 2500 });

    expect(roomsOf(floor)[0]!.geometry.area).toBe(before);
  });

  it('works in whole millimetres, whatever it is handed', () => {
    floor = moveRoomBy(floor, firstRoomId(), { x: 100.4, y: -100.6 });

    const moved = bounds();
    expect(Number.isInteger(moved.minX)).toBe(true);
    expect(moved.minX).toBe(-50 + 100);
    expect(moved.minY).toBe(-50 - 101);
  });

  it('does nothing at all when the distance rounds to nothing', () => {
    // The same object back, so a drag that goes nowhere does not mark the plan
    // as edited or land on the undo stack.
    expect(moveRoomBy(floor, firstRoomId(), { x: 0.2, y: -0.4 })).toBe(floor);
    expect(moveRoomBy(floor, firstRoomId(), { x: 0, y: 0 })).toBe(floor);
  });

  it('ignores a room that is not there', () => {
    expect(moveRoomBy(floor, 'nonexistent', { x: 500, y: 0 })).toBe(floor);
  });
});

describe('what comes with it', () => {
  it('takes the furniture standing in the room', () => {
    const bed = place('bed-double', 2000, 2500);
    const wardrobe = place('wardrobe', 3500, 400);

    floor = moveRoomBy(floor, firstRoomId(), { x: 1000, y: 500 });

    expect(floor.items[0]).toMatchObject({ id: bed.id, x: 3000, y: 3000 });
    expect(floor.items[1]).toMatchObject({ id: wardrobe.id, x: 4500, y: 900 });
  });

  it('takes something fixed to the inside of a wall', () => {
    // A television at 60mm off the face is not standing on the usable floor,
    // and measuring against the floor rather than the face would leave it
    // hanging where the wall used to be.
    const tv = place('tv-wall', 2000, 60);
    floor = moveRoomBy(floor, firstRoomId(), { x: 1000, y: 0 });

    expect(floor.items[0]).toMatchObject({ id: tv.id, x: 3000 });
  });

  it('leaves furniture that is somewhere else where it is', () => {
    place('bed-double', 2000, 2500);
    const outside = place('wardrobe', 20_000, 20_000);

    floor = moveRoomBy(floor, firstRoomId(), { x: 1000, y: 0 });

    expect(floor.items[1]).toMatchObject({ id: outside.id, x: 20_000, y: 20_000 });
  });

  it('keeps the room its name, its type and its id', () => {
    // The invisible one. Room data is held against an anchor point; leave the
    // anchor behind and the room comes back unnamed with a fresh id, taking
    // any muted warnings about it with it.
    floor = {
      ...floor,
      rooms: floor.rooms.map((entry) => ({ ...entry, name: 'Yatak Odası', type: 'bedroom' })),
    };
    const before = firstRoomId();

    floor = reconcileFloor(moveRoomBy(floor, before, { x: 3000, y: 3000 }));

    expect(floor.rooms).toHaveLength(1);
    expect(floor.rooms[0]).toMatchObject({ id: before, name: 'Yatak Odası', type: 'bedroom' });
  });

  it('carries the doors on its walls, still in the same place on them', () => {
    const door: Opening = {
      id: 'o1',
      kind: 'door',
      label: 'Door',
      wallId: Object.keys(floor.graph.walls)[0]!,
      offset: 900,
      width: 800,
      height: 2050,
      sillHeight: 0,
      hinge: 'a',
      side: 'right',
      openAmount: 0,
    };
    floor = { ...floor, openings: [door] };

    const wallBefore = floor.graph.walls[door.wallId]!;
    const before = openingFrame(floor.graph, wallBefore, door).centre;

    floor = moveRoomBy(floor, firstRoomId(), { x: 1200, y: -400 });

    const after = openingFrame(floor.graph, floor.graph.walls[door.wallId]!, door).centre;
    expect(after.x).toBe(before.x + 1200);
    expect(after.y).toBe(before.y - 400);
    // Still 900 from the corner it was 900 from.
    expect(floor.openings[0]!.offset).toBe(900);
  });
});

describe('what a move takes with it, before it happens', () => {
  it('reports the corners, the room and the furniture', () => {
    place('bed-double', 2000, 2500);

    const plan = planRoomMove(floor, firstRoomId())!;
    expect(plan.nodeIds.size).toBe(4);
    expect(plan.roomIds).toEqual([firstRoomId()]);
    expect(plan.itemIds).toEqual(['i1']);
  });

  it('reports nothing for a room that is not there', () => {
    expect(planRoomMove(floor, 'nope')).toBeNull();
  });
});

describe('rooms that are joined to others', () => {
  beforeEach(() => {
    // A partition across the middle, so one structure holds two rooms.
    floor = reconcileFloor({
      ...floor,
      graph: graphFromSegments([
        ...rectangleSegments(-50, -50, 4100, 5100, 'exterior').map((segment) => ({
          ...segment,
          thickness: 100,
        })),
        { from: [-50, 2500], to: [4050, 2500], kind: 'interior' as const, thickness: 100 },
      ]),
    });
  });

  it('has two rooms to begin with', () => {
    expect(roomsOf(floor)).toHaveLength(2);
  });

  it('moves both, because they are one piece of building', () => {
    // Moving one and not the other would mean stretching the wall between
    // them, which is what dragging that wall is for.
    const plan = planRoomMove(floor, floor.rooms[0]!.id)!;
    expect(plan.roomIds).toHaveLength(2);

    const before = bounds();
    floor = moveRoomBy(floor, floor.rooms[0]!.id, { x: 700, y: 0 });

    expect(bounds().minX).toBe(before.minX + 700);
    expect(roomsOf(floor)).toHaveLength(2);
  });

  it('takes the furniture out of both of them', () => {
    place('bed-double', 2000, 1200);
    place('sofa-3', 2000, 3800);

    floor = moveRoomBy(floor, floor.rooms[0]!.id, { x: 700, y: 0 });

    expect(floor.items.map((item) => item.x)).toEqual([2700, 2700]);
  });
});

describe('rooms that are not joined to anything', () => {
  beforeEach(() => {
    addDetachedRoom();
  });

  it('has two separate rooms', () => {
    expect(roomsOf(floor)).toHaveLength(2);
  });

  it('moves one without disturbing the other', () => {
    const rooms = roomsOf(floor);
    const left = rooms.find((entry) => entry.geometry.interiorPoint.x < 5000)!;
    const right = rooms.find((entry) => entry.geometry.interiorPoint.x > 5000)!;

    const rightBefore = right.geometry.interiorPoint;
    floor = moveRoomBy(floor, left.props.id, { x: 0, y: 4000 });

    const after = roomsOf(floor).find((entry) => entry.props.id === right.props.id)!.geometry
      .interiorPoint;

    expect(after).toEqual(rightBefore);
  });

  it('only takes the furniture from the room being moved', () => {
    const rooms = roomsOf(floor);
    const left = rooms.find((entry) => entry.geometry.interiorPoint.x < 5000)!;

    place('bed-double', 2000, 2500);
    place('wardrobe', 11_500, 1500);

    floor = moveRoomBy(floor, left.props.id, { x: 0, y: 4000 });

    expect(floor.items[0]!.y).toBe(6500);
    expect(floor.items[1]!.y).toBe(1500);
  });
});
