import { describe, expect, it } from 'vitest';

import { boundingBox } from '../geometry/polygon.ts';
import { createItem } from './registry.ts';
import {
  itemAt,
  itemAxes,
  itemBounds,
  itemFootprint,
  itemHeightRange,
  placedClearances,
  placedShape,
  placedShapeIfKnown,
  rotationFacing,
  toLocal,
  toWorld,
} from './placement.ts';

/** A wardrobe: 1500 wide, 600 deep, placed and turned as the test needs. */
function wardrobe(x: number, y: number, rotation = 0) {
  return { ...createItem('wardrobe', 'w1', x, y, rotation) };
}

const round = (value: number) => Math.round(value * 1000) / 1000;

describe('placing an item', () => {
  it('leaves an unturned item where it was put', () => {
    const item = wardrobe(2000, 1500);
    const box = itemBounds(item);

    expect(box).toEqual({ minX: 1250, maxX: 2750, minY: 1200, maxY: 1800 });
  });

  it('turns width and depth round with the item', () => {
    // A quarter turn puts the 1500mm width across the screen's Y and the 600mm
    // depth across X — which is the whole reason a rotated wardrobe fits an
    // alcove that an unrotated one does not.
    const box = itemBounds(wardrobe(0, 0, 90));

    expect(round(box.maxX - box.minX)).toBe(600);
    expect(round(box.maxY - box.minY)).toBe(1500);
  });

  it('measures rotation clockwise on screen, matching the y-down plan', () => {
    // +y is down, so a positive rotation turns the way the numbers on a clock
    // face do. An item turned 90° faces left.
    const axes = itemAxes({ rotation: 90 });

    expect(round(axes.along.x)).toBe(0);
    expect(round(axes.along.y)).toBe(1);
    expect(round(axes.front.x)).toBe(-1);
    expect(round(axes.front.y)).toBe(0);
  });

  it('recovers the rotation that makes an item face a direction', () => {
    expect(round(rotationFacing({ x: 0, y: 1 }))).toBe(0);
    expect(round(rotationFacing({ x: -1, y: 0 }))).toBe(90);
    expect(round(rotationFacing({ x: 0, y: -1 }))).toBe(180);
    expect(round(rotationFacing({ x: 1, y: 0 }))).toBe(270);
  });

  it('round-trips between the item’s frame and the world', () => {
    const item = wardrobe(1234, -567, 37);
    const point = { x: 210, y: -95 };

    const back = toLocal(item, toWorld(item, point));

    expect(round(back.x)).toBe(point.x);
    expect(round(back.y)).toBe(point.y);
  });

  it('puts the front of an unturned item on the +y side', () => {
    // The convention every clearance zone depends on: +y is the side you walk
    // up to, so a wardrobe's swing lands below it on an unturned plan.
    const zones = placedClearances(wardrobe(0, 0));
    const swing = zones.find((zone) => zone.id === 'wardrobe-swing');

    expect(swing).toBeDefined();
    expect(boundingBox(swing!.polygon).minY).toBeGreaterThanOrEqual(300);
  });

  it('carries clearance zones round with the item', () => {
    const turned = placedClearances(wardrobe(0, 0, 90));
    const swing = turned.find((zone) => zone.id === 'wardrobe-swing');

    // Turned 90°, the front faces −x, so the space it needs is to its left,
    // starting exactly at the front face — half the 600mm depth from centre.
    expect(boundingBox(swing!.polygon).maxX).toBeCloseTo(-300, 6);
  });

  it('swings arcs round with the item', () => {
    const straight = placedShape(wardrobe(0, 0));
    const turned = placedShape(wardrobe(0, 0, 90));

    expect(straight.arcs.length).toBeGreaterThan(0);
    expect(turned.arcs.length).toBe(straight.arcs.length);

    const before = straight.arcs[0]!;
    const after = turned.arcs[0]!;
    expect(round(after.startAngle - before.startAngle)).toBe(round(Math.PI / 2));
    expect(after.radius).toBe(before.radius);
  });

  it('reports the height an item occupies from its own underside', () => {
    const shelf = createItem('wall-shelf', 's1', 0, 0);
    expect(itemHeightRange(shelf)).toEqual({ bottom: 1400, top: 1440 });
  });
});

describe('hit testing', () => {
  it('finds the item under a point', () => {
    const items = [wardrobe(0, 0), { ...wardrobe(5000, 0), id: 'w2' }];

    expect(itemAt(items, { x: 100, y: 100 })?.id).toBe('w1');
    expect(itemAt(items, { x: 5000, y: 0 })?.id).toBe('w2');
    expect(itemAt(items, { x: 3000, y: 0 })).toBeNull();
  });

  it('picks the one on top where they overlap', () => {
    // Later items are drawn over earlier ones, so clicking has to agree with
    // what is visible — otherwise you select the rug under the table.
    const under = { ...wardrobe(0, 0), id: 'under' };
    const over = { ...wardrobe(0, 0), id: 'over' };

    expect(itemAt([under, over], { x: 0, y: 0 })?.id).toBe('over');
  });

  it('respects the actual footprint, not the bounding box', () => {
    // A round table's corners are not part of it.
    const table = createItem('dining-table-round', 't1', 0, 0);
    const corner = { x: 590, y: 590 };

    expect(boundingBox(itemFootprint(table)).maxX).toBeCloseTo(600, 6);
    expect(itemAt([table], corner)).toBeNull();
    expect(itemAt([table], { x: 0, y: 0 })?.id).toBe('t1');
  });
});

describe('an item whose kind is not in the catalogue', () => {
  // A document saved by a newer version, or hand-edited. The schema cannot
  // catch it — a kind is just a string — so the drawing path has to survive it
  // rather than take the canvas down.
  const stranger = { ...createItem('wardrobe', 'x1', 0, 0), kind: 'teleporter' };

  it('is left out of the plan rather than thrown over', () => {
    expect(placedShapeIfKnown(stranger)).toBeNull();
  });

  it('is not under the pointer either', () => {
    expect(itemAt([stranger], { x: 0, y: 0 })).toBeNull();
  });

  it('still throws if something asks for it outright', () => {
    // The rest of the app has no fallback to offer, so a silent empty shape
    // would be worse than a loud failure.
    expect(() => placedShape(stranger)).toThrow(/teleporter/);
  });
});
