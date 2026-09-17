import { describe, expect, it } from 'vitest';

import { vec2 } from '../geometry/vec2.ts';
import { extractFaces } from './faces.ts';
import { reconcileRooms, type RoomProps } from './roomIdentity.ts';
import {
  graphFromSegments,
  insertWall,
  rectangleSegments,
  removeWall,
  type WallGraph,
} from './wallGraph.ts';

/** Reconcile a graph from scratch, as opening a fresh plan would. */
function firstReconcile(graph: WallGraph) {
  return reconcileRooms(extractFaces(graph), []);
}

/** Reconcile a graph against room data carried over from a previous state. */
function reconcile(graph: WallGraph, props: readonly RoomProps[]) {
  return reconcileRooms(extractFaces(graph), props);
}

function namesByArea(rooms: readonly { props: RoomProps }[]): string[] {
  return rooms.map((room) => room.props.name);
}

describe('reconcileRooms — first run', () => {
  it('names every room it finds', () => {
    const graph = insertWall(
      graphFromSegments(rectangleSegments(0, 0, 4000, 3000)),
      vec2(2000, 0),
      vec2(2000, 3000),
    ).graph;

    const result = firstReconcile(graph);

    expect(result.rooms).toHaveLength(2);
    expect(namesByArea(result.rooms)).toEqual(['Room 1', 'Room 2']);
    expect(result.created).toHaveLength(2);
    expect(result.removed).toHaveLength(0);
  });

  it('anchors each room inside itself', () => {
    const graph = graphFromSegments(rectangleSegments(0, 0, 4000, 3000));
    const result = firstReconcile(graph);

    expect(result.props[0]!.anchor).toEqual({ x: 2000, y: 1500 });
  });

  it('records each room area for later merge decisions', () => {
    const graph = graphFromSegments(rectangleSegments(0, 0, 4000, 3000));
    expect(firstReconcile(graph).props[0]!.lastArea).toBe(12_000_000);
  });

  it('finds nothing in a graph with no rooms', () => {
    const result = firstReconcile(graphFromSegments([{ from: [0, 0], to: [1000, 0] }]));
    expect(result.rooms).toHaveLength(0);
    expect(result.props).toHaveLength(0);
  });
});

describe('reconcileRooms — splitting a room', () => {
  it('keeps the name on the half containing the old anchor', () => {
    // A 6m x 3m bedroom, anchored at its centre (3000, 1500).
    const room = graphFromSegments(rectangleSegments(0, 0, 6000, 3000));
    const before = firstReconcile(room);

    const named: RoomProps[] = [{ ...before.props[0]!, name: 'Yatak Odası', type: 'bedroom' }];
    expect(named[0]!.anchor).toEqual({ x: 3000, y: 1500 });

    // Split off the right-hand 2m. The old anchor at x=3000 is in the left part.
    const divided = insertWall(room, vec2(4000, 0), vec2(4000, 3000)).graph;
    const after = reconcile(divided, named);

    const kept = after.rooms.find((room) => room.props.name === 'Yatak Odası');
    expect(kept).toBeDefined();
    expect(kept!.props.type).toBe('bedroom');
    // The larger, left-hand part: 4m x 3m.
    expect(kept!.face.area).toBe(12_000_000);

    // The other half is new and unnamed. It gets "Room 1" rather than
    // "Room 2": the original was renamed, so no "Room N" is in use and there is
    // nothing on screen to clash with.
    expect(after.created).toHaveLength(1);
    const fresh = after.rooms.find((room) => room.props.id === after.created[0]);
    expect(fresh!.props.name).toBe('Room 1');
    expect(fresh!.props.type).toBe('other');
  });

  it('keeps the name on the smaller half when that is where the anchor was', () => {
    // Split off the left 2m instead: the old anchor at x=3000 is now on the
    // right, which is the larger side. Move the anchor to prove containment —
    // not size — decides.
    const room = graphFromSegments(rectangleSegments(0, 0, 6000, 3000));
    const before = firstReconcile(room);

    const named: RoomProps[] = [
      { ...before.props[0]!, name: 'Kiler', type: 'storage', anchor: vec2(500, 1500) },
    ];

    const divided = insertWall(room, vec2(2000, 0), vec2(2000, 3000)).graph;
    const after = reconcile(divided, named);

    const kept = after.rooms.find((room) => room.props.name === 'Kiler')!;
    // The smaller, left-hand part: 2m x 3m.
    expect(kept.face.area).toBe(6_000_000);
  });

  it('moves the anchor into the retained half', () => {
    const room = graphFromSegments(rectangleSegments(0, 0, 6000, 3000));
    const named: RoomProps[] = [{ ...firstReconcile(room).props[0]!, name: 'Salon' }];

    const divided = insertWall(room, vec2(4000, 0), vec2(4000, 3000)).graph;
    const after = reconcile(divided, named);

    const kept = after.rooms.find((room) => room.props.name === 'Salon')!;
    // Recentred on the half it now occupies, not left where it was.
    expect(kept.props.anchor).toEqual({ x: 2000, y: 1500 });
    expect(kept.props.lastArea).toBe(12_000_000);
  });

  it('survives a split landing exactly on the anchor', () => {
    // A 4m room split perfectly down the middle puts the old anchor on the new
    // wall, inside neither half. The proximity pass has to rescue it.
    const room = graphFromSegments(rectangleSegments(0, 0, 4000, 3000));
    const named: RoomProps[] = [{ ...firstReconcile(room).props[0]!, name: 'Salon' }];
    expect(named[0]!.anchor).toEqual({ x: 2000, y: 1500 });

    const divided = insertWall(room, vec2(2000, 0), vec2(2000, 3000)).graph;
    const after = reconcile(divided, named);

    expect(after.rooms).toHaveLength(2);
    expect(after.removed).toHaveLength(0);
    // The name lands on exactly one of the halves, and does so deterministically.
    expect(namesByArea(after.rooms).filter((name) => name === 'Salon')).toHaveLength(1);
    expect(reconcile(divided, named).rooms.map((r) => r.props.name)).toEqual(
      after.rooms.map((r) => r.props.name),
    );
  });

  it('numbers new rooms on from the highest already in use', () => {
    let graph = graphFromSegments(rectangleSegments(0, 0, 9000, 3000));
    let props = firstReconcile(graph).props;

    graph = insertWall(graph, vec2(3000, 0), vec2(3000, 3000)).graph;
    props = reconcile(graph, props).props;
    expect(namesByArea(reconcile(graph, props).rooms).sort()).toEqual(['Room 1', 'Room 2']);

    graph = insertWall(graph, vec2(6000, 0), vec2(6000, 3000)).graph;
    props = reconcile(graph, props).props;

    // Room 1 is still in use, so the newcomer is Room 3, not a duplicate.
    expect(namesByArea(reconcile(graph, props).rooms).sort()).toEqual([
      'Room 1',
      'Room 2',
      'Room 3',
    ]);
  });
});

describe('reconcileRooms — merging rooms', () => {
  it('keeps the larger room’s name when a dividing wall is removed', () => {
    // A 5m living room beside a 1m store.
    const room = graphFromSegments(rectangleSegments(0, 0, 6000, 3000));
    const { graph: divided, wallIds } = insertWall(room, vec2(5000, 0), vec2(5000, 3000));

    const initial = reconcileRooms(extractFaces(divided), []);
    const named: RoomProps[] = initial.rooms.map((entry) =>
      entry.face.area > 10_000_000
        ? { ...entry.props, name: 'Salon', type: 'living' as const }
        : { ...entry.props, name: 'Kiler', type: 'storage' as const },
    );

    const merged = removeWall(divided, wallIds[0]!);
    const after = reconcile(merged, named);

    expect(after.rooms).toHaveLength(1);
    expect(after.rooms[0]!.props.name).toBe('Salon');
    expect(after.rooms[0]!.props.type).toBe('living');
    expect(after.rooms[0]!.face.area).toBe(18_000_000);

    // The store is reported as gone, so the caller can say so if it wants.
    expect(after.removed).toHaveLength(1);
    expect(after.removed[0]!.name).toBe('Kiler');
  });

  it('is unaffected by the order the rooms are listed in', () => {
    const room = graphFromSegments(rectangleSegments(0, 0, 6000, 3000));
    const { graph: divided, wallIds } = insertWall(room, vec2(5000, 0), vec2(5000, 3000));

    const initial = reconcileRooms(extractFaces(divided), []);
    const named: RoomProps[] = initial.rooms.map((entry) =>
      entry.face.area > 10_000_000
        ? { ...entry.props, name: 'Salon' }
        : { ...entry.props, name: 'Kiler' },
    );

    const merged = removeWall(divided, wallIds[0]!);

    expect(reconcile(merged, named).rooms[0]!.props.name).toBe('Salon');
    expect(reconcile(merged, [...named].reverse()).rooms[0]!.props.name).toBe('Salon');
  });
});

describe('reconcileRooms — rooms that cease to exist', () => {
  it('reports a room whose walls were removed', () => {
    const graph = graphFromSegments([
      ...rectangleSegments(0, 0, 3000, 3000),
      ...rectangleSegments(10_000, 0, 2000, 2000),
    ]);

    const initial = reconcileRooms(extractFaces(graph), []);
    const named = initial.rooms.map((entry, index) => ({
      ...entry.props,
      name: index === 0 ? 'Big' : 'Small',
    }));

    // Knock a wall out of the second building so it no longer encloses.
    const outWall = extractFaces(graph).find((face) => face.area === 4_000_000)!.wallIds[0]!;
    const broken = removeWall(graph, outWall);

    const after = reconcile(broken, named);
    expect(after.rooms).toHaveLength(1);
    expect(after.rooms[0]!.props.name).toBe('Big');
    expect(after.removed.map((props) => props.name)).toEqual(['Small']);
  });
});

describe('reconcileRooms — holes', () => {
  it('does not let a room claim a face through a hole in it', () => {
    // A room with a column built exactly where its anchor sat. The anchor is
    // inside the face's outer ring but inside the hole, so it must not count.
    const graph = graphFromSegments([
      ...rectangleSegments(0, 0, 4000, 4000),
      ...rectangleSegments(1500, 1500, 1000, 1000),
    ]);

    const faces = extractFaces(graph);
    const room = faces.find((face) => face.holes.length === 1)!;
    const column = faces.find((face) => face.area === 1_000_000)!;

    const strandedInTheColumn: RoomProps[] = [
      {
        id: 'r1',
        anchor: vec2(2000, 2000),
        name: 'Salon',
        type: 'living',
        lastArea: 16_000_000,
      },
    ];

    const after = reconcileRooms([room, column], strandedInTheColumn);

    // It resolves to the column's own interior rather than claiming the room
    // it is standing in the middle of.
    const claimed = after.rooms.find((entry) => entry.props.name === 'Salon');
    expect(claimed!.face.area).toBe(column.area);
  });
});

describe('reconcileRooms — stability', () => {
  it('is idempotent — reconciling an unchanged graph changes nothing', () => {
    const graph = insertWall(
      graphFromSegments(rectangleSegments(0, 0, 4000, 3000)),
      vec2(2000, 0),
      vec2(2000, 3000),
    ).graph;

    const first = firstReconcile(graph);
    const second = reconcile(graph, first.props);
    const third = reconcile(graph, second.props);

    expect(second.props).toEqual(first.props);
    expect(third.props).toEqual(first.props);
    expect(second.created).toHaveLength(0);
    expect(second.removed).toHaveLength(0);
  });

  it('keeps names through an unrelated edit elsewhere in the plan', () => {
    let graph = graphFromSegments(rectangleSegments(0, 0, 8000, 3000));
    graph = insertWall(graph, vec2(4000, 0), vec2(4000, 3000)).graph;

    let props = reconcileRooms(extractFaces(graph), []).rooms.map((entry, index) => ({
      ...entry.props,
      name: index === 0 ? 'Salon' : 'Mutfak',
    }));

    // Add a stub partition in one room that divides nothing.
    graph = insertWall(graph, vec2(1000, 0), vec2(1000, 800)).graph;
    props = [...reconcile(graph, props).props];

    expect(props.map((entry) => entry.name).sort()).toEqual(['Mutfak', 'Salon']);
  });
});
