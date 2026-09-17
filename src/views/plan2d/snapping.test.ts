import { describe, expect, it } from 'vitest';

import { vec2 } from '../../core/geometry/vec2.ts';
import { EMPTY_GRAPH, graphFromSegments, rectangleSegments } from '../../core/graph/wallGraph.ts';
import { snapPoint, squareToAxis } from './snapping.ts';

/** A 4m x 3m room with corners at (0,0), (4000,0), (4000,3000), (0,3000). */
const room = graphFromSegments(rectangleSegments(0, 0, 4000, 3000));

const options = { radius: 200, grid: 100 };

describe('snapPoint — corners win', () => {
  it('snaps to an existing corner', () => {
    const snap = snapPoint(room, vec2(4050, 40), options);

    expect(snap.kind).toBe('node');
    expect(snap.point).toEqual({ x: 4000, y: 0 });
  });

  it('prefers the nearest corner', () => {
    expect(snapPoint(room, vec2(120, 2900), options).point).toEqual({ x: 0, y: 3000 });
  });

  it('ignores a corner outside the radius', () => {
    expect(snapPoint(room, vec2(1000, 1000), options).kind).not.toBe('node');
  });

  it('can be told to ignore a node — the one being dragged', () => {
    const nodeId = Object.values(room.nodes).find((node) => node.x === 4000 && node.y === 0)!.id;

    const snapped = snapPoint(room, vec2(4050, 40), { ...options, exclude: new Set([nodeId]) });
    expect(snapped.kind).not.toBe('node');
  });
});

describe('snapPoint — walls', () => {
  it('snaps onto a wall centreline, so a new wall splits it cleanly', () => {
    const snap = snapPoint(room, vec2(2000, 60), options);

    expect(snap.kind).toBe('wall');
    expect(snap.point).toEqual({ x: 2000, y: 0 });
  });

  it('prefers a corner over the wall it sits on', () => {
    // Near the top-left corner and also near both walls meeting there.
    expect(snapPoint(room, vec2(30, 30), options).kind).toBe('node');
  });

  it('ignores a wall outside the radius', () => {
    expect(snapPoint(room, vec2(2000, 1500), options).kind).not.toBe('wall');
  });
});

describe('snapPoint — alignment', () => {
  it('lines up with a distant corner on one axis', () => {
    // Two metres clear of the room, so no wall is in range — but x = 4000 is
    // still the line its right-hand corners stand on.
    const snap = snapPoint(room, vec2(4020, -2000), { radius: 200, grid: 1000 });

    expect(snap.kind).toBe('alignment');
    expect(snap.point).toEqual({ x: 4000, y: -2000 });
    expect(snap.guides).toHaveLength(1);
  });

  it('squares off the anchor while a run is being drawn', () => {
    const snap = snapPoint(EMPTY_GRAPH, vec2(3000, 40), {
      radius: 200,
      grid: 1000,
      anchor: vec2(0, 0),
    });

    expect(snap.kind).toBe('axis');
    expect(snap.point.y).toBe(0);
    expect(snap.guides).toHaveLength(1);
  });

  it('draws a guide back to what it lined up with', () => {
    const snap = snapPoint(EMPTY_GRAPH, vec2(3000, 40), {
      radius: 200,
      grid: 1000,
      anchor: vec2(0, 0),
    });

    expect(snap.guides[0]!.from).toEqual({ x: 0, y: 0 });
    expect(snap.guides[0]!.to).toEqual(snap.point);
  });

  it('can line up on both axes at once, against different corners', () => {
    // A second room far away, so x can come from one and y from the other
    // while the pointer is nowhere near any wall.
    const twoRooms = graphFromSegments([
      ...rectangleSegments(0, 0, 4000, 3000),
      ...rectangleSegments(10_000, 8000, 2000, 2000),
    ]);

    const snap = snapPoint(twoRooms, vec2(4020, 8020), { radius: 200, grid: 5000 });

    expect(snap.point).toEqual({ x: 4000, y: 8000 });
    expect(snap.guides).toHaveLength(2);
  });

  it('is outranked by a wall the pointer is actually near', () => {
    // (4020, 1500) lines up with the right-hand corners, but it is also 20mm
    // from the wall between them — and landing exactly on that wall is more
    // likely to be what was meant, because it splits it cleanly.
    const snap = snapPoint(room, vec2(4020, 1500), { radius: 200, grid: 1000 });

    expect(snap.kind).toBe('wall');
    expect(snap.point).toEqual({ x: 4000, y: 1500 });
  });
});

describe('snapPoint — grid fallback', () => {
  it('falls back to the grid when nothing else is near', () => {
    const snap = snapPoint(EMPTY_GRAPH, vec2(1234, 5678), { radius: 200, grid: 100 });

    expect(snap.kind).toBe('grid');
    expect(snap.point).toEqual({ x: 1200, y: 5700 });
  });

  it('follows the current grid spacing', () => {
    expect(snapPoint(EMPTY_GRAPH, vec2(1234, 5678), { radius: 200, grid: 1000 }).point).toEqual({
      x: 1000,
      y: 6000,
    });
  });

  it('rounds to a whole millimetre when there is no grid', () => {
    expect(snapPoint(EMPTY_GRAPH, vec2(1234.6, -5678.4), { radius: 200, grid: 0 }).point).toEqual({
      x: 1235,
      y: -5678,
    });
  });
});

describe('snapPoint — disabled', () => {
  it('returns the raw point, rounded, when snapping is held off', () => {
    const snap = snapPoint(room, vec2(4050.4, 39.6), { ...options, enabled: false });

    expect(snap.point).toEqual({ x: 4050, y: 40 });
    expect(snap.guides).toHaveLength(0);
  });

  it('never returns a fractional coordinate, whatever the path', () => {
    const cases = [
      snapPoint(room, vec2(4050.4, 39.6), options),
      snapPoint(room, vec2(2000.7, 60.2), options),
      snapPoint(EMPTY_GRAPH, vec2(1234.5, 5678.5), { radius: 200, grid: 100 }),
      snapPoint(room, vec2(4020.3, 1500.8), { radius: 200, grid: 1000 }),
    ];

    for (const snap of cases) {
      expect(Number.isInteger(snap.point.x)).toBe(true);
      expect(Number.isInteger(snap.point.y)).toBe(true);
    }
  });
});

describe('squareToAxis', () => {
  it('flattens a mostly-horizontal run', () => {
    expect(squareToAxis(vec2(0, 0), vec2(3000, 120))).toEqual({ x: 3000, y: 0 });
  });

  it('flattens a mostly-vertical run', () => {
    expect(squareToAxis(vec2(0, 0), vec2(120, 3000))).toEqual({ x: 0, y: 3000 });
  });

  it('breaks an exact diagonal towards horizontal', () => {
    expect(squareToAxis(vec2(0, 0), vec2(1000, 1000))).toEqual({ x: 1000, y: 0 });
  });

  it('works away from the origin', () => {
    expect(squareToAxis(vec2(5000, 5000), vec2(8000, 5100))).toEqual({ x: 8000, y: 5000 });
  });
});
