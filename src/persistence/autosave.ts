/**
 * Keeping work safe without anyone having to think about it.
 *
 * There is no Save button. The plan is written back to local storage shortly
 * after it stops changing, and the most recent plan is reopened on startup.
 * Someone measuring a house should be able to close the tab mid-thought and
 * find it as they left it.
 *
 * The scheduling is separated from React so it can be tested with a fake clock;
 * `useAutosave` is the thin hook that drives it.
 */

import { useEffect, useRef, useState } from 'react';

import { loadDocument } from '../core/model/migrations.ts';
import { type HouseDocument } from '../core/model/schema.ts';
import { useEditorStore } from '../state/store.ts';
import { type DocumentStore } from './store.ts';

/**
 * How long the document must sit unchanged before it is written.
 *
 * Long enough that dragging a wall does not queue a write per frame, short
 * enough that a closed tab loses at most a moment's work.
 */
export const AUTOSAVE_DELAY_MS = 800;

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface Autosaver {
  /** Note that the document changed and schedule a write. */
  schedule(document: HouseDocument): void;
  /** Write now, skipping the wait. For beforeunload. */
  flush(): Promise<void>;
  cancel(): void;
  readonly state: SaveState;
}

export interface AutosaverOptions {
  readonly delayMs?: number;
  readonly onStateChange?: (state: SaveState) => void;
  readonly onSaved?: (document: HouseDocument) => void;
  readonly onError?: (error: unknown) => void;
  readonly setTimeoutFn?: typeof setTimeout;
  readonly clearTimeoutFn?: typeof clearTimeout;
}

/**
 * Debounced writer.
 *
 * Only the latest document is ever written — a plan edited twenty times while
 * the timer runs produces one write, of the final state.
 */
export function createAutosaver(store: DocumentStore, options: AutosaverOptions = {}): Autosaver {
  const delayMs = options.delayMs ?? AUTOSAVE_DELAY_MS;
  const schedule_ = options.setTimeoutFn ?? setTimeout;
  const cancel_ = options.clearTimeoutFn ?? clearTimeout;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let queued: HouseDocument | null = null;
  let state: SaveState = 'idle';

  const setState = (next: SaveState) => {
    state = next;
    options.onStateChange?.(next);
  };

  const write = async (): Promise<void> => {
    const document = queued;
    if (!document) return;

    queued = null;
    setState('saving');

    try {
      await store.write(document);
      // A change that arrived mid-write leaves something queued; that write is
      // already scheduled, so this one is not the final state and should not
      // claim to be.
      if (queued === null) setState('saved');
      options.onSaved?.(document);
    } catch (error) {
      setState('error');
      options.onError?.(error);
    }
  };

  return {
    schedule(document) {
      queued = document;
      setState('pending');
      if (timer !== null) cancel_(timer);
      timer = schedule_(() => {
        timer = null;
        void write();
      }, delayMs);
    },

    async flush() {
      if (timer !== null) {
        cancel_(timer);
        timer = null;
      }
      await write();
    },

    cancel() {
      if (timer !== null) {
        cancel_(timer);
        timer = null;
      }
      queued = null;
      setState('idle');
    },

    get state() {
      return state;
    },
  };
}

/**
 * Save the document shortly after it stops changing, and on the way out.
 *
 * Returns the save state so the status bar can show it — "Saving…", "Saved",
 * and above all "Couldn't save", which is the one that matters.
 */
export function useAutosave(store: DocumentStore | null): SaveState {
  const document = useEditorStore((state) => state.document);
  const dirty = useEditorStore((state) => state.dirty);
  const markSaved = useEditorStore((state) => state.markSaved);

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const autosaver = useRef<Autosaver | null>(null);

  useEffect(() => {
    if (!store) {
      autosaver.current = null;
      return;
    }

    const instance = createAutosaver(store, {
      onStateChange: setSaveState,
      onSaved: () => markSaved(),
      onError: (error) => console.error('Could not save the plan', error),
    });
    autosaver.current = instance;

    return () => {
      // Best effort on unmount: get whatever is pending onto disk.
      void instance.flush();
      autosaver.current = null;
    };
  }, [store, markSaved]);

  useEffect(() => {
    if (!dirty) return;
    autosaver.current?.schedule(document);
  }, [document, dirty]);

  // Closing the tab mid-edit should not lose the last second of work.
  useEffect(() => {
    const onHide = () => {
      if (window.document.visibilityState === 'hidden') void autosaver.current?.flush();
    };

    window.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

  return saveState;
}

/**
 * Reopen the plan that was last worked on.
 *
 * A plan that fails to load is left alone rather than deleted — a bug in a
 * migration must not be able to destroy someone's only copy — and the app
 * carries on with the empty document it started with.
 */
export async function restoreMostRecent(store: DocumentStore): Promise<HouseDocument | null> {
  const summaries = await store.list();
  const mostRecent = summaries[0];
  if (!mostRecent) return null;

  const raw = await store.read(mostRecent.id);
  if (raw === null) return null;

  const result = loadDocument(raw);
  if (!result.ok) {
    console.error('Could not reopen the last plan:', result.error, result.issues);
    return null;
  }

  return result.document;
}
