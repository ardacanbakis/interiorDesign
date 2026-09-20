/**
 * The 3D view, as arithmetic.
 *
 * What is checked here is not how the scene looks — it is whether it describes
 * the same building the plan does. A wall with a door in it has to have a hole
 * the size of the door in it, a wardrobe has to stand where the plan says it
 * stands and be as tall as the inspector says it is, and the floor you can see
 * has to be the floor whose area the status bar is quoting. All of that is a
 * number, and every one of them is the same number the 2D view already trusts.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { area } from '../geometry/polygon.ts';
import { createItem } from '../catalog/registry.ts';
import { graphFromSegments, rectangleSegments } from '../graph/wallGraph.ts';
import { reconcileFloor, roomsOf } from '../model/derive.ts';
import { createFloor } from '../model/document.ts';
import { type Floor, type Opening } from '../model/schema.ts';
import { DEFAULT_CAMERA, type OrbitCamera } from './camera.ts';
import {
  buildScene,
  floorSolids,
  hiddenWallIds,
  itemSolids,
  openingSolids,
  planBounds,
  wallSolids,
  withoutWalls,
} from './build.ts';
import { type SceneSolid } from './types.ts';

/**
 * A room 4m × 5m of usable floor, on 100mm walls.
 *
 * Centrelines run (−50,−50) to (4050,5050), so the inner faces land on
 * x = 0…4000 and y = 0…5000 and every number below can be read straight off.
 * The same fixture the clearance engine's tests use, for the same reason.
 */
function room(): Floor {
  const floor = createFloor('f1', 0, 'Ground floor');
  return reconcileFloor({
    ...floor,
    graph: graphFromSegments(
      rectangleSegments(-50, -50, 4100, 5100, 'exterior').map((segment) => ({
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

/** The wall along the top of the plan, y = −50, running the full 4100. */
function topWall() {
  const wall = Object.values(floor.graph.walls).find((entry) => {
    const a = floor.graph.nodes[entry.a]!;
    const b = floor.graph.nodes[entry.b]!;
    return a.y === -50 && b.y === -50;
  });
  if (!wall) throw new Error('fixture has no top wall');
  return wall;
}

function addOpening(overrides: Partial<Opening> = {}): Opening {
  const opening: Opening = {
    id: `o${floor.openings.length + 1}`,
    kind: 'door',
    label: 'Door',
    wallId: topWall().id,
    offset: 2050,
    width: 800,
    height: 2050,
    sillHeight: 0,
    hinge: 'a',
    side: 'right',
    openAmount: 0,
    ...overrides,
  };
  floor = { ...floor, openings: [...floor.openings, opening] };
  return opening;
}

function place(kind: string, x: number, y: number, rotation = 0, overrides = {}) {
  const item = { ...createItem(kind, `i${floor.items.length + 1}`, x, y, rotation), ...overrides };
  floor = { ...floor, items: [...floor.items, item] };
  return item;
}

/** How much masonry a set of solids adds up to. */
function volume(solids: readonly SceneSolid[]): number {
  return solids.reduce((total, solid) => total + area(solid.base) * (solid.top - solid.bottom), 0);
}

function forWall(solids: readonly SceneSolid[], wallId: string) {
  return solids.filter((solid) => solid.hostWallId === wallId && solid.material === 'wall');
}

// ---------------------------------------------------------------------------

describe('the floor', () => {
  it('is the usable floor, the same one the status bar quotes', () => {
    const slabs = floorSolids(floor);
    expect(slabs).toHaveLength(1);
    expect(area(slabs[0]!.base)).toBeCloseTo(4000 * 5000, 6);
    expect(area(slabs[0]!.base)).toBeCloseTo(roomsOf(floor)[0]!.geometry.area, 6);
  });

  it('is a slab under the room, not a sheet at zero', () => {
    const slab = floorSolids(floor)[0]!;
    expect(slab.top).toBe(0);
    expect(slab.bottom).toBe(-floor.slabThickness);
  });

  it('carries the room it belongs to, so clicking it in 3D selects the room', () => {
    expect(floorSolids(floor)[0]!.source).toEqual({ kind: 'room', id: floor.rooms[0]!.id });
  });

  it('gives an L-shaped room an L-shaped floor', () => {
    floor = reconcileFloor({
      ...floor,
      graph: graphFromSegments(
        [
          { from: [0, 0] as const, to: [4000, 0] as const },
          { from: [4000, 0] as const, to: [4000, 2000] as const },
          { from: [4000, 2000] as const, to: [2000, 2000] as const },
          { from: [2000, 2000] as const, to: [2000, 4000] as const },
          { from: [2000, 4000] as const, to: [0, 4000] as const },
          { from: [0, 4000] as const, to: [0, 0] as const },
        ].map((segment) => ({ ...segment, kind: 'exterior' as const, thickness: 100 })),
      ),
    });

    const slab = floorSolids(floor)[0]!;
    expect(slab.base.length).toBe(6);
  });
});

describe('walls', () => {
  it('stand from the floor to the ceiling', () => {
    for (const solid of wallSolids(floor)) {
      expect(solid.bottom).toBe(0);
      expect(solid.top).toBe(floor.ceilingHeight);
    }
  });

  it('are one piece each when nothing is cut out of them', () => {
    expect(wallSolids(floor)).toHaveLength(4);
  });

  it('are as thick as the graph says', () => {
    const solids = forWall(wallSolids(floor), topWall().id);
    // 4100 long, 100 thick, 2700 high.
    expect(volume(solids)).toBeCloseTo(4100 * 100 * 2700, 3);
  });
});

describe('walls with a door in them', () => {
  it('become two piers and a lintel', () => {
    const door = addOpening();
    const pieces = forWall(wallSolids(floor), door.wallId);

    expect(pieces).toHaveLength(3);
    const heights = pieces.map((piece) => `${piece.bottom}-${piece.top}`).sort();
    expect(heights).toEqual(['0-2700', '0-2700', '2050-2700']);
  });

  it('lose exactly the volume of the doorway', () => {
    const door = addOpening();
    const pieces = forWall(wallSolids(floor), door.wallId);

    const solid = 4100 * 100 * 2700;
    const hole = door.width * 100 * door.height;
    expect(volume(pieces)).toBeCloseTo(solid - hole, 3);
  });

  it('put the hole where the door is, not in the middle', () => {
    // Offset 600 from the wall's `a` node on a 4100 wall, so the doorway runs
    // 200 to 1000 and leaves piers of 200 and 3100.
    const door = addOpening({ offset: 600 });
    const pieces = forWall(wallSolids(floor), door.wallId);

    const lengths = pieces
      .filter((piece) => piece.bottom === 0)
      .map((piece) => Math.round(area(piece.base) / 100))
      .sort((a, b) => a - b);

    expect(lengths).toEqual([200, 3100]);
  });

  it('keep a full-height pier on one side when the door is hard against a corner', () => {
    const door = addOpening({ offset: 400, width: 800 });
    const pieces = forWall(wallSolids(floor), door.wallId);

    // The doorway starts at zero, so there is no pier before it.
    expect(pieces.filter((piece) => piece.bottom === 0)).toHaveLength(1);
    expect(volume(pieces)).toBeCloseTo(4100 * 100 * 2700 - 800 * 100 * 2050, 3);
  });

  it('have no lintel when the opening reaches the ceiling', () => {
    const door = addOpening({ height: floor.ceilingHeight });
    const pieces = forWall(wallSolids(floor), door.wallId);

    expect(pieces.every((piece) => piece.bottom === 0)).toBe(true);
    expect(pieces).toHaveLength(2);
  });
});

describe('walls with a window in them', () => {
  it('get a lintel above and an apron below', () => {
    const window = addOpening({
      kind: 'window',
      width: 1200,
      height: 1400,
      sillHeight: 900,
    });

    const pieces = forWall(wallSolids(floor), window.wallId);
    const spans = pieces.map((piece) => `${piece.bottom}-${piece.top}`).sort();

    expect(spans).toEqual(['0-2700', '0-2700', '0-900', '2300-2700']);
  });

  it('lose exactly the volume of the window', () => {
    const window = addOpening({ kind: 'window', width: 1200, height: 1400, sillHeight: 900 });
    const pieces = forWall(wallSolids(floor), window.wallId);

    expect(volume(pieces)).toBeCloseTo(4100 * 100 * 2700 - 1200 * 100 * 1400, 3);
  });
});

describe('walls with several openings', () => {
  it('handle two of them without losing the wall between', () => {
    addOpening({ offset: 800, width: 800 });
    addOpening({ offset: 3000, width: 800, kind: 'window', height: 1400, sillHeight: 900 });

    const pieces = forWall(wallSolids(floor), topWall().id);
    const solid = 4100 * 100 * 2700;
    expect(volume(pieces)).toBeCloseTo(solid - 800 * 100 * 2050 - 800 * 100 * 1400, 3);
  });

  it('merge two that overlap rather than building masonry inside masonry', () => {
    // The clearance checker complains about this; the renderer must still
    // produce something sane rather than a wall with a negative piece in it.
    addOpening({ offset: 1000, width: 1000, height: 2050 });
    addOpening({ offset: 1400, width: 1000, height: 2050 });

    const pieces = forWall(wallSolids(floor), topWall().id);
    for (const piece of pieces) {
      expect(piece.top).toBeGreaterThan(piece.bottom);
      expect(area(piece.base)).toBeGreaterThan(0);
    }

    // The gap runs 500 to 1900 — 1400 long — however the two are counted.
    const solid = 4100 * 100 * 2700;
    expect(volume(pieces)).toBeCloseTo(solid - 1400 * 100 * 2050, 3);
  });
});

describe('what fills the openings', () => {
  it('hangs a leaf in a door, as long as the opening is wide', () => {
    const door = addOpening({ width: 900 });
    const leaf = openingSolids(floor).find((solid) => solid.id.endsWith(':leaf'))!;

    expect(leaf.bottom).toBe(0);
    expect(leaf.top).toBe(door.height);
    // 900 long and 40 thick.
    expect(area(leaf.base)).toBeCloseTo(900 * 40, 3);
  });

  it('moves the leaf as the door opens', () => {
    addOpening({ width: 900, openAmount: 0 });
    const shut = openingSolids(floor)[0]!.base.map((point) => point.y);

    floor = {
      ...floor,
      openings: floor.openings.map((opening) => ({ ...opening, openAmount: 1 })),
    };
    const open = openingSolids(floor)[0]!.base.map((point) => point.y);

    // Shut, the leaf lies along the wall at y = −50; open, it stands out
    // into the room.
    expect(Math.max(...shut)).toBeLessThan(100);
    expect(Math.max(...open)).toBeGreaterThan(800);
  });

  it('glazes a window and puts a board under it', () => {
    const window = addOpening({ kind: 'window', width: 1200, height: 1400, sillHeight: 900 });
    const solids = openingSolids(floor);

    const glass = solids.find((solid) => solid.material === 'glass')!;
    expect(glass.bottom).toBe(window.sillHeight);
    expect(glass.top).toBe(window.sillHeight + window.height);

    const sill = solids.find((solid) => solid.material === 'sill')!;
    expect(sill.top).toBe(window.sillHeight);
    expect(sill.bottom).toBeLessThan(window.sillHeight);
  });

  it('leaves a doorway empty — that is what a doorway is', () => {
    addOpening({ kind: 'opening' });
    expect(openingSolids(floor)).toEqual([]);
  });

  it('remembers which wall everything is hung on', () => {
    const window = addOpening({ kind: 'window', sillHeight: 900, height: 1400 });
    for (const solid of openingSolids(floor)) {
      expect(solid.hostWallId).toBe(window.wallId);
    }
  });
});

describe('furniture', () => {
  it('stands where the plan says it stands', () => {
    place('wardrobe', 2000, 300);

    const solids = itemSolids(floor);
    expect(solids.length).toBeGreaterThan(0);

    const xs = solids.flatMap((solid) => solid.base.map((point) => point.x));
    const ys = solids.flatMap((solid) => solid.base.map((point) => point.y));

    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(2000, 6);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(300, 6);
  });

  it('is exactly as tall as the item says it is', () => {
    const wardrobe = place('wardrobe', 2000, 300);
    const solids = itemSolids(floor);

    expect(Math.max(...solids.map((solid) => solid.top))).toBeCloseTo(wardrobe.height, 6);
    expect(Math.min(...solids.map((solid) => solid.bottom))).toBeCloseTo(0, 6);
  });

  it('turns with the item', () => {
    const upright = place('wardrobe', 2000, 1000, 0);
    const turned = place('wardrobe', 2000, 3000, 90);

    const spans = (id: string) => {
      const solids = itemSolids(floor).filter((solid) => solid.id.startsWith(`item:${id}:`));
      const xs = solids.flatMap((solid) => solid.base.map((point) => point.x));
      const ys = solids.flatMap((solid) => solid.base.map((point) => point.y));
      return { x: Math.max(...xs) - Math.min(...xs), y: Math.max(...ys) - Math.min(...ys) };
    };

    // A wardrobe is wider than it is deep; a quarter turn swaps that over.
    expect(spans(upright.id).x).toBeCloseTo(spans(turned.id).y, 3);
    expect(spans(upright.id).y).toBeCloseTo(spans(turned.id).x, 3);
  });

  it('lifts anything mounted off the floor by its elevation', () => {
    const shelf = place('wall-shelf', 2000, 200, 0, { elevation: 1400 });
    const solids = itemSolids(floor);

    expect(Math.min(...solids.map((solid) => solid.bottom))).toBeCloseTo(1400, 6);
    expect(Math.max(...solids.map((solid) => solid.top))).toBeCloseTo(1400 + shelf.height, 6);
  });

  it('keeps the catalogue material, so a mattress is not drawn as a cupboard', () => {
    place('bed-double', 2000, 2000);
    const materials = new Set(itemSolids(floor).map((solid) => solid.material));
    expect(materials.has('soft')).toBe(true);
  });

  it('leaves out a kind this build has never heard of', () => {
    place('wardrobe', 2000, 300);
    floor = {
      ...floor,
      items: [...floor.items, { ...floor.items[0]!, id: 'i99', kind: 'teleporter' }],
    };

    // The plan draws what it can and skips the rest rather than taking the
    // whole canvas down; so does this.
    expect(() => itemSolids(floor)).not.toThrow();
    expect(
      itemSolids(floor).every((solid) => solid.source.kind === 'item' && solid.source.id === 'i1'),
    ).toBe(true);
  });
});

describe('the scene as a whole', () => {
  it('has a floor, four walls, the door and the furniture in it', () => {
    addOpening();
    place('wardrobe', 2000, 300);

    const scene = buildScene(floor);
    const kinds = new Set(scene.map((solid) => solid.source.kind));

    expect(kinds).toEqual(new Set(['none', 'room', 'wall', 'opening', 'item']));
  });

  it('gives every solid a distinct id, so the renderer can keep them apart', () => {
    addOpening();
    addOpening({ offset: 3200, kind: 'window', sillHeight: 900, height: 1400 });
    place('wardrobe', 2000, 300);
    place('bed-double', 2000, 3000);

    const scene = buildScene(floor);
    expect(new Set(scene.map((solid) => solid.id)).size).toBe(scene.length);
  });

  it('can be built without the ground, for a plan that is only a room', () => {
    expect(buildScene(floor, { ground: false }).some((solid) => solid.id === 'ground')).toBe(false);
  });

  it('drops anything with no substance rather than handing the renderer a sliver', () => {
    place('rug', 2000, 2000, 0, { height: 0 });
    expect(buildScene(floor).some((solid) => solid.top === solid.bottom)).toBe(false);
  });

  it('is empty but for the ground when nothing has been drawn', () => {
    const blank = createFloor('f2', 0, 'Empty');
    expect(buildScene(blank)).toEqual([]);
    expect(planBounds(blank)).toBeNull();
  });
});

describe('the cutaway', () => {
  function camera(overrides: Partial<OrbitCamera> = {}): OrbitCamera {
    return {
      ...DEFAULT_CAMERA,
      target: { x: 2000, y: 2500, z: 900 },
      yaw: 0,
      pitch: (30 * Math.PI) / 180,
      ...overrides,
    };
  }

  it('takes away the wall you would be looking through', () => {
    // At yaw zero the camera stands past y = 2500, so the near wall is the
    // one at the bottom of the plan.
    const hidden = hiddenWallIds(floor, camera());
    expect(hidden.size).toBe(1);

    const wallId = [...hidden][0]!;
    const wall = floor.graph.walls[wallId]!;
    expect(floor.graph.nodes[wall.a]!.y).toBe(5050);
  });

  it('keeps the walls running edge-on, so they do not flicker as you orbit', () => {
    // Those two sit exactly on the boundary of the rule; a rule that hid them
    // would strobe as the camera passed.
    expect(hiddenWallIds(floor, camera()).size).toBe(1);
  });

  it('takes away two walls once the view is properly diagonal', () => {
    expect(hiddenWallIds(floor, camera({ yaw: -Math.PI / 4 })).size).toBe(2);
  });

  it('hides nothing when you are looking almost straight down', () => {
    // From above you are already over the tops of the walls.
    expect(hiddenWallIds(floor, camera({ pitch: (85 * Math.PI) / 180 })).size).toBe(0);
  });

  it('takes a door away with the wall it is hung on', () => {
    // Otherwise the leaf is left hanging in mid-air where its wall used to be,
    // which is a worse picture than no cutaway at all.
    const bottomWall = Object.values(floor.graph.walls).find(
      (entry) => floor.graph.nodes[entry.a]!.y === 5050 && floor.graph.nodes[entry.b]!.y === 5050,
    )!;
    addOpening({ wallId: bottomWall.id, offset: 2050 });

    const scene = buildScene(floor);
    const visible = withoutWalls(scene, hiddenWallIds(floor, camera()));

    expect(scene.some((solid) => solid.material === 'door-leaf')).toBe(true);
    expect(visible.some((solid) => solid.material === 'door-leaf')).toBe(false);
  });

  it('leaves the floor and the furniture alone', () => {
    place('wardrobe', 2000, 300);
    const visible = withoutWalls(buildScene(floor), hiddenWallIds(floor, camera()));

    expect(visible.some((solid) => solid.source.kind === 'room')).toBe(true);
    expect(visible.some((solid) => solid.source.kind === 'item')).toBe(true);
  });

  it('changes nothing when it is switched off', () => {
    const scene = buildScene(floor);
    expect(withoutWalls(scene, new Set())).toEqual(scene);
  });
});
