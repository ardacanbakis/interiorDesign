import { describe, expect, it, vi } from 'vitest';

import { createDocument } from '../core/model/document.ts';
import { createAutosaver, restoreMostRecent, type SaveState } from './autosave.ts';
import { createMemoryStore, type DocumentStore } from './store.ts';

function doc(name: string, updatedAt = '2026-03-04T10:00:00.000Z') {
  let counter = 0;
  const base = createDocument({
    name,
    now: () => new Date(updatedAt),
    newId: () => `${name}-${++counter}`,
  });
  return { ...base, id: name, updatedAt };
}

/** A clock the test drives, standing in for setTimeout. */
function manualTimers() {
  const pending = new Map<number, () => void>();
  let nextId = 1;

  return {
    setTimeoutFn: ((callback: () => void) => {
      const id = nextId++;
      pending.set(id, callback);
      return id as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout,
    clearTimeoutFn: ((id: number) => {
      pending.delete(id);
    }) as unknown as typeof clearTimeout,
    /** Fire everything currently waiting. */
    run() {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback();
    },
    get count() {
      return pending.size;
    },
  };
}

describe('createAutosaver', () => {
  it('writes once the document stops changing', async () => {
    const store = createMemoryStore();
    const timers = manualTimers();
    const autosaver = createAutosaver(store, {
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    autosaver.schedule(doc('Ev'));
    expect(autosaver.state).toBe('pending');
    expect(await store.list()).toHaveLength(0);

    timers.run();
    await vi.waitFor(() => expect(autosaver.state).toBe('saved'));
    expect(await store.list()).toHaveLength(1);
  });

  it('collapses a burst of edits into a single write', async () => {
    const written: string[] = [];
    const store: DocumentStore = {
      ...createMemoryStore(),
      async write(document) {
        written.push(document.name);
      },
    };

    const timers = manualTimers();
    const autosaver = createAutosaver(store, {
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    // Twenty pointer-move edits while the timer is running.
    for (let index = 0; index < 20; index++) {
      autosaver.schedule({ ...doc('Ev'), name: `Ev ${index}` });
    }

    // Each new edit replaces the pending timer rather than adding one.
    expect(timers.count).toBe(1);

    timers.run();
    await vi.waitFor(() => expect(written).toHaveLength(1));
    // And what lands is the final state, not the first.
    expect(written[0]).toBe('Ev 19');
  });

  it('flush writes immediately, for a closing tab', async () => {
    const store = createMemoryStore();
    const timers = manualTimers();
    const autosaver = createAutosaver(store, {
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    autosaver.schedule(doc('Ev'));
    await autosaver.flush();

    expect(await store.list()).toHaveLength(1);
    // The pending timer was cancelled, so nothing writes twice.
    expect(timers.count).toBe(0);
  });

  it('flush with nothing pending does nothing', async () => {
    const store = createMemoryStore();
    const autosaver = createAutosaver(store);

    await autosaver.flush();
    expect(await store.list()).toHaveLength(0);
  });

  it('cancel drops the pending write', async () => {
    const store = createMemoryStore();
    const timers = manualTimers();
    const autosaver = createAutosaver(store, {
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    autosaver.schedule(doc('Ev'));
    autosaver.cancel();
    timers.run();

    expect(autosaver.state).toBe('idle');
    expect(await store.list()).toHaveLength(0);
  });

  it('reports an error rather than failing silently', async () => {
    const store: DocumentStore = {
      ...createMemoryStore(),
      async write() {
        throw new Error('Storage quota exceeded');
      },
    };

    const states: SaveState[] = [];
    const errors: unknown[] = [];
    const timers = manualTimers();
    const autosaver = createAutosaver(store, {
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
      onStateChange: (state) => states.push(state),
      onError: (error) => errors.push(error),
    });

    autosaver.schedule(doc('Ev'));
    timers.run();

    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(states).toEqual(['pending', 'saving', 'error']);
  });

  it('does not claim "saved" when a change arrived mid-write', async () => {
    // A deferred the test resolves by hand, so the write can be held open while
    // another edit arrives. Held in a box because TypeScript cannot follow an
    // assignment made inside the Promise executor.
    const inFlight: { release: () => void } = { release: () => undefined };
    const store: DocumentStore = {
      ...createMemoryStore(),
      write: () =>
        new Promise<void>((resolve) => {
          inFlight.release = resolve;
        }),
    };

    const timers = manualTimers();
    const autosaver = createAutosaver(store, {
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    autosaver.schedule(doc('Ev'));
    timers.run();
    await vi.waitFor(() => expect(autosaver.state).toBe('saving'));

    // An edit lands while the write is still in flight.
    autosaver.schedule(doc('Ev again'));
    inFlight.release();

    await vi.waitFor(() => expect(autosaver.state).toBe('pending'));
  });
});

describe('restoreMostRecent', () => {
  it('reopens the plan worked on last', async () => {
    const store = createMemoryStore([
      doc('Older', '2026-01-01T00:00:00.000Z'),
      doc('Newer', '2026-06-01T00:00:00.000Z'),
    ]);

    expect((await restoreMostRecent(store))?.name).toBe('Newer');
  });

  it('returns null when there is nothing to reopen', async () => {
    expect(await restoreMostRecent(createMemoryStore())).toBeNull();
  });

  it('leaves a damaged plan alone rather than destroying it', async () => {
    // A bug in a future migration must not be able to delete someone's only
    // copy of a house they spent an evening measuring.
    const broken = { id: 'broken', schemaVersion: 1, updatedAt: '2026-06-01T00:00:00.000Z' };
    const store: DocumentStore = {
      ...createMemoryStore(),
      async list() {
        return [{ id: 'broken', name: '?', updatedAt: broken.updatedAt, floorCount: 0 }];
      },
      async read() {
        return broken;
      },
    };

    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await restoreMostRecent(store)).toBeNull();
    expect(await store.read('broken')).toBe(broken);
    errors.mockRestore();
  });

  it('returns null when the listed plan has since vanished', async () => {
    const store: DocumentStore = {
      ...createMemoryStore(),
      async list() {
        return [{ id: 'gone', name: 'Gone', updatedAt: '2026-06-01T00:00:00.000Z', floorCount: 1 }];
      },
      async read() {
        return null;
      },
    };

    expect(await restoreMostRecent(store)).toBeNull();
  });
});
