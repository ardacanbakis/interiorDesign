/**
 * Undo and redo.
 *
 * Every change to the document goes through {@link applyEdit}, which runs the
 * change through Immer and keeps the patches describing both the change and its
 * inverse. Undo replays the inverse; redo replays the original. Nothing in the
 * app mutates the document directly, which is what makes undo total rather than
 * something that covers most operations.
 *
 * Storing patches rather than whole snapshots matters here: a house with four
 * furnished floors is a large object, and a slider dragged across its range
 * would otherwise deposit a copy of the entire plan on the stack for every
 * frame.
 *
 * ## Coalescing
 *
 * Dragging a wall produces a change per pointer move. Left alone that buries
 * the undo stack, and pressing undo after a drag would nudge the wall back a
 * pixel at a time. Edits carrying the same `coalesceKey` in quick succession
 * are merged into a single entry, so one drag is one undo.
 *
 * The order the patches are merged in is the subtle part. Given edits A→B→C,
 * undoing the pair has to run C's inverse and *then* B's — newest first —
 * while redoing runs B's patches then C's. Getting that backwards produces an
 * undo that appears to work on simple cases and corrupts the document on
 * anything involving deletions.
 */

import { applyPatches, enablePatches, type Objectish, type Patch, produceWithPatches } from 'immer';

enablePatches();

/** How long after an edit a following edit may still merge into it. */
export const COALESCE_WINDOW_MS = 600;

/** Entries kept before the oldest is dropped. */
export const MAX_HISTORY_DEPTH = 200;

export interface HistoryEntry {
  /** Shown in the undo tooltip: "Undo move wall". */
  readonly label: string;
  readonly patches: readonly Patch[];
  readonly inverse: readonly Patch[];
  /** Edits sharing a key in quick succession merge into one. */
  readonly coalesceKey: string | null;
  readonly at: number;
}

export interface History {
  readonly past: readonly HistoryEntry[];
  readonly future: readonly HistoryEntry[];
}

export const EMPTY_HISTORY: History = { past: [], future: [] };

export interface EditOptions {
  /** Merge with the previous edit if it carried the same key and was recent. */
  readonly coalesceKey?: string | null;
  /** Injectable clock, so tests can control the coalescing window. */
  readonly now?: () => number;
}

export interface EditResult<T> {
  readonly state: T;
  readonly history: History;
  /** False when the recipe changed nothing, so nothing was recorded. */
  readonly changed: boolean;
}

/**
 * Apply a change and record it.
 *
 * A recipe that changes nothing records nothing — clicking a wall and typing
 * the width it already had should not leave an undo step that does nothing
 * when you press it.
 */
export function applyEdit<T extends Objectish>(
  state: T,
  history: History,
  label: string,
  recipe: (draft: T) => void,
  options: EditOptions = {},
): EditResult<T> {
  const [next, patches, inverse] = produceWithPatches(state, recipe as (draft: T) => void);

  if (patches.length === 0) {
    return { state, history, changed: false };
  }

  const now = (options.now ?? Date.now)();
  const coalesceKey = options.coalesceKey ?? null;
  const previous = history.past[history.past.length - 1];

  const mergeable =
    previous !== undefined &&
    coalesceKey !== null &&
    previous.coalesceKey === coalesceKey &&
    now - previous.at <= COALESCE_WINDOW_MS;

  const entry: HistoryEntry = mergeable
    ? {
        label: previous.label,
        // Forward: oldest first, so replaying reaches the same end state.
        patches: [...previous.patches, ...patches],
        // Inverse: newest first, so undoing unwinds in reverse.
        inverse: [...inverse, ...previous.inverse],
        coalesceKey,
        at: now,
      }
    : { label, patches, inverse, coalesceKey, at: now };

  const past = mergeable
    ? [...history.past.slice(0, -1), entry]
    : [...history.past, entry].slice(-MAX_HISTORY_DEPTH);

  // Any new edit abandons the redo branch — the standard linear model, and the
  // one people already have in their fingers.
  return { state: next as T, history: { past, future: [] }, changed: true };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}

export function undoLabel(history: History): string | null {
  return history.past[history.past.length - 1]?.label ?? null;
}

export function redoLabel(history: History): string | null {
  return history.future[history.future.length - 1]?.label ?? null;
}

export interface StepResult<T> {
  readonly state: T;
  readonly history: History;
  readonly changed: boolean;
}

export function undo<T extends Objectish>(state: T, history: History): StepResult<T> {
  const entry = history.past[history.past.length - 1];
  if (!entry) return { state, history, changed: false };

  return {
    state: applyPatches(state, entry.inverse as Patch[]),
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, entry],
    },
    changed: true,
  };
}

export function redo<T extends Objectish>(state: T, history: History): StepResult<T> {
  const entry = history.future[history.future.length - 1];
  if (!entry) return { state, history, changed: false };

  return {
    state: applyPatches(state, entry.patches as Patch[]),
    history: {
      past: [...history.past, entry],
      future: history.future.slice(0, -1),
    },
    changed: true,
  };
}

/**
 * Forget everything. Used when a different document is opened — the new one's
 * history is not the old one's, and letting undo reach across them would
 * apply patches to a document they were never recorded against.
 */
export function clearHistory(): History {
  return EMPTY_HISTORY;
}
