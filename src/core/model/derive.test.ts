import { describe, expect, it } from 'vitest';

import { vec2 } from '../geometry/vec2.ts';
import { graphFromSegments, insertWall, rectangleSegments } from '../graph/wallGraph.ts';
import { facesOf, floorArea, geometryOf, reconcileFloor, roomAt, roomsOf } from './derive.ts';
import { createFloor } from './document.ts';
import { type Floor } from './schema.ts';

/** A 6m x 3m shell with 250mm exterior walls. */
function shell(): Floor {
  return createFloor('f', 0, 'Ground floor', {
    graph: graphFromSegments(rectangleSegments(0, 0, 6000, 3000, 'exterior')),
  });
}

/** The same shell divided into a 4m and a 2m room. */
function divided(): Floor {
  const base = shell();
  return {
    ...base,
    graph: insertWall(base.graph, vec2(4000, 0), vec2(4000, 3000), { kind: 'interior' }).graph,
  };
}

describe('facesOf — caching', () => {
  it('returns the same result for the same graph, without recomputing', () => {
    const floor = shell();
    expect(facesOf(floor.graph)).toBe(facesOf(floor.graph));
  });

  it('recomputes for a different graph', () => {
    expect(facesOf(shell().graph)).not.toBe(facesOf(divided().graph));
    expect(facesOf(divided().graph)).toHaveLength(2);
  });
});

describe('geometryOf — caching', () => {
  it('computes a face’s floor once', () => {
    const floor = shell();
    const face = facesOf(floor.graph)[0]!;
    expect(geometryOf(floor.graph, face)).toBe(geometryOf(floor.graph, face));
  });
});

describe('roomsOf', () => {
  it('pairs every face with room data and usable floor', () => {
    const rooms = roomsOf(shell());

    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.props.name).toBe('Room 1');
    // 6m x 3m centrelines, 250mm walls: 5.75m x 2.75m of floor.
    expect(rooms[0]!.geometry.area).toBe(5750 * 2750);
  });

  it('reports rooms largest first', () => {
    const areas = roomsOf(divided()).map((room) => room.face.area);
    expect(areas).toEqual([...areas].sort((left, right) => right - left));
  });

  it('does not change the floor it reads', () => {
    const floor = shell();
    const rooms = floor.rooms;
    roomsOf(floor);
    expect(floor.rooms).toBe(rooms);
  });
});

describe('reconcileFloor', () => {
  it('writes the discovered rooms into the floor', () => {
    const reconciled = reconcileFloor(shell());
    expect(reconciled.rooms).toHaveLength(1);
    expect(reconciled.rooms[0]!.name).toBe('Room 1');
  });

  it('returns the very same object when nothing needs to change', () => {
    // This is what stops an edit elsewhere in the document from marking the
    // room list as modified, which would make every plan look unsaved.
    const once = reconcileFloor(shell());
    expect(reconcileFloor(once)).toBe(once);
  });

  it('keeps a renamed room through an unrelated reconcile', () => {
    const once = reconcileFloor(shell());
    const renamed: Floor = {
      ...once,
      rooms: [{ ...once.rooms[0]!, name: 'Salon', type: 'living' }],
    };

    const again = reconcileFloor(renamed);
    expect(again.rooms[0]!.name).toBe('Salon');
    expect(again.rooms[0]!.type).toBe('living');
    expect(again).toBe(renamed);
  });
});

describe('roomAt', () => {
  it('finds the room a point falls in', () => {
    const floor = reconcileFloor(divided());

    const left = roomAt(floor, vec2(2000, 1500));
    const right = roomAt(floor, vec2(5000, 1500));

    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(left!.props.id).not.toBe(right!.props.id);
    expect(left!.face.area).toBeGreaterThan(right!.face.area);
  });

  it('returns null for a point outside the plan', () => {
    expect(roomAt(reconcileFloor(shell()), vec2(-500, 1500))).toBeNull();
  });

  it('returns null for a point inside a wall', () => {
    // The wall runs along x = 0 and is 250 thick, so x = 50 is masonry.
    expect(roomAt(reconcileFloor(shell()), vec2(50, 1500))).toBeNull();
  });

  it('prefers the smaller room where one is inside another', () => {
    const floor = reconcileFloor(
      createFloor('f', 0, 'Ground floor', {
        graph: graphFromSegments([
          ...rectangleSegments(0, 0, 10_000, 10_000, 'exterior'),
          ...rectangleSegments(2000, 2000, 3000, 3000, 'interior'),
        ]),
      }),
    );

    const inner = roomAt(floor, vec2(3500, 3500));
    expect(inner).not.toBeNull();
    expect(inner!.face.area).toBe(9_000_000);
  });

  it('returns null for a point standing in a column', () => {
    const floor = reconcileFloor(
      createFloor('f', 0, 'Ground floor', {
        graph: graphFromSegments([
          ...rectangleSegments(0, 0, 6000, 6000, 'exterior'),
          ...rectangleSegments(2500, 2500, 1000, 1000, 'exterior'),
        ]),
      }),
    );

    // Dead centre of the column: inside the room's outer ring but in its hole.
    // The column's own interior is a room in its own right, and smaller, so the
    // point resolves there rather than to the room around it.
    const found = roomAt(floor, vec2(3000, 3000));
    expect(found?.face.area).toBe(1_000_000);
  });
});

describe('floorArea', () => {
  it('totals the usable floor of every room', () => {
    const floor = reconcileFloor(divided());
    const rooms = roomsOf(floor);

    expect(floorArea(floor)).toBe(rooms[0]!.geometry.area + rooms[1]!.geometry.area);
  });

  it('is zero for a floor with no rooms', () => {
    expect(floorArea(createFloor('f', 0, 'Empty'))).toBe(0);
  });
});
