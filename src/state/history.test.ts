import { describe, expect, it } from 'vitest';

import {
  applyEdit,
  canRedo,
  canUndo,
  clearHistory,
  COALESCE_WINDOW_MS,
  EMPTY_HISTORY,
  MAX_HISTORY_DEPTH,
  redo,
  redoLabel,
  undo,
  undoLabel,
  type History,
} from './history.ts';

interface Doc {
  name: string;
  walls: { id: string; thickness: number }[];
  meta: { tags: string[] };
}

const start = (): Doc => ({
  name: 'Ev',
  walls: [
    { id: 'w1', thickness: 100 },
    { id: 'w2', thickness: 100 },
  ],
  meta: { tags: ['draft'] },
});

/** A clock the test drives, so coalescing can be exercised deterministically. */
function fakeClock(startAt = 1000) {
  let time = startAt;
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe('applyEdit', () => {
  it('applies the change and records it', () => {
    const result = applyEdit(start(), EMPTY_HISTORY, 'Rename', (draft) => {
      draft.name = 'Yeni Ev';
    });

    expect(result.changed).toBe(true);
    expect(result.state.name).toBe('Yeni Ev');
    expect(result.history.past).toHaveLength(1);
    expect(result.history.past[0]!.label).toBe('Rename');
  });

  it('does not mutate the state it was given', () => {
    const original = start();
    applyEdit(original, EMPTY_HISTORY, 'Rename', (draft) => {
      draft.name = 'Yeni Ev';
    });

    expect(original.name).toBe('Ev');
  });

  it('records nothing when the recipe changes nothing', () => {
    // Retyping the width a wall already has should not leave a dead undo step.
    const result = applyEdit(start(), EMPTY_HISTORY, 'Set thickness', (draft) => {
      draft.walls[0]!.thickness = 100;
    });

    expect(result.changed).toBe(false);
    expect(result.history.past).toHaveLength(0);
    expect(result.state).toEqual(start());
  });

  it('abandons the redo branch when a new edit arrives', () => {
    let state = start();
    let history: History = EMPTY_HISTORY;

    ({ state, history } = applyEdit(state, history, 'One', (d) => {
      d.name = 'A';
    }));
    ({ state, history } = undo(state, history));
    expect(canRedo(history)).toBe(true);

    ({ state, history } = applyEdit(state, history, 'Two', (d) => {
      d.name = 'B';
    }));

    expect(canRedo(history)).toBe(false);
    expect(state.name).toBe('B');
  });

  it('caps the stack depth', () => {
    let state = start();
    let history: History = EMPTY_HISTORY;

    for (let index = 0; index < MAX_HISTORY_DEPTH + 25; index++) {
      ({ state, history } = applyEdit(state, history, `Edit ${index}`, (draft) => {
        draft.name = `name-${index}`;
      }));
    }

    expect(history.past).toHaveLength(MAX_HISTORY_DEPTH);
    // The oldest entries are the ones dropped.
    expect(history.past[history.past.length - 1]!.label).toBe(`Edit ${MAX_HISTORY_DEPTH + 24}`);
  });
});

describe('undo and redo', () => {
  it('walks back and forward through a sequence', () => {
    let state = start();
    let history: History = EMPTY_HISTORY;

    ({ state, history } = applyEdit(state, history, 'One', (d) => {
      d.name = 'A';
    }));
    ({ state, history } = applyEdit(state, history, 'Two', (d) => {
      d.name = 'B';
    }));

    expect(state.name).toBe('B');

    ({ state, history } = undo(state, history));
    expect(state.name).toBe('A');

    ({ state, history } = undo(state, history));
    expect(state.name).toBe('Ev');
    expect(canUndo(history)).toBe(false);

    ({ state, history } = redo(state, history));
    expect(state.name).toBe('A');

    ({ state, history } = redo(state, history));
    expect(state.name).toBe('B');
    expect(canRedo(history)).toBe(false);
  });

  it('is a no-op at either end of the stack', () => {
    const state = start();
    expect(undo(state, EMPTY_HISTORY)).toMatchObject({ changed: false, state });
    expect(redo(state, EMPTY_HISTORY)).toMatchObject({ changed: false, state });
  });

  it('round-trips a deletion, which is where patch order bites', () => {
    let state = start();
    let history: History = EMPTY_HISTORY;

    ({ state, history } = applyEdit(state, history, 'Delete wall', (draft) => {
      draft.walls.splice(0, 1);
    }));
    expect(state.walls.map((wall) => wall.id)).toEqual(['w2']);

    ({ state, history } = undo(state, history));
    expect(state.walls).toEqual(start().walls);

    ({ state, history } = redo(state, history));
    expect(state.walls.map((wall) => wall.id)).toEqual(['w2']);
  });

  it('round-trips nested changes', () => {
    let state = start();
    let history: History = EMPTY_HISTORY;

    ({ state, history } = applyEdit(state, history, 'Tag', (draft) => {
      draft.meta.tags.push('kitchen');
      draft.walls[1]!.thickness = 250;
    }));

    ({ state, history } = undo(state, history));
    expect(state).toEqual(start());

    ({ state, history } = redo(state, history));
    expect(state.meta.tags).toEqual(['draft', 'kitchen']);
    expect(state.walls[1]!.thickness).toBe(250);
  });

  it('returns to exactly the starting document after undoing everything', () => {
    let state = start();
    let history: History = EMPTY_HISTORY;
    const original = start();

    const edits: ((draft: Doc) => void)[] = [
      (d) => {
        d.name = 'A';
      },
      (d) => {
        d.walls.push({ id: 'w3', thickness: 80 });
      },
      (d) => {
        d.walls.splice(0, 1);
      },
      (d) => {
        d.meta.tags = [];
      },
      (d) => {
        d.walls[0]!.thickness = 999;
      },
    ];

    for (const [index, edit] of edits.entries()) {
      ({ state, history } = applyEdit(state, history, `Edit ${index}`, edit));
    }

    while (canUndo(history)) {
      ({ state, history } = undo(state, history));
    }

    expect(state).toEqual(original);
  });
});

describe('coalescing', () => {
  it('merges a drag into a single undo step', () => {
    const clock = fakeClock();
    let state = start();
    let history: History = EMPTY_HISTORY;

    for (const thickness of [110, 120, 130, 140]) {
      ({ state, history } = applyEdit(
        state,
        history,
        'Move wall',
        (draft) => {
          draft.walls[0]!.thickness = thickness;
        },
        { coalesceKey: 'drag:w1', now: clock.now },
      ));
      clock.advance(16);
    }

    expect(history.past).toHaveLength(1);
    expect(state.walls[0]!.thickness).toBe(140);

    // One undo returns to before the whole drag, not to the previous frame.
    ({ state, history } = undo(state, history));
    expect(state.walls[0]!.thickness).toBe(100);
    expect(canUndo(history)).toBe(false);

    ({ state, history } = redo(state, history));
    expect(state.walls[0]!.thickness).toBe(140);
  });

  it('does not merge across the time window', () => {
    const clock = fakeClock();
    let state = start();
    let history: History = EMPTY_HISTORY;

    ({ state, history } = applyEdit(
      state,
      history,
      'Move wall',
      (d) => {
        d.walls[0]!.thickness = 110;
      },
      { coalesceKey: 'drag:w1', now: clock.now },
    ));

    clock.advance(COALESCE_WINDOW_MS + 1);

    ({ state, history } = applyEdit(
      state,
      history,
      'Move wall',
      (d) => {
        d.walls[0]!.thickness = 120;
      },
      { coalesceKey: 'drag:w1', now: clock.now },
    ));

    expect(history.past).toHaveLength(2);
  });

  it('does not merge edits to different things', () => {
    const clock = fakeClock();
    let state = start();
    let history: History = EMPTY_HISTORY;

    ({ state, history } = applyEdit(
      state,
      history,
      'Move wall',
      (d) => {
        d.walls[0]!.thickness = 110;
      },
      { coalesceKey: 'drag:w1', now: clock.now },
    ));
    ({ state, history } = applyEdit(
      state,
      history,
      'Move wall',
      (d) => {
        d.walls[1]!.thickness = 110;
      },
      { coalesceKey: 'drag:w2', now: clock.now },
    ));

    expect(history.past).toHaveLength(2);
  });

  it('never merges edits with no key', () => {
    const clock = fakeClock();
    let state = start();
    let history: History = EMPTY_HISTORY;

    for (const name of ['A', 'B', 'C']) {
      ({ state, history } = applyEdit(
        state,
        history,
        'Rename',
        (d) => {
          d.name = name;
        },
        { now: clock.now },
      ));
    }

    expect(history.past).toHaveLength(3);
  });

  it('unwinds a coalesced deletion in the right order', () => {
    // Merged inverse patches must run newest-first. Applying them oldest-first
    // looks correct for simple field writes and corrupts arrays.
    const clock = fakeClock();
    let state = start();
    let history: History = EMPTY_HISTORY;

    ({ state, history } = applyEdit(
      state,
      history,
      'Prune',
      (d) => {
        d.walls.push({ id: 'w3', thickness: 80 });
      },
      { coalesceKey: 'prune', now: clock.now },
    ));
    clock.advance(10);
    ({ state, history } = applyEdit(
      state,
      history,
      'Prune',
      (d) => {
        d.walls.splice(0, 1);
      },
      { coalesceKey: 'prune', now: clock.now },
    ));
    clock.advance(10);
    ({ state, history } = applyEdit(
      state,
      history,
      'Prune',
      (d) => {
        d.walls[0]!.thickness = 250;
      },
      { coalesceKey: 'prune', now: clock.now },
    ));

    expect(history.past).toHaveLength(1);
    expect(state.walls).toEqual([
      { id: 'w2', thickness: 250 },
      { id: 'w3', thickness: 80 },
    ]);

    ({ state, history } = undo(state, history));
    expect(state).toEqual(start());

    ({ state, history } = redo(state, history));
    expect(state.walls).toEqual([
      { id: 'w2', thickness: 250 },
      { id: 'w3', thickness: 80 },
    ]);
  });
});

describe('labels', () => {
  it('reports what undo and redo would do', () => {
    let state = start();
    let history: History = EMPTY_HISTORY;

    expect(undoLabel(history)).toBeNull();

    ({ state, history } = applyEdit(state, history, 'Draw wall', (d) => {
      d.name = 'A';
    }));
    expect(undoLabel(history)).toBe('Draw wall');
    expect(redoLabel(history)).toBeNull();

    ({ state, history } = undo(state, history));
    expect(undoLabel(history)).toBeNull();
    expect(redoLabel(history)).toBe('Draw wall');
  });

  it('keeps the first label when edits coalesce', () => {
    const clock = fakeClock();
    let state = start();
    let history: History = EMPTY_HISTORY;

    ({ state, history } = applyEdit(
      state,
      history,
      'Move wall',
      (d) => {
        d.name = 'A';
      },
      { coalesceKey: 'drag', now: clock.now },
    ));
    ({ state, history } = applyEdit(
      state,
      history,
      'Something else entirely',
      (d) => {
        d.name = 'B';
      },
      { coalesceKey: 'drag', now: clock.now },
    ));

    expect(undoLabel(history)).toBe('Move wall');
  });
});

describe('clearHistory', () => {
  it('forgets everything, so undo cannot reach across documents', () => {
    const { history } = applyEdit(start(), EMPTY_HISTORY, 'Edit', (d) => {
      d.name = 'A';
    });

    expect(canUndo(history)).toBe(true);
    expect(canUndo(clearHistory())).toBe(false);
  });
});
