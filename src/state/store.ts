/**
 * The editor store.
 *
 * Holds two quite different kinds of state and keeps them apart:
 *
 * - **The document** — walls, rooms, furniture. Every change goes through
 *   {@link EditorStore.commit}, which records it for undo. This is what gets
 *   saved.
 * - **Session state** — which floor is showing, what is selected, where the
 *   view is panned to. Changes freely and is never undoable, because nobody
 *   presses ctrl-Z expecting the camera to move.
 *
 * Confusing the two is the usual way an editor's undo ends up feeling wrong.
 */

import { create } from 'zustand';

import { reconcileFloor } from '../core/model/derive.ts';
import { createDocument, findFloor } from '../core/model/document.ts';
import {
  type FloorId,
  type HouseDocument,
  type ItemId,
  type OpeningId,
} from '../core/model/schema.ts';
import { type RoomId, type RoomType } from '../core/graph/roomIdentity.ts';
import { createRoomFromInnerSize } from '../core/graph/operations.ts';
import { allNodes } from '../core/graph/wallGraph.ts';
import { boundingBox } from '../core/geometry/polygon.ts';
import { type Mm } from '../core/units/length.ts';
import { type NodeId, type WallId } from '../core/graph/wallGraph.ts';
import { type LengthUnit } from '../core/units/length.ts';
import {
  applyEdit,
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  clearHistory,
  EMPTY_HISTORY,
  redo as historyRedo,
  redoLabel as historyRedoLabel,
  undo as historyUndo,
  undoLabel as historyUndoLabel,
  type EditOptions,
  type History,
} from './history.ts';

export type SelectionTarget =
  | { readonly kind: 'wall'; readonly id: WallId }
  | { readonly kind: 'node'; readonly id: NodeId }
  | { readonly kind: 'room'; readonly id: RoomId }
  | { readonly kind: 'item'; readonly id: ItemId }
  | { readonly kind: 'opening'; readonly id: OpeningId };

export type SelectionMode = 'replace' | 'add' | 'toggle';

/**
 * What a click on the canvas does.
 *
 * Deliberately few. A drawing tool that is also a selection tool is how
 * floor-plan editors end up with people accidentally dragging a wall across
 * the house while trying to click on it.
 */
export type ToolId = 'select' | 'draw-room' | 'draw-wall';

export interface NewRoomSpec {
  /** Clear distance between wall faces. */
  readonly width: Mm;
  readonly depth: Mm;
  readonly thickness: Mm;
  readonly ceilingHeight: Mm;
  readonly name: string;
  readonly type: RoomType;
}

/**
 * Gap left between a new room and anything already on the floor.
 *
 * A room added to a plan that already has one is placed clear of it rather than
 * butted against it. Sharing a wall would be the nicer default for a house, but
 * which side to share is a guess, and a wrong guess is harder to undo than
 * dragging a room that is plainly separate. One metre reads unambiguously as
 * "not attached yet".
 */
const NEW_ROOM_GAP: Mm = 1000;

export interface Viewport {
  /** Model coordinates at the centre of the view. */
  readonly centre: { readonly x: number; readonly y: number };
  /** Screen pixels per millimetre. */
  readonly scale: number;
}

export const DEFAULT_VIEWPORT: Viewport = {
  centre: { x: 0, y: 0 },
  // 20 pixels per 100mm — a 4m room fits comfortably on a laptop screen.
  scale: 0.2,
};

export interface EditorStore {
  // ---- Document, undoable ----
  document: HouseDocument;
  history: History;
  /** Set on every commit, cleared by whoever saves. Drives autosave. */
  dirty: boolean;

  // ---- Session, not undoable ----
  activeFloorId: FloorId;
  selection: readonly SelectionTarget[];
  viewport: Viewport;
  tool: ToolId;

  // ---- Document actions ----
  commit: (label: string, recipe: (draft: HouseDocument) => void, options?: EditOptions) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  undoLabel: () => string | null;
  redoLabel: () => string | null;

  /** Replace the document wholesale — opening a file, or starting again. */
  openDocument: (document: HouseDocument) => void;
  newDocument: () => void;
  markSaved: () => void;
  setDisplayUnit: (unit: LengthUnit) => void;

  /**
   * Build a room from typed measurements and select it.
   *
   * The dimensions are the ones a tape measure gives — the clear distance
   * between wall faces — not the centrelines the graph stores. See
   * `createRoomFromInnerSize`.
   */
  createRoom: (spec: NewRoomSpec) => void;

  // ---- Session actions ----
  setActiveFloor: (floorId: FloorId) => void;
  select: (targets: readonly SelectionTarget[], mode?: SelectionMode) => void;
  clearSelection: () => void;
  isSelected: (target: SelectionTarget) => boolean;
  setViewport: (viewport: Viewport) => void;
  setTool: (tool: ToolId) => void;
}

/**
 * Bring derived state back in line after an edit.
 *
 * Reconciliation runs inside the same Immer recipe as the edit itself, so
 * moving a wall and renaming the room it just created are one undo step rather
 * than two. `reconcileFloor` returns the same object when nothing changed, so
 * an edit that leaves the walls alone does not churn the room list.
 */
function normalize(draft: HouseDocument): void {
  draft.floors.forEach((floor, index) => {
    const reconciled = reconcileFloor(floor);
    if (reconciled !== floor) draft.floors[index] = reconciled;
  });
}

function initialState(): Pick<
  EditorStore,
  'document' | 'history' | 'dirty' | 'activeFloorId' | 'selection' | 'viewport' | 'tool'
> {
  const document = createDocument();
  return {
    document,
    history: EMPTY_HISTORY,
    dirty: false,
    activeFloorId: document.floors[0]!.id,
    selection: [],
    viewport: DEFAULT_VIEWPORT,
    tool: 'select',
  };
}

export const useEditorStore = create<EditorStore>()((set, get) => ({
  ...initialState(),

  commit: (label, recipe, options) => {
    const { document, history } = get();

    const result = applyEdit(
      document,
      history,
      label,
      (draft) => {
        recipe(draft);
        normalize(draft);
      },
      options ?? {},
    );

    if (!result.changed) return;

    set({
      document: { ...result.state, updatedAt: new Date().toISOString() },
      history: result.history,
      dirty: true,
    });
  },

  undo: () => {
    const { document, history } = get();
    const result = historyUndo(document, history);
    if (!result.changed) return;

    set({ document: result.state, history: result.history, dirty: true });
    get().select(pruneSelection(get().selection, result.state, get().activeFloorId));
  },

  redo: () => {
    const { document, history } = get();
    const result = historyRedo(document, history);
    if (!result.changed) return;

    set({ document: result.state, history: result.history, dirty: true });
    get().select(pruneSelection(get().selection, result.state, get().activeFloorId));
  },

  canUndo: () => historyCanUndo(get().history),
  canRedo: () => historyCanRedo(get().history),
  undoLabel: () => historyUndoLabel(get().history),
  redoLabel: () => historyRedoLabel(get().history),

  openDocument: (document) => {
    // History belongs to the document it was recorded against; carrying it
    // across would apply patches to a plan they were never taken from.
    set({
      document,
      history: clearHistory(),
      dirty: false,
      activeFloorId: document.floors[0]?.id ?? '',
      selection: [],
      viewport: DEFAULT_VIEWPORT,
    });
  },

  newDocument: () => {
    get().openDocument(createDocument());
  },

  markSaved: () => set({ dirty: false }),

  setDisplayUnit: (unit) => {
    get().commit('Change units', (draft) => {
      draft.unit = unit;
    });
  },

  createRoom: (spec) => {
    const floorId = get().activeFloorId;
    const floor = get().document.floors.find((entry) => entry.id === floorId);
    if (!floor) return;

    // Everything is worked out here, against the committed state, rather than
    // inside the Immer recipe. That keeps it to a single undo step: adding a
    // room and naming it is one action to the person who did it, so pressing
    // ctrl-Z once has to remove both.

    // Clear of anything already drawn, so a second room never lands on top of
    // the first.
    const existingNodes = allNodes(floor.graph).map((node) => ({ x: node.x, y: node.y }));
    const origin =
      existingNodes.length === 0
        ? { x: 0, y: 0 }
        : { x: boundingBox(existingNodes).maxX + NEW_ROOM_GAP, y: 0 };

    const graph = createRoomFromInnerSize(floor.graph, {
      width: spec.width,
      depth: spec.depth,
      thickness: spec.thickness,
      kind: 'exterior',
      origin,
    }).graph;

    // Reconcile up front so the room that just appeared can be named as part of
    // the same edit; the store's own pass afterwards then finds nothing to do.
    const before = new Set(floor.rooms.map((room) => room.id));
    const reconciled = reconcileFloor({ ...floor, graph });
    const fresh = reconciled.rooms.find((room) => !before.has(room.id));

    const rooms = reconciled.rooms.map((room) =>
      room.id === fresh?.id ? { ...room, name: spec.name, type: spec.type } : room,
    );

    get().commit('Add room', (draft) => {
      const target = draft.floors.find((entry) => entry.id === floorId);
      if (!target) return;

      target.graph = graph;
      target.rooms = rooms;
      target.ceilingHeight = spec.ceilingHeight;
    });

    if (fresh) get().select([{ kind: 'room', id: fresh.id }]);
  },

  setActiveFloor: (floorId) => {
    if (!findFloor(get().document, floorId)) return;
    // Selection is per floor; carrying it across would leave the inspector
    // showing something that is not on screen.
    set({ activeFloorId: floorId, selection: [] });
  },

  select: (targets, mode = 'replace') => {
    const current = get().selection;

    if (mode === 'replace') {
      set({ selection: [...targets] });
      return;
    }

    const next = [...current];
    for (const target of targets) {
      const at = next.findIndex((entry) => entry.kind === target.kind && entry.id === target.id);
      if (at >= 0) {
        if (mode === 'toggle') next.splice(at, 1);
      } else {
        next.push(target);
      }
    }

    set({ selection: next });
  },

  clearSelection: () => set({ selection: [] }),

  isSelected: (target) =>
    get().selection.some((entry) => entry.kind === target.kind && entry.id === target.id),

  setViewport: (viewport) => set({ viewport }),

  // Switching tools drops the selection: the inspector for a wall is not
  // relevant while a room is being drawn, and a stale selection makes Delete
  // do something surprising.
  setTool: (tool) => set({ tool, selection: [] }),
}));

/**
 * Drop selection entries pointing at things that no longer exist.
 *
 * Undoing the creation of a wall leaves it selected but gone; the inspector
 * would then be reading a dangling id.
 */
function pruneSelection(
  selection: readonly SelectionTarget[],
  document: HouseDocument,
  activeFloorId: FloorId,
): SelectionTarget[] {
  const floor = findFloor(document, activeFloorId);
  if (!floor) return [];

  return selection.filter((target) => {
    switch (target.kind) {
      case 'wall':
        return floor.graph.walls[target.id] !== undefined;
      case 'node':
        return floor.graph.nodes[target.id] !== undefined;
      case 'room':
        return floor.rooms.some((room) => room.id === target.id);
      case 'item':
        return floor.items.some((item) => item.id === target.id);
      case 'opening':
        return floor.openings.some((opening) => opening.id === target.id);
    }
  });
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** The floor currently being edited. */
export function activeFloor(state: EditorStore) {
  return findFloor(state.document, state.activeFloorId);
}

export function displayUnit(state: EditorStore): LengthUnit {
  return state.document.unit;
}
