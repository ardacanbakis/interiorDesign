import { describe, expect, it } from 'vitest';

import { vec2 } from '../geometry/vec2.ts';
import {
  getWall,
  graphFromSegments,
  insertWall,
  rectangleSegments,
  wallLength,
  type WallGraph,
} from '../graph/wallGraph.ts';
import { type Opening } from '../model/schema.ts';
import { openingFrame } from './geometry.ts';
import { rehomeMerged, rehomeOpenings } from './rehome.ts';
import { type WallMerge } from '../graph/weld.ts';

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

/** Where an opening actually sits in the world, for before/after comparison. */
function positionOf(graph: WallGraph, opening: Opening) {
  return openingFrame(graph, getWall(graph, opening.wallId), opening).centre;
}

describe('rehomeOpenings', () => {
  it('does nothing when no walls were split', () => {
    const openings = [door()];
    const result = rehomeOpenings(openings, []);

    expect(result.openings).toBe(openings);
    expect(result.moved).toHaveLength(0);
    expect(result.dropped).toHaveLength(0);
  });

  it('moves a door onto the half of the wall it now sits on', () => {
    // A 4m wall with a door at 1000, cut at 2000.
    const before = graphFromSegments([{ from: [0, 0], to: [4000, 0], thickness: 100 }]);
    const original = door({ offset: 1000 });
    const worldBefore = positionOf(before, original);

    const { graph, splits } = insertWall(before, vec2(2000, 0), vec2(2000, 1500));
    const result = rehomeOpenings([original], splits);

    const moved = result.openings[0]!;
    expect(moved.wallId).not.toBe('w1');
    expect(graph.walls[moved.wallId]).toBeDefined();

    // The door has not gone anywhere in the world; only its address changed.
    expect(positionOf(graph, moved)).toEqual(worldBefore);
    expect(result.dropped).toHaveLength(0);
  });

  it('moves a door on the far half and rebases its offset', () => {
    const before = graphFromSegments([{ from: [0, 0], to: [4000, 0], thickness: 100 }]);
    const original = door({ offset: 3000 });
    const worldBefore = positionOf(before, original);

    const { graph, splits } = insertWall(before, vec2(2000, 0), vec2(2000, 1500));
    const moved = rehomeOpenings([original], splits).openings[0]!;

    // Measured from the new half's own start, not the original wall's.
    expect(moved.offset).toBe(1000);
    expect(positionOf(graph, moved)).toEqual(worldBefore);
  });

  it('leaves openings on other walls alone', () => {
    const before = graphFromSegments(rectangleSegments(0, 0, 4000, 3000));
    const elsewhere = door({ id: 'o2', wallId: 'w2', offset: 1000 });

    const { splits } = insertWall(before, vec2(2000, 0), vec2(2000, 3000));
    const result = rehomeOpenings([elsewhere], splits);

    expect(result.openings[0]).toBe(elsewhere);
  });

  it('survives the same wall being split twice', () => {
    // Two partitions drawn across one wall. The second split refers to a part
    // produced by the first, so the records have to be applied in order.
    let graph = graphFromSegments([{ from: [0, 0], to: [6000, 0], thickness: 100 }]);
    const original = door({ offset: 5000 });
    const worldBefore = positionOf(graph, original);

    const first = insertWall(graph, vec2(2000, 0), vec2(2000, 1500));
    graph = first.graph;
    const second = insertWall(graph, vec2(4000, 0), vec2(4000, 1500));
    graph = second.graph;

    const result = rehomeOpenings([original], [...first.splits, ...second.splits]);
    const moved = result.openings[0]!;

    expect(graph.walls[moved.wallId]).toBeDefined();
    expect(positionOf(graph, moved)).toEqual(worldBefore);
    // It ended up on the last 2m stretch, 1m along it.
    expect(moved.offset).toBe(1000);
  });

  it('nudges a door that no longer fits where it was', () => {
    // A 900 door centred at 400 on a 4m wall, cut at 1000. Its half is only
    // 1000 long, so the door has to slide to stay inside it.
    const before = graphFromSegments([{ from: [0, 0], to: [4000, 0], thickness: 100 }]);
    const original = door({ offset: 400, width: 900 });

    const { graph, splits } = insertWall(before, vec2(1000, 0), vec2(1000, 1500));
    const result = rehomeOpenings([original], splits);

    const moved = result.openings[0]!;
    expect(result.moved).toEqual(['o1']);
    expect(moved.offset).toBe(450);

    // And it really is inside its new wall now.
    const length = wallLength(graph, getWall(graph, moved.wallId));
    expect(moved.offset - moved.width / 2).toBeGreaterThanOrEqual(0);
    expect(moved.offset + moved.width / 2).toBeLessThanOrEqual(length);
  });

  it('drops a door no half of the wall can hold, and says which', () => {
    // A 900 door on a wall cut 300 from the end: neither piece is wide enough
    // for it on the short side, and the door's centre is on that side.
    const before = graphFromSegments([{ from: [0, 0], to: [4000, 0], thickness: 100 }]);
    const original = door({ offset: 200, width: 900 });

    const { splits } = insertWall(before, vec2(300, 0), vec2(300, 1500));
    const result = rehomeOpenings([original], splits);

    expect(result.openings).toHaveLength(0);
    // Reported rather than silently discarded — a door vanishing from a plan is
    // something the person who drew it needs to be told.
    expect(result.dropped).toEqual(['o1']);
    expect(result.moved).toHaveLength(0);
  });

  it('sends an opening straddling the cut to the side holding its middle', () => {
    const before = graphFromSegments([{ from: [0, 0], to: [4000, 0], thickness: 100 }]);
    // Spans 1550-2450; the cut at 1600 is inside it, but its centre is past it.
    const original = door({ offset: 2000, width: 900 });

    const { graph, splits } = insertWall(before, vec2(1600, 0), vec2(1600, 1500));
    const moved = rehomeOpenings([original], splits).openings[0]!;

    const length = wallLength(graph, getWall(graph, moved.wallId));
    expect(length).toBe(2400);
    expect(moved.offset).toBe(450);
  });

  it('handles several openings on one wall at once', () => {
    const before = graphFromSegments([{ from: [0, 0], to: [6000, 0], thickness: 100 }]);
    const openings = [
      door({ id: 'o1', offset: 1000 }),
      door({ id: 'o2', offset: 2000 }),
      door({ id: 'o3', offset: 5000 }),
    ];
    const worldBefore = openings.map((opening) => positionOf(before, opening));

    const { graph, splits } = insertWall(before, vec2(3000, 0), vec2(3000, 1500));
    const result = rehomeOpenings(openings, splits);

    expect(result.openings).toHaveLength(3);
    result.openings.forEach((opening, index) => {
      expect(graph.walls[opening.wallId]).toBeDefined();
      expect(positionOf(graph, opening)).toEqual(worldBefore[index]);
    });

    // Two on the near half, one on the far.
    const hosts = new Set(result.openings.map((opening) => opening.wallId));
    expect(hosts.size).toBe(2);
  });

  it('keeps everything else about the opening', () => {
    const before = graphFromSegments([{ from: [0, 0], to: [4000, 0], thickness: 100 }]);
    const original = door({ offset: 1000, hinge: 'b', side: 'left', openAmount: 0.5 });

    const { splits } = insertWall(before, vec2(2000, 0), vec2(2000, 1500));
    const moved = rehomeOpenings([original], splits).openings[0]!;

    expect(moved).toMatchObject({
      id: 'o1',
      hinge: 'b',
      side: 'left',
      openAmount: 0.5,
      width: 900,
      height: 2050,
    });
  });
});

describe('rehomeMerged', () => {
  function merge(overrides: Partial<WallMerge> = {}): WallMerge {
    return { fromWallId: 'w1', toWallId: 'w9', reversed: false, length: 4000, ...overrides };
  }

  it('moves an opening onto the wall that survived', () => {
    const { openings } = rehomeMerged([door()], [merge()]);
    expect(openings[0]).toMatchObject({ wallId: 'w9', offset: 1000 });
  });

  it('leaves alone an opening on a wall that was not merged', () => {
    const elsewhere = door({ wallId: 'w5' });
    const { openings } = rehomeMerged([elsewhere], [merge()]);
    expect(openings[0]).toBe(elsewhere);
  });

  it('measures from the other end when the surviving wall runs the other way', () => {
    const { openings } = rehomeMerged([door({ offset: 1000 })], [merge({ reversed: true })]);
    expect(openings[0]).toMatchObject({ wallId: 'w9', offset: 3000 });
  });

  it('turns the hinge and the swing round with it', () => {
    // The part that is easy to forget and impossible to miss once it is wrong:
    // hinge and side are both measured from the wall's own a-to-b direction,
    // so a wall pointing the other way puts the door on the wrong side of the
    // opening, swinging into the room next door.
    const { openings } = rehomeMerged(
      [door({ hinge: 'a', side: 'right' })],
      [merge({ reversed: true })],
    );

    expect(openings[0]).toMatchObject({ hinge: 'b', side: 'left' });
  });

  it('leaves the hinge alone when the wall runs the same way', () => {
    const { openings } = rehomeMerged([door({ hinge: 'a', side: 'right' })], [merge()]);
    expect(openings[0]).toMatchObject({ hinge: 'a', side: 'right' });
  });

  it('nudges an opening that would now hang off the end, and says it did', () => {
    const result = rehomeMerged([door({ offset: 3900, width: 900 })], [merge()]);
    expect(result.openings[0]!.offset).toBe(3550);
    expect(result.moved).toEqual(['o1']);
  });

  it('drops an opening wider than the wall it is moving to, and says so', () => {
    const result = rehomeMerged([door({ width: 1200 })], [merge({ length: 1000 })]);
    expect(result.openings).toEqual([]);
    expect(result.dropped).toEqual(['o1']);
  });

  it('does nothing at all when nothing merged', () => {
    const openings = [door()];
    expect(rehomeMerged(openings, []).openings).toBe(openings);
  });
});
