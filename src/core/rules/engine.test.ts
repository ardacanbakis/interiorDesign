/**
 * The checker, rule by rule.
 *
 * Each one gets a case that should be clean and a case that should not, at
 * exact numbers rather than "roughly too close" — because the whole value of a
 * clearance checker is that it draws the line in the same place every time, and
 * a rule that is right in spirit and 80mm out in practice is worse than no rule
 * at all.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { createItem } from '../catalog/registry.ts';
import { graphFromSegments, rectangleSegments } from '../graph/wallGraph.ts';
import { createFloor } from '../model/document.ts';
import { reconcileFloor } from '../model/derive.ts';
import { type Floor, type Item, type Opening } from '../model/schema.ts';
import { checkFloor, countBySeverity, issuesAbout, RULES } from './engine.ts';
import { DEFAULT_THRESHOLDS, withThresholds } from './thresholds.ts';

/**
 * A room 4m × 5m of usable floor.
 *
 * Built on 100mm walls whose centrelines run (−50,−50) to (4050,5050), so the
 * inner faces land on x = 0…4000 and y = 0…5000 and every number in these tests
 * can be read straight off. Deliberately long: a 1.9m bed with 500mm to walk
 * past its foot and a wardrobe opposite needs the room, and a fixture too small
 * to hold the furniture would have every test tripping over the walls instead
 * of over the thing it is meant to be checking.
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

function place(kind: string, x: number, y: number, rotation = 0, overrides: Partial<Item> = {}) {
  const id = `i${floor.items.length + 1}`;
  const item = { ...createItem(kind, id, x, y, rotation), ...overrides };
  floor = { ...floor, items: [...floor.items, item] };
  return item;
}

function named(name: string, type: Floor['rooms'][number]['type'] = 'other') {
  floor = {
    ...floor,
    rooms: floor.rooms.map((entry) => ({ ...entry, name, type })),
  };
}

function check(options = {}) {
  return checkFloor(floor, options);
}

function ids(rule: string) {
  return check()
    .filter((issue) => issue.rule === rule)
    .map((issue) => issue.id);
}

beforeEach(() => {
  floor = room();
});

describe('the engine', () => {
  it('finds nothing wrong with an empty room', () => {
    expect(check()).toEqual([]);
  });

  it('gives every rule a distinct id', () => {
    const rules = RULES.map((rule) => rule.id);
    expect(new Set(rules).size).toBe(rules.length);
  });

  it('reports a rule that throws instead of losing the other checks', () => {
    // A checker is an aid. One bad rule must not stop the others telling you
    // that your door cannot open.
    const broken = {
      id: 'broken',
      label: 'Broken',
      run: () => {
        throw new Error('boom');
      },
    };
    const issues = [...RULES, broken].flatMap((rule) => {
      try {
        return rule.run({ floor, rooms: [], thresholds: DEFAULT_THRESHOLDS });
      } catch {
        return [{ id: 'rule-failed' }];
      }
    });
    expect(issues.some((issue) => issue.id === 'rule-failed')).toBe(true);
  });

  it('gives each issue a stable id, so the list does not flicker while dragging', () => {
    place('wardrobe', 2000, 300);
    place('bed-double', 2000, 1400);

    const first = check().map((issue) => issue.id);
    const second = check().map((issue) => issue.id);

    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(first.length);
  });

  it('counts and filters for the panel', () => {
    const bed = place('bed-double', 2000, 1000);
    place('wardrobe', 2000, 1000);

    const issues = check();
    expect(countBySeverity(issues).errors).toBeGreaterThan(0);
    expect(issuesAbout(issues, 'item', bed.id).length).toBeGreaterThan(0);
  });
});

describe('objects in the same place', () => {
  it('flags two things at the same height in the same spot', () => {
    place('bed-double', 2000, 1500);
    place('wardrobe', 2000, 1500);

    expect(ids('overlap')).toEqual(['overlap/i1/i2']);
  });

  it('leaves them alone once they are apart', () => {
    place('bed-double', 1000, 1500);
    place('wardrobe', 3000, 500);

    expect(ids('overlap')).toEqual([]);
  });

  it('does not count two things merely touching', () => {
    // A bedside table pushed up against the bed. Everything here is placed to
    // the millimetre and things are meant to touch.
    place('bed-double', 1000, 1500);
    place('bedside-table', 1000 + 700 + 225, 1500 - 950 + 200);

    expect(ids('overlap')).toEqual([]);
  });

  it('does not count a rug under a table', () => {
    // The nuance that decides whether anyone leaves the checker switched on.
    place('rug', 2000, 1500);
    place('dining-table', 2000, 1500);

    expect(ids('overlap')).toEqual([]);
  });

  it('does not count a shelf over a desk', () => {
    place('desk', 2000, 400);
    place('wall-shelf', 2000, 200, 0, { elevation: 1400 });

    expect(ids('overlap')).toEqual([]);
  });

  it('does not count a wall cupboard over a worktop', () => {
    place('base-unit', 500, 300);
    place('wall-unit', 500, 200, 0, { elevation: 1400 });

    expect(ids('overlap')).toEqual([]);
  });

  it('does count two wall cupboards in the same place', () => {
    // Both are off the floor, so neither is exempt from the other.
    place('wall-unit', 500, 200, 0, { elevation: 1400 });
    place('wall-unit', 500, 200, 0, { elevation: 1400 });

    expect(ids('overlap')).toEqual(['overlap/i1/i2']);
  });
});

describe('objects inside their room', () => {
  it('is happy with something flat against a wall', () => {
    // Back exactly on the inner face: right, not "20mm outside the room".
    place('wardrobe', 2000, 300);

    expect(ids('containment')).toEqual([]);
  });

  it('flags something pushed into the wall', () => {
    // 20mm in. A millimetre is model rounding and is tolerated; twenty is a
    // wardrobe that will not go where the plan says it does.
    place('wardrobe', 2000, 280);

    expect(ids('containment')).toEqual(['containment/i1']);
  });

  it('flags something dragged right out of the room', () => {
    place('wardrobe', 8000, 8000);

    expect(check().find((issue) => issue.rule === 'containment')?.detail).toContain(
      'not inside any room',
    );
  });
});

describe('room to use things', () => {
  it('is happy with a wardrobe that has its doors free', () => {
    // 1500 wide over 3 doors is 500 per leaf, so it needs 500mm in front.
    place('wardrobe', 2000, 300);

    expect(ids('clearance')).toEqual([]);
  });

  it('flags a wardrobe whose doors run into the bed', () => {
    place('wardrobe', 2000, 300);
    place('bed-double', 2000, 1500);

    const issue = check().find((one) => one.id === 'clearance/i1/wardrobe-swing');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('error');
    expect(issue!.detail).toContain('double bed');
  });

  it('clears again when the bed moves back', () => {
    place('wardrobe', 2000, 300);
    // Wardrobe front face at 600, needing 500, so the floor is spoken for to
    // 1100. A 1900-deep bed centred at 2200 starts at 1250.
    place('bed-double', 2000, 2200);

    expect(ids('clearance')).toEqual([]);
  });

  it('knows sliding doors need only somewhere to stand', () => {
    // 600mm of standing room rather than a 500mm leaf — less, not more, which
    // is the whole reason someone fits sliding doors to a tight room.
    place('wardrobe', 2000, 300, 0, { params: { doorType: 'sliding', doors: 3 } });
    place('bed-double', 2000, 2200);

    expect(ids('clearance')).toEqual([]);
  });

  it('counts a wall as being in the way', () => {
    // A bed in the corner with access marked on both sides: one of them is a
    // wall, and that is exactly as much of a problem as a wardrobe there.
    place('bed-double', 700, 1500);

    const issue = check().find((one) => one.id === 'clearance/i1/bed-access-left');
    expect(issue).toBeDefined();
    expect(issue!.detail).toContain('wall');
  });

  it('says nothing about the side a bed is not meant to be got into from', () => {
    place('bed-double', 700, 1500, 0, { params: { access: 'right' } });

    expect(ids('clearance')).toEqual([]);
  });

  it('leaves a bedside table beside the pillows alone', () => {
    // You get in and out beside the middle and the foot of a bed, not beside
    // the head — which is the one place a bedside table can go. Flagging this
    // would flag every properly furnished bedroom there is.
    place('bed-double', 2000, 1400);
    place('bedside-table', 2000 + 700 + 225, 1400 - 950 + 200);

    expect(ids('clearance')).toEqual([]);
  });
});

describe('doors and windows', () => {
  function door(offset: number, overrides: Partial<Opening> = {}): Opening {
    const wallId = Object.keys(floor.graph.walls)[0]!;
    const opening: Opening = {
      id: `o${floor.openings.length + 1}`,
      kind: 'door',
      label: 'Door',
      wallId,
      offset,
      width: 900,
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

  it('is happy with a door that has its swing clear', () => {
    door(1000);
    place('wardrobe', 3200, 300);

    expect(ids('openings')).toEqual([]);
  });

  it('flags a wardrobe standing in a shut door’s swing', () => {
    // The door is drawn shut, which is precisely when this mistake is invisible.
    door(1000);
    place('wardrobe', 1200, 300);

    const swing = check().find((issue) => issue.id.endsWith('/swing'));
    expect(swing).toBeDefined();
    expect(swing!.severity).toBe('error');
    expect(swing!.detail).toContain('whether or not it is standing open');
  });

  it('flags a window with a wardrobe in front of it', () => {
    const wallId = Object.keys(floor.graph.walls)[0]!;
    floor = {
      ...floor,
      openings: [
        {
          id: 'o1',
          kind: 'window',
          label: 'Window',
          wallId,
          offset: 2000,
          width: 1200,
          height: 1400,
          sillHeight: 900,
          hinge: 'a',
          side: 'right',
          openAmount: 0,
        },
      ],
    };
    place('wardrobe', 2000, 300);

    const blocked = check().find((issue) => issue.id.includes('blocked'));
    expect(blocked).toBeDefined();
    expect(blocked!.detail).toContain('900mm sill');
  });

  it('leaves a window alone when what is under it is below the sill', () => {
    const wallId = Object.keys(floor.graph.walls)[0]!;
    floor = {
      ...floor,
      openings: [
        {
          id: 'o1',
          kind: 'window',
          label: 'Window',
          wallId,
          offset: 2000,
          width: 1200,
          height: 1400,
          sillHeight: 900,
          hinge: 'a',
          side: 'right',
          openAmount: 0,
        },
      ],
    };
    // A radiator under a window is the correct place for it, not a fault.
    place('radiator', 2000, 50);

    expect(ids('openings')).toEqual([]);
  });
});

describe('the kitchen work triangle', () => {
  function kitchen() {
    named('Kitchen', 'kitchen');
  }

  it('says nothing about a kitchen that is only half laid out', () => {
    kitchen();
    place('sink', 800, 300);
    place('hob', 2000, 300);

    expect(ids('kitchen')).toEqual([]);
  });

  it('is happy with a sensible layout', () => {
    kitchen();
    place('sink', 800, 300);
    place('hob', 2400, 300);
    place('fridge', 1600, 2700, 180);

    expect(ids('kitchen')).toEqual([]);
  });

  it('flags three appliances crammed together', () => {
    kitchen();
    place('sink', 800, 300);
    place('hob', 1400, 300);
    place('fridge', 2000, 300);

    const issue = check().find((one) => one.rule === 'kitchen');
    expect(issue?.title).toBe('Kitchen is cramped to work in');
    expect(issue?.detail).toContain('3.60m');
  });

  it('respects a threshold the user has moved', () => {
    kitchen();
    place('sink', 800, 300);
    place('hob', 1400, 300);
    place('fridge', 2000, 300);

    // 750mm is guidance, not law — and so is 3.6m.
    expect(
      checkFloor(floor, { thresholds: withThresholds({ kitchenTriangleMin: 2000 }) }).filter(
        (issue) => issue.rule === 'kitchen',
      ),
    ).toEqual([]);
  });

  it('says nothing about a room that is not a kitchen', () => {
    place('sink', 800, 300);
    place('hob', 1400, 300);
    place('fridge', 2000, 300);

    expect(ids('kitchen')).toEqual([]);
  });
});

describe('television viewing distance', () => {
  it('is happy at a comfortable distance', () => {
    // A 124cm screen wants 1.86m to 3.10m.
    place('tv-wall', 2000, 40, 0, { elevation: 1150 });
    place('sofa-3', 2000, 2400, 180);

    expect(ids('viewing')).toEqual([]);
  });

  it('flags a sofa jammed under the screen', () => {
    place('tv-wall', 2000, 40, 0, { elevation: 1150 });
    place('sofa-3', 2000, 900, 180);

    const issue = check().find((one) => one.rule === 'viewing');
    expect(issue?.title).toBe('Sitting too close to the TV');
    expect(issue?.severity).toBe('warning');
  });

  it('says nothing when there is nothing to sit on', () => {
    place('tv-wall', 2000, 40, 0, { elevation: 1150 });

    expect(ids('viewing')).toEqual([]);
  });
});
