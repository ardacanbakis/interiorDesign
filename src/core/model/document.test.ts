import { describe, expect, it } from 'vitest';

import { graphFromSegments, rectangleSegments } from '../graph/wallGraph.ts';
import {
  createDocument,
  createFloor,
  findFloor,
  findItem,
  findOpening,
  floorBelow,
  floorsByLevel,
  floorToFloorHeight,
  getFloor,
  graphsByFloor,
  stairsTouchingFloor,
} from './document.ts';
import { type Floor, type HouseDocument, type Item, type Opening, type Stair } from './schema.ts';

function house(): HouseDocument {
  const base = createDocument({
    name: 'Ev',
    now: () => new Date('2026-03-04T10:00:00.000Z'),
    newId: () => 'ground',
  });

  return {
    ...base,
    floors: [
      { ...base.floors[0]!, id: 'ground' },
      createFloor('first', 1, 'First floor'),
      createFloor('basement', -1, 'Basement'),
    ],
    stairs: [stair('s1', 'ground', 'first'), stair('s2', 'basement', 'ground')],
  };
}

function stair(id: string, fromFloorId: string, toFloorId: string): Stair {
  return {
    id,
    label: 'Stair',
    fromFloorId,
    toFloorId,
    kind: 'straight',
    x: 0,
    y: 0,
    rotation: 0,
    width: 1000,
    riserCount: 16,
    going: 280,
  };
}

const door: Opening = {
  id: 'o1',
  kind: 'door',
  label: 'Door',
  wallId: 'w1',
  offset: 500,
  width: 900,
  height: 2050,
  sillHeight: 0,
  hinge: 'a',
  side: 'right',
  openAmount: 0,
};

const bed: Item = {
  id: 'i1',
  kind: 'bed',
  label: 'Bed',
  x: 1000,
  y: 1000,
  rotation: 0,
  width: 1600,
  depth: 2000,
  height: 900,
  elevation: 0,
  mount: 'floor',
  params: {},
};

describe('findFloor / getFloor', () => {
  it('finds a floor by id', () => {
    expect(findFloor(house(), 'first')?.name).toBe('First floor');
  });

  it('returns null for one that is not there', () => {
    expect(findFloor(house(), 'attic')).toBeNull();
  });

  it('getFloor fails loudly, because a dangling id means a broken document', () => {
    expect(() => getFloor(house(), 'attic')).toThrow(/inconsistent/);
    expect(getFloor(house(), 'ground').id).toBe('ground');
  });
});

describe('floorsByLevel', () => {
  it('orders from the bottom up', () => {
    expect(floorsByLevel(house()).map((floor) => floor.id)).toEqual([
      'basement',
      'ground',
      'first',
    ]);
  });

  it('does not reorder the document itself', () => {
    const document = house();
    floorsByLevel(document);
    expect(document.floors.map((floor) => floor.id)).toEqual(['ground', 'first', 'basement']);
  });
});

describe('floorBelow', () => {
  it('finds the floor immediately underneath', () => {
    expect(floorBelow(house(), 'first')?.id).toBe('ground');
    expect(floorBelow(house(), 'ground')?.id).toBe('basement');
  });

  it('returns null at the bottom of the house', () => {
    expect(floorBelow(house(), 'basement')).toBeNull();
  });

  it('returns null for a floor that is not there', () => {
    expect(floorBelow(house(), 'attic')).toBeNull();
  });

  it('skips a gap in the levels', () => {
    const document = house();
    const sparse: HouseDocument = {
      ...document,
      floors: [createFloor('a', 0, 'Ground'), createFloor('c', 5, 'Roof')],
    };
    expect(floorBelow(sparse, 'c')?.id).toBe('a');
  });
});

describe('floorToFloorHeight', () => {
  it('adds the slab to the ceiling height — what a stair has to climb', () => {
    const floor = createFloor('f', 0, 'Ground floor');
    expect(floorToFloorHeight(floor)).toBe(floor.ceilingHeight + floor.slabThickness);
    expect(floorToFloorHeight(floor)).toBe(2850);
  });

  it('follows an unusual ceiling height', () => {
    expect(floorToFloorHeight(createFloor('f', 0, 'Tall', { ceilingHeight: 3200 }))).toBe(3350);
  });
});

describe('findOpening / findItem', () => {
  const floor: Floor = { ...createFloor('f', 0, 'Ground'), openings: [door], items: [bed] };

  it('finds what is there', () => {
    expect(findOpening(floor, 'o1')).toBe(door);
    expect(findItem(floor, 'i1')).toBe(bed);
  });

  it('returns null for what is not', () => {
    expect(findOpening(floor, 'nope')).toBeNull();
    expect(findItem(floor, 'nope')).toBeNull();
  });
});

describe('stairsTouchingFloor', () => {
  it('finds stairs arriving at or leaving from a floor', () => {
    // The ground floor has one going up and one coming from the basement.
    expect(
      stairsTouchingFloor(house(), 'ground')
        .map((s) => s.id)
        .sort(),
    ).toEqual(['s1', 's2']);
    expect(stairsTouchingFloor(house(), 'first').map((s) => s.id)).toEqual(['s1']);
  });

  it('finds none where there are none', () => {
    const document = { ...house(), stairs: [] };
    expect(stairsTouchingFloor(document, 'ground')).toHaveLength(0);
  });
});

describe('graphsByFloor', () => {
  it('maps every floor to its graph', () => {
    const document = house();
    document.floors[0] = {
      ...document.floors[0]!,
      graph: graphFromSegments(rectangleSegments(0, 0, 3000, 3000, 'exterior')),
    };

    const graphs = graphsByFloor(document);

    expect(graphs.size).toBe(3);
    expect(Object.keys(graphs.get('ground')!.walls)).toHaveLength(4);
    expect(Object.keys(graphs.get('first')!.walls)).toHaveLength(0);
  });
});
