import { beforeEach, describe, expect, it } from 'vitest';

import { extractFaces } from '../core/graph/faces.ts';
import {
  graphFromSegments,
  insertWall,
  rectangleSegments,
  removeWall,
} from '../core/graph/wallGraph.ts';
import { vec2 } from '../core/geometry/vec2.ts';
import { createDocument, createFloor } from '../core/model/document.ts';
import { roomsOf } from '../core/model/derive.ts';
import { useEditorStore } from './store.ts';

const store = () => useEditorStore.getState();

/** Put a 6m x 3m shell on the active floor. */
function drawShell() {
  store().commit('Draw shell', (draft) => {
    draft.floors[0]!.graph = graphFromSegments(rectangleSegments(0, 0, 6000, 3000, 'exterior'));
  });
}

/** Divide the shell in two at x. */
function divideAt(x: number) {
  store().commit('Divide', (draft) => {
    const floor = draft.floors[0]!;
    floor.graph = insertWall(floor.graph, vec2(x, 0), vec2(x, 3000), { kind: 'interior' }).graph;
  });
}

beforeEach(() => {
  useEditorStore.getState().newDocument();
  // The store is a module singleton and `newDocument` deliberately leaves the
  // editor's own preferences alone — they are not document state. Tests do have
  // to reset them, or one that arms the catalogue leaks into the next.
  useEditorStore.setState({ tool: 'select', placeItemKind: null });
});

describe('store — starting state', () => {
  it('opens on an empty ground floor', () => {
    expect(store().document.floors).toHaveLength(1);
    expect(store().activeFloorId).toBe(store().document.floors[0]!.id);
    expect(store().dirty).toBe(false);
    expect(store().canUndo()).toBe(false);
  });
});

describe('store — commit', () => {
  it('applies a change and marks the document dirty', () => {
    drawShell();

    expect(Object.keys(store().document.floors[0]!.graph.walls)).toHaveLength(4);
    expect(store().dirty).toBe(true);
    expect(store().canUndo()).toBe(true);
    expect(store().undoLabel()).toBe('Draw shell');
  });

  it('ignores a change that changes nothing', () => {
    drawShell();
    const before = store().document;

    // Setting a field to the value it already holds must not record an undo
    // step that does nothing when you press it.
    store().commit('No-op', (draft) => {
      draft.name = 'Untitled house';
    });

    expect(store().document).toBe(before);
    expect(store().undoLabel()).toBe('Draw shell');
  });

  it('bumps updatedAt', () => {
    const before = store().document.updatedAt;
    drawShell();
    expect(store().document.updatedAt >= before).toBe(true);
  });

  it('markSaved clears the dirty flag without touching the document', () => {
    drawShell();
    const document = store().document;

    store().markSaved();

    expect(store().dirty).toBe(false);
    expect(store().document).toBe(document);
  });
});

describe('store — rooms are reconciled as part of the edit', () => {
  it('discovers a room the moment its walls enclose one', () => {
    drawShell();

    const rooms = store().document.floors[0]!.rooms;
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.name).toBe('Room 1');
  });

  it('keeps a renamed room’s name when the plan is subdivided', () => {
    drawShell();

    store().commit('Rename', (draft) => {
      draft.floors[0]!.rooms[0]! = { ...draft.floors[0]!.rooms[0]!, name: 'Salon' };
    });

    // Split off the right-hand 2m; the anchor at x=3000 stays on the left.
    divideAt(4000);

    const names = store()
      .document.floors[0]!.rooms.map((room) => room.name)
      .sort();
    expect(names).toContain('Salon');
    expect(names).toHaveLength(2);
  });

  it('records the split as a single undo step, rooms included', () => {
    drawShell();
    store().commit('Rename', (draft) => {
      draft.floors[0]!.rooms[0]! = { ...draft.floors[0]!.rooms[0]!, name: 'Salon' };
    });

    divideAt(4000);
    expect(store().document.floors[0]!.rooms).toHaveLength(2);

    // One undo, not two — the room bookkeeping rode along with the wall.
    store().undo();

    const floor = store().document.floors[0]!;
    expect(Object.keys(floor.graph.walls)).toHaveLength(4);
    expect(floor.rooms).toHaveLength(1);
    expect(floor.rooms[0]!.name).toBe('Salon');
  });

  it('merges rooms back when a dividing wall is undone', () => {
    drawShell();
    divideAt(5000);
    expect(store().document.floors[0]!.rooms).toHaveLength(2);

    store().undo();
    expect(store().document.floors[0]!.rooms).toHaveLength(1);

    store().redo();
    expect(store().document.floors[0]!.rooms).toHaveLength(2);
  });

  it('does not rewrite the room list when an edit leaves the walls alone', () => {
    drawShell();
    const roomsBefore = store().document.floors[0]!.rooms;

    store().commit('Rename house', (draft) => {
      draft.name = 'Bizim Ev';
    });

    // Same array object: reconciliation found nothing to change, so it did not
    // mark the rooms as modified.
    expect(store().document.floors[0]!.rooms).toBe(roomsBefore);
  });
});

describe('store — undo and redo', () => {
  it('walks a sequence of edits back and forward', () => {
    drawShell();
    divideAt(3000);

    expect(store().document.floors[0]!.rooms).toHaveLength(2);

    store().undo();
    expect(store().document.floors[0]!.rooms).toHaveLength(1);

    store().undo();
    expect(Object.keys(store().document.floors[0]!.graph.walls)).toHaveLength(0);
    expect(store().canUndo()).toBe(false);

    store().redo();
    store().redo();
    expect(store().document.floors[0]!.rooms).toHaveLength(2);
  });

  it('drops selection pointing at things undo removed', () => {
    drawShell();
    const wallId = Object.keys(store().document.floors[0]!.graph.walls)[0]!;

    store().select([{ kind: 'wall', id: wallId }]);
    expect(store().selection).toHaveLength(1);

    store().undo();
    expect(store().selection).toHaveLength(0);
  });

  it('coalesces a drag into one undo step', () => {
    drawShell();
    const nodeId = Object.keys(store().document.floors[0]!.graph.nodes)[0]!;

    for (const x of [10, 20, 30, 40]) {
      store().commit(
        'Move corner',
        (draft) => {
          const node = draft.floors[0]!.graph.nodes[nodeId]!;
          draft.floors[0]!.graph.nodes[nodeId] = { ...node, x };
        },
        { coalesceKey: `drag:${nodeId}` },
      );
    }

    expect(store().document.floors[0]!.graph.nodes[nodeId]!.x).toBe(40);

    store().undo();
    expect(store().document.floors[0]!.graph.nodes[nodeId]!.x).toBe(0);
  });
});

describe('store — opening a document', () => {
  it('clears history, because it belongs to the old plan', () => {
    drawShell();
    expect(store().canUndo()).toBe(true);

    store().openDocument(createDocument());

    expect(store().canUndo()).toBe(false);
    expect(store().canRedo()).toBe(false);
    expect(store().dirty).toBe(false);
  });

  it('moves to the first floor of the opened document', () => {
    const document = createDocument();
    document.floors.push(createFloor('upstairs', 1, 'First floor'));

    store().openDocument(document);

    expect(store().activeFloorId).toBe(document.floors[0]!.id);
  });
});

describe('store — floors', () => {
  it('switches floors and clears the selection', () => {
    store().commit('Add a floor', (draft) => {
      draft.floors.push(createFloor('upstairs', 1, 'First floor'));
    });
    store().select([{ kind: 'room', id: 'anything' }]);

    store().setActiveFloor('upstairs');

    expect(store().activeFloorId).toBe('upstairs');
    expect(store().selection).toHaveLength(0);
  });

  it('ignores a floor that does not exist', () => {
    const before = store().activeFloorId;
    store().setActiveFloor('nope');
    expect(store().activeFloorId).toBe(before);
  });

  it('reconciles every floor, not only the active one', () => {
    store().commit('Add a furnished upstairs', (draft) => {
      draft.floors.push(
        createFloor('upstairs', 1, 'First floor', {
          graph: graphFromSegments(rectangleSegments(0, 0, 3000, 3000, 'exterior')),
        }),
      );
    });

    expect(store().document.floors[1]!.rooms).toHaveLength(1);
  });
});

describe('store — selection', () => {
  it('replaces by default', () => {
    store().select([{ kind: 'wall', id: 'w1' }]);
    store().select([{ kind: 'wall', id: 'w2' }]);

    expect(store().selection).toEqual([{ kind: 'wall', id: 'w2' }]);
  });

  it('adds without duplicating', () => {
    store().select([{ kind: 'wall', id: 'w1' }]);
    store().select([{ kind: 'wall', id: 'w2' }], 'add');
    store().select([{ kind: 'wall', id: 'w2' }], 'add');

    expect(store().selection).toHaveLength(2);
  });

  it('toggles', () => {
    store().select([{ kind: 'wall', id: 'w1' }]);
    store().select([{ kind: 'wall', id: 'w1' }], 'toggle');

    expect(store().selection).toHaveLength(0);
  });

  it('distinguishes targets of different kinds with the same id', () => {
    store().select([{ kind: 'wall', id: 'x' }]);
    store().select([{ kind: 'room', id: 'x' }], 'add');

    expect(store().selection).toHaveLength(2);
    expect(store().isSelected({ kind: 'wall', id: 'x' })).toBe(true);
    expect(store().isSelected({ kind: 'item', id: 'x' })).toBe(false);
  });
});

describe('store — derived rooms match the stored ones', () => {
  it('reports the same rooms whether read live or from the document', () => {
    drawShell();
    divideAt(4000);

    const floor = store().document.floors[0]!;
    const derived = roomsOf(floor);

    expect(derived).toHaveLength(extractFaces(floor.graph).length);
    expect(derived.map((room) => room.props.id).sort()).toEqual(
      floor.rooms.map((room) => room.id).sort(),
    );
  });

  it('computes usable floor inside the walls', () => {
    drawShell();

    const room = roomsOf(store().document.floors[0]!)[0]!;
    // 6m x 3m centrelines with 250mm exterior walls: 5.75m x 2.75m of floor.
    expect(room.geometry.area).toBe(5750 * 2750);
  });
});

describe('store — display units', () => {
  it('changes the display unit as an undoable edit', () => {
    expect(store().document.unit).toBe('cm');

    store().setDisplayUnit('m');
    expect(store().document.unit).toBe('m');

    store().undo();
    expect(store().document.unit).toBe('cm');
  });
});

describe('store — the graph stays planar through store edits', () => {
  it('splits walls when a divider is added and heals when it is removed', () => {
    drawShell();
    divideAt(3000);

    // 4 outer walls become 6 (top and bottom each split), plus the divider.
    expect(Object.keys(store().document.floors[0]!.graph.walls)).toHaveLength(7);

    const dividerId = Object.entries(store().document.floors[0]!.graph.walls).find(
      ([, wall]) => wall.kind === 'interior',
    )![0];

    store().commit('Remove divider', (draft) => {
      const floor = draft.floors[0]!;
      floor.graph = removeWall(floor.graph, dividerId);
    });

    expect(store().document.floors[0]!.rooms).toHaveLength(1);
  });
});

describe('store — objects', () => {
  it('places an object at the catalogue defaults and selects it', () => {
    drawShell();
    store().addItem('wardrobe', 1200, 800);

    const items = store().document.floors[0]!.items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'i1',
      kind: 'wardrobe',
      label: 'Wardrobe',
      x: 1200,
      y: 800,
      width: 1500,
      depth: 600,
      height: 2100,
      params: { doorType: 'hinged', doors: 3 },
    });
    expect(store().selection).toEqual([{ kind: 'item', id: 'i1' }]);
    expect(store().undoLabel()).toBe('Add wardrobe');
  });

  it('refuses a kind the catalogue does not have', () => {
    drawShell();
    store().addItem('flying-carpet', 0, 0);

    expect(store().document.floors[0]!.items).toHaveLength(0);
  });

  it('never hands out an id something on the floor is already using', () => {
    // Ids continue from the highest, not from the count, so deleting from the
    // middle does not renumber the survivors or collide with them.
    store().addItem('stool', 0, 0);
    store().addItem('stool', 500, 0);
    store().addItem('stool', 1000, 0);
    store().removeItem('i2');
    store().addItem('stool', 1500, 0);

    expect(store().document.floors[0]!.items.map((item) => item.id)).toEqual(['i1', 'i3', 'i4']);
  });

  it('rounds and normalises whatever it is given', () => {
    store().addItem('stool', 0, 0);
    store().updateItem('i1', { x: 120.7, y: -4.2, width: 381.6, rotation: 450 });

    expect(store().document.floors[0]!.items[0]).toMatchObject({
      x: 121,
      y: -4,
      width: 382,
      rotation: 90,
    });
  });

  it('folds a drag into one undo step', () => {
    store().addItem('stool', 0, 0);

    for (const x of [100, 200, 300]) {
      store().updateItem('i1', { x }, 'drag-item:i1');
    }
    expect(store().document.floors[0]!.items[0]!.x).toBe(300);

    // One press puts it back where the drag started, not two hundred presses.
    store().undo();
    expect(store().document.floors[0]!.items[0]!.x).toBe(0);
  });

  it('copies an object without sharing its parameters', () => {
    store().addItem('wardrobe', 1000, 1000);
    store().duplicateItem('i1');
    store().updateItem('i2', { params: { doorType: 'sliding', doors: 2 } });

    const [original, copy] = store().document.floors[0]!.items;
    expect(copy).toMatchObject({ id: 'i2', kind: 'wardrobe' });
    expect(copy!.x).toBeGreaterThan(original!.x);
    expect(original!.params).toEqual({ doorType: 'hinged', doors: 3 });
    expect(store().selection).toEqual([{ kind: 'item', id: 'i2' }]);
  });

  it('drops the selection when the object is deleted', () => {
    store().addItem('stool', 0, 0);
    store().removeItem('i1');

    expect(store().document.floors[0]!.items).toHaveLength(0);
    expect(store().selection).toEqual([]);
  });

  it('arms the placing tool by choosing an object', () => {
    store().setPlaceItemKind('bed-double');

    expect(store().tool).toBe('place-item');
    expect(store().placeItemKind).toBe('bed-double');

    // And leaving the tool puts the object down, so it cannot be dropped by a
    // click meant for something else later.
    store().setTool('select');
    expect(store().placeItemKind).toBeNull();
  });

  it('forgets an object it no longer has when undone', () => {
    store().addItem('stool', 0, 0);
    store().select([{ kind: 'item', id: 'i1' }]);

    store().undo();

    expect(store().document.floors[0]!.items).toHaveLength(0);
    expect(store().selection).toEqual([]);
  });
});

describe('store — naming an object', () => {
  it('keeps the name the user typed, not the catalogue label', () => {
    // Two of the same thing in one room is ordinary, and two identical rows in
    // the Issues panel is what it looks like before you can tell them apart.
    store().addItem('bedside-table', 0, 0);
    store().addItem('bedside-table', 2000, 0);
    store().updateItem('i1', { label: 'Hers' });
    store().updateItem('i2', { label: 'His' });

    expect(store().document.floors[0]!.items.map((item) => item.label)).toEqual(['Hers', 'His']);
    expect(store().document.floors[0]!.items.map((item) => item.kind)).toEqual([
      'bedside-table',
      'bedside-table',
    ]);
  });
});

describe('store — muting warnings', () => {
  it('records a muted warning on the plan, undoably', () => {
    store().muteIssue('clearance/i1/bedside-drawer');

    expect(store().document.floors[0]!.mutedIssues).toEqual(['clearance/i1/bedside-drawer']);
    expect(store().undoLabel()).toBe('Mute warning');

    // Muting the wrong one is exactly what ctrl-Z is for.
    store().undo();
    expect(store().document.floors[0]!.mutedIssues).toEqual([]);
  });

  it('does not record the same warning twice', () => {
    store().muteIssue('a');
    store().muteIssue('a');

    expect(store().document.floors[0]!.mutedIssues).toEqual(['a']);
    // And the second, having changed nothing, left no undo step behind.
    store().undo();
    expect(store().document.floors[0]!.mutedIssues).toEqual([]);
  });

  it('brings a warning back', () => {
    store().muteIssue('a');
    store().muteIssue('b');
    store().unmuteIssue('a');

    expect(store().document.floors[0]!.mutedIssues).toEqual(['b']);
  });

  it('stops pointing at a warning the moment it is put aside', () => {
    store().focusIssue('a');
    store().muteIssue('a');

    expect(store().focusedIssueId).toBeNull();
  });
});
