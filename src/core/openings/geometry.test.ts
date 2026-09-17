import { describe, expect, it } from 'vitest';

import { containsPoint } from '../geometry/polygon.ts';
import { distance, vec2 } from '../geometry/vec2.ts';
import { getWall, graphFromSegments, type WallGraph } from '../graph/wallGraph.ts';
import { type Opening } from '../model/schema.ts';
import { clampOffset, doorSwing, fitsOnWall, maxOpeningWidth, openingFrame } from './geometry.ts';

/** A single 4m wall running left to right along y = 0. */
const wall = graphFromSegments([{ from: [0, 0], to: [4000, 0], thickness: 100 }]);

function door(overrides: Partial<Opening> = {}): Opening {
  return {
    id: 'o1',
    kind: 'door',
    label: 'Door',
    wallId: 'w1',
    offset: 1000,
    width: 900,
    height: 2050,
    sillHeight: 0,
    hinge: 'a',
    side: 'right',
    openAmount: 0,
    ...overrides,
  };
}

const frameOf = (graph: WallGraph, opening: Opening) =>
  openingFrame(graph, getWall(graph, opening.wallId), opening);

describe('openingFrame', () => {
  it('centres the opening at its offset along the wall', () => {
    const frame = frameOf(wall, door({ offset: 1000, width: 900 }));

    expect(frame.centre).toEqual({ x: 1000, y: 0 });
    expect(frame.startPoint).toEqual({ x: 550, y: 0 });
    expect(frame.endPoint).toEqual({ x: 1450, y: 0 });
  });

  it('points `along` from a to b and `across` to its right', () => {
    // Y is down, so the right-hand side of a rightward wall is downwards.
    const frame = frameOf(wall, door());

    expect(frame.along).toEqual({ x: 1, y: 0 });
    expect(frame.across).toEqual({ x: 0, y: 1 });
  });

  it('cuts a hole spanning the opening and the full wall thickness', () => {
    const frame = frameOf(wall, door({ offset: 2000, width: 900 }));

    const xs = frame.cutout.map((point) => point.x);
    const ys = frame.cutout.map((point) => point.y);

    expect(Math.min(...xs)).toBe(1550);
    expect(Math.max(...xs)).toBe(2450);
    // A shade proud of both faces, so no hairline of wall survives at a reveal.
    expect(Math.min(...ys)).toBeLessThanOrEqual(-50);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(50);
  });

  it('follows a wall running the other way', () => {
    const vertical = graphFromSegments([{ from: [1000, 0], to: [1000, 3000], thickness: 100 }]);
    const frame = frameOf(vertical, door({ offset: 1500, width: 900 }));

    expect(frame.centre).toEqual({ x: 1000, y: 1500 });
    expect(frame.along).toEqual({ x: 0, y: 1 });
    // Right of "down" is to the left on screen.
    expect(frame.across).toEqual({ x: -1, y: 0 });
  });
});

describe('doorSwing', () => {
  const swingOf = (opening: Opening) => doorSwing(wall, getWall(wall, opening.wallId), opening);

  it('hinges at the end nearest the wall node it names', () => {
    expect(swingOf(door({ hinge: 'a' })).hinge).toEqual({ x: 550, y: 0 });
    expect(swingOf(door({ hinge: 'b' })).hinge).toEqual({ x: 1450, y: 0 });
  });

  it('lies in the opening when shut', () => {
    const shut = swingOf(door({ hinge: 'a', openAmount: 0 }));
    expect(shut.leafEnd).toEqual({ x: 1450, y: 0 });
  });

  it('stands square to the wall when fully open', () => {
    const open = swingOf(door({ hinge: 'a', side: 'right', openAmount: 1 }));

    // Hinged at x=550, swung to the right-hand side, which is +y.
    expect(open.leafEnd.x).toBeCloseTo(550);
    expect(open.leafEnd.y).toBeCloseTo(900);
  });

  it('swings to the other face when the side is flipped', () => {
    const open = swingOf(door({ hinge: 'a', side: 'left', openAmount: 1 }));

    expect(open.leafEnd.x).toBeCloseTo(550);
    expect(open.leafEnd.y).toBeCloseTo(-900);
  });

  it('covers all four ways a door can be hung, each landing somewhere different', () => {
    const ends = (['a', 'b'] as const).flatMap((hinge) =>
      (['left', 'right'] as const).map((side) => {
        const swing = swingOf(door({ hinge, side, openAmount: 1 }));
        return `${Math.round(swing.leafEnd.x)},${Math.round(swing.leafEnd.y)}`;
      }),
    );

    expect(new Set(ends).size).toBe(4);
  });

  it('keeps the leaf the length of the opening at every angle', () => {
    for (const openAmount of [0, 0.25, 0.5, 0.75, 1]) {
      const swing = swingOf(door({ openAmount, width: 900 }));
      expect(distance(swing.hinge, swing.leafEnd)).toBeCloseTo(900, 6);
    }
  });

  it('sweeps the whole quarter circle even while the door is shut', () => {
    // A shut door still needs room to open, so the clearance check has to see
    // the full sweep — this is what catches a wardrobe in a closed door's path.
    const shut = swingOf(door({ hinge: 'a', side: 'right', openAmount: 0 }));

    // A point halfway round, well inside the quarter circle.
    expect(containsPoint(shut.sector, vec2(550 + 400, 400))).toBe(true);
    // And one on the far side of the wall, which the door never reaches.
    expect(containsPoint(shut.sector, vec2(550 + 400, -400))).toBe(false);
  });

  it('puts the sector on the side the door opens to', () => {
    const right = swingOf(door({ hinge: 'a', side: 'right', openAmount: 0 }));
    const left = swingOf(door({ hinge: 'a', side: 'left', openAmount: 0 }));

    expect(containsPoint(right.sector, vec2(800, 300))).toBe(true);
    expect(containsPoint(left.sector, vec2(800, 300))).toBe(false);
    expect(containsPoint(left.sector, vec2(800, -300))).toBe(true);
  });

  it('turns whichever way takes the shut leaf to the open one', () => {
    // The direction is not a choice; it falls out of the hinge and the side.
    expect(swingOf(door({ hinge: 'a', side: 'right' })).sweep).toBe(1);
    expect(swingOf(door({ hinge: 'a', side: 'left' })).sweep).toBe(-1);
    expect(swingOf(door({ hinge: 'b', side: 'right' })).sweep).toBe(-1);
    expect(swingOf(door({ hinge: 'b', side: 'left' })).sweep).toBe(1);
  });
});

describe('clampOffset', () => {
  it('keeps the opening inside the wall', () => {
    // A 900 door on a 4000 wall: its centre can be anywhere from 450 to 3550.
    expect(clampOffset(4000, 900, 2000)).toBe(2000);
    expect(clampOffset(4000, 900, 0)).toBe(450);
    expect(clampOffset(4000, 900, 4000)).toBe(3550);
  });

  it('centres an opening on a wall too short to hold it', () => {
    expect(clampOffset(700, 900, 0)).toBe(350);
  });

  it('rounds to a whole millimetre', () => {
    expect(Number.isInteger(clampOffset(4000, 900, 1234.6))).toBe(true);
  });
});

describe('fitsOnWall / maxOpeningWidth', () => {
  it('knows what will go on a wall', () => {
    expect(fitsOnWall(4000, 900)).toBe(true);
    expect(fitsOnWall(800, 900)).toBe(false);
    expect(fitsOnWall(4000, 0)).toBe(false);
  });

  it('reports the widest that would fit', () => {
    expect(maxOpeningWidth(4000)).toBe(4000);
    expect(maxOpeningWidth(0)).toBe(0);
  });
});
