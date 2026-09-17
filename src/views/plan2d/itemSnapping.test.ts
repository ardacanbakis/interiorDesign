import { describe, expect, it } from 'vitest';

import { createItem } from '../../core/catalog/registry.ts';
import { itemBounds } from '../../core/catalog/placement.ts';
import { graphFromSegments, rectangleSegments } from '../../core/graph/wallGraph.ts';
import { type Item } from '../../core/model/schema.ts';
import { snapItem } from './itemSnapping.ts';

/**
 * A room whose centrelines are the rectangle (0,0)–(4000,3000).
 *
 * Exterior walls, so 250mm thick: the inner faces are at x = 125 and 3875,
 * y = 125 and 2875. A 600mm-deep wardrobe against one of them therefore has its
 * centre 300mm off the face — y = 425 against the top wall, and so on.
 */
const ROOM = graphFromSegments(rectangleSegments(0, 0, 4000, 3000, 'exterior'));

/** Where a 600mm-deep item ends up against the top wall. */
const AGAINST_TOP = 425;

const OPTIONS = { reach: 400, grid: 100 };

function wardrobe(overrides: Partial<Item> = {}): Item {
  return { ...createItem('wardrobe', 'w1', 0, 0), ...overrides };
}

describe('snapping furniture to a wall', () => {
  it('puts the back flat against the wall it was dropped near', () => {
    const item = wardrobe();
    const snap = snapItem(ROOM, item, { x: 2000, y: 300 }, OPTIONS);

    expect(snap.kind).toBe('wall');

    // The back edge lands on the wall's inner *face*, not on its centreline —
    // a wardrobe drawn half inside the masonry is the classic version of this
    // bug, and on a 250mm exterior wall it would be 125mm out.
    const placed = itemBounds({ ...item, x: snap.x, y: snap.y, rotation: snap.rotation });
    expect(placed.minY).toBeCloseTo(125, 6);
  });

  it('turns the item to face into the room', () => {
    // Against the top wall, the front faces down (+y), which is 0°.
    expect(snapItem(ROOM, wardrobe(), { x: 2000, y: 300 }, OPTIONS).rotation).toBeCloseTo(0, 6);

    // Against the left wall, the front faces right (+x), which is 270°.
    expect(snapItem(ROOM, wardrobe(), { x: 300, y: 1500 }, OPTIONS).rotation).toBeCloseTo(270, 6);

    // Against the bottom wall, the front faces up.
    expect(snapItem(ROOM, wardrobe(), { x: 2000, y: 2700 }, OPTIONS).rotation).toBeCloseTo(180, 6);
  });

  it('slides along the wall to follow the pointer', () => {
    const left = snapItem(ROOM, wardrobe(), { x: 1000, y: 200 }, OPTIONS);
    const right = snapItem(ROOM, wardrobe(), { x: 3000, y: 200 }, OPTIONS);

    expect(left.x).toBe(1000);
    expect(right.x).toBe(3000);
    expect(left.y).toBe(AGAINST_TOP);
    expect(right.y).toBe(AGAINST_TOP);
  });

  it('keeps the item from hanging off the end of its wall', () => {
    // Aimed near the left end of the top wall: a 1500mm wardrobe cannot have
    // its centre at x = 400 without a third of it being outside the room.
    const snap = snapItem(ROOM, wardrobe(), { x: 400, y: 200 }, OPTIONS);

    expect(snap).toMatchObject({ x: 750, y: AGAINST_TOP });
  });

  it('falls back to the grid out in the middle of the room', () => {
    const snap = snapItem(ROOM, wardrobe(), { x: 1963, y: 1488 }, OPTIONS);

    expect(snap.kind).toBe('grid');
    expect(snap).toMatchObject({ x: 2000, y: 1500, rotation: 0 });
  });

  it('leaves the pointer alone when snapping is switched off', () => {
    const snap = snapItem(
      ROOM,
      wardrobe({ rotation: 33 }),
      { x: 2000, y: 200 },
      {
        ...OPTIONS,
        enabled: false,
      },
    );

    expect(snap).toMatchObject({ x: 2000, y: 200, rotation: 33, kind: 'free' });
  });

  it('chooses the face by which side of the wall the pointer is on', () => {
    // A partition across the room: the same wall serves both sides, and which
    // one a wardrobe goes against is decided by where it was dropped, not by
    // which node the wall happens to start from.
    const divided = graphFromSegments([
      ...rectangleSegments(0, 0, 4000, 3000, 'exterior'),
      { from: [2000, 0], to: [2000, 3000], kind: 'interior' },
    ]);

    const west = snapItem(divided, wardrobe(), { x: 1800, y: 1500 }, OPTIONS);
    const east = snapItem(divided, wardrobe(), { x: 2200, y: 1500 }, OPTIONS);

    // Facing away from the partition, so exactly opposite each other.
    const apart = (((west.rotation - east.rotation) % 360) + 360) % 360;
    expect(apart).toBeCloseTo(180, 6);
    expect(west.x).toBeLessThan(2000);
    expect(east.x).toBeGreaterThan(2000);
  });
});

describe('snapping furniture to its neighbours', () => {
  it('butts an item up against the one beside it on the same wall', () => {
    const first = wardrobe({ id: 'w1', x: 1000, y: AGAINST_TOP, rotation: 0 });
    const second = wardrobe({ id: 'w2' });

    // Aimed just past the first one's right edge — 1000 + 750 + 750 = 2500.
    const snap = snapItem(ROOM, second, { x: 2380, y: 300 }, { ...OPTIONS, neighbours: [first] });

    expect(snap.kind).toBe('neighbour');
    expect(snap).toMatchObject({ x: 2500, y: AGAINST_TOP });
    expect(snap.guides.length).toBe(1);
  });

  it('catches on either side of a neighbour', () => {
    const first = wardrobe({ id: 'w1', x: 2000, y: AGAINST_TOP });
    const snap = snapItem(
      ROOM,
      wardrobe({ id: 'w2' }),
      { x: 620, y: 300 },
      {
        ...OPTIONS,
        neighbours: [first],
      },
    );

    // Shoulder to shoulder on the other side: the centres end up a full
    // wardrobe apart, 2000 − 750 − 750.
    expect(snap.x).toBe(500);
  });

  it('ignores furniture standing against a different wall', () => {
    // Against the bottom wall, at the same distance along — which in the wall's
    // own coordinates looks identical to a neighbour, and is nothing of the
    // kind.
    const faraway = wardrobe({ id: 'w1', x: 2000, y: 2575, rotation: 180 });
    const snap = snapItem(
      ROOM,
      wardrobe({ id: 'w2' }),
      { x: 2870, y: 300 },
      {
        ...OPTIONS,
        neighbours: [faraway],
      },
    );

    expect(snap.kind).toBe('wall');
    expect(snap.x).toBe(2870);
  });

  it('never snaps an item to itself', () => {
    const item = wardrobe({ id: 'w1', x: 1000, y: AGAINST_TOP });
    const snap = snapItem(ROOM, item, { x: 1100, y: 300 }, { ...OPTIONS, neighbours: [item] });

    expect(snap.kind).toBe('wall');
    expect(snap.x).toBe(1100);
  });
});
