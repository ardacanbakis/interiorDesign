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
import { applyGraphEdit } from '../core/model/edits.ts';
import { createDocument, findFloor } from '../core/model/document.ts';
import {
  type FloorId,
  type HouseDocument,
  type Item,
  type ItemId,
  type OpeningId,
} from '../core/model/schema.ts';
import { type RoomId, type RoomType } from '../core/graph/roomIdentity.ts';
import {
  createLShapedRoom,
  createRoomFromInnerSize,
  type NotchCorner,
} from '../core/graph/operations.ts';
import { createItem, findDefinition } from '../core/catalog/registry.ts';
import { allNodes } from '../core/graph/wallGraph.ts';
import { boundingBox } from '../core/geometry/polygon.ts';
import { type Mm } from '../core/units/length.ts';
import { type NodeId, wallLength, type WallId } from '../core/graph/wallGraph.ts';
import { clampOffset, fitsOnWall } from '../core/openings/geometry.ts';
import { defaultPresetFor, openingFromPreset, presetById } from '../core/openings/defaults.ts';
import { type Opening, type OpeningKind } from '../core/model/schema.ts';
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

/** The three dimensions an object can be resized by before it is placed. */
export interface ItemSize {
  readonly width: Mm;
  readonly depth: Mm;
  readonly height: Mm;
}

/**
 * What a click on the canvas does.
 *
 * Deliberately few. A drawing tool that is also a selection tool is how
 * floor-plan editors end up with people accidentally dragging a wall across
 * the house while trying to click on it.
 */
export type ToolId =
  'select' | 'draw-room' | 'draw-wall' | 'place-opening' | 'place-window' | 'place-item';

/** The two opening tools, and which kind of preset each one places. */
export const OPENING_TOOLS: Readonly<
  Record<'place-opening' | 'place-window', Extract<OpeningKind, 'door' | 'window'>>
> = {
  'place-opening': 'door',
  'place-window': 'window',
};

export function isOpeningTool(tool: ToolId): tool is 'place-opening' | 'place-window' {
  return tool === 'place-opening' || tool === 'place-window';
}

export interface NewRoomSpec {
  /** Clear distance between wall faces. */
  readonly width: Mm;
  readonly depth: Mm;
  readonly thickness: Mm;
  readonly ceilingHeight: Mm;
  readonly name: string;
  readonly type: RoomType;
  /**
   * The corner to leave out, for an L-shaped room.
   *
   * Absent means a plain rectangle. Real houses are full of rooms with a
   * chimney breast or a stair bulkhead taking a corner, and a planner that
   * only does rectangles cannot describe most of them.
   */
  readonly notch?: {
    readonly width: Mm;
    readonly depth: Mm;
    readonly corner: NotchCorner;
  };
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

/**
 * How far a duplicate lands from its original.
 *
 * Far enough to be obviously a second object rather than a redraw of the first,
 * near enough that it is still where you were looking.
 */
const DUPLICATE_OFFSET: Mm = 300;

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

  /**
   * Which size each opening tool will place next.
   *
   * One per tool rather than one shared, so switching from doors to windows
   * and back does not lose the door size you had chosen. A doorway with no
   * door counts as a door for this purpose: it is the door tool that places it.
   */
  doorPresetId: string;
  windowPresetId: string;
  /** Remember a preset for whichever tool places its kind. */
  setOpeningPreset: (presetId: string) => void;
  /**
   * Put an opening on a wall at a distance along it, and select it.
   *
   * Without a preset, the active tool's own is used — a door from the door
   * tool, a window from the window tool, a door from anywhere else.
   */
  addOpening: (wallId: WallId, offset: Mm, presetId?: string) => void;
  updateOpening: (openingId: OpeningId, changes: Partial<Opening>) => void;
  removeOpening: (openingId: OpeningId) => void;

  /**
   * Which object the catalogue has armed for placing.
   *
   * Picking one is what switches to the placing tool, because choosing a
   * wardrobe and then having to find the tool is a step nobody wants.
   */
  placeItemKind: string | null;
  setPlaceItemKind: (kind: string | null) => void;
  /**
   * The size the armed object will be placed at.
   *
   * Set from the catalogue's defaults when an object is armed, and editable
   * before the click lands — because deciding a wardrobe is 2m wide *after*
   * placing it means placing it twice.
   */
  placeItemSize: ItemSize | null;
  setPlaceItemSize: (size: Partial<ItemSize>) => void;
  /** Drop an object on the plan and select it. Sized as asked, or by default. */
  addItem: (kind: string, x: Mm, y: Mm, rotation?: number, size?: ItemSize) => void;
  /**
   * Change an item. `coalesceKey` folds a drag into one undo step, so pressing
   * ctrl-Z once puts the wardrobe back where it started rather than walking it
   * home a pixel at a time.
   */
  updateItem: (itemId: ItemId, changes: Partial<Item>, coalesceKey?: string) => void;
  removeItem: (itemId: ItemId) => void;
  /** A copy, offset far enough to be visibly a second one, and selected. */
  duplicateItem: (itemId: ItemId) => void;

  /**
   * The issue the plan is currently pointing at, if any.
   *
   * Session state, not document state: which complaint you are looking at is a
   * view of the plan, and nobody presses ctrl-Z expecting to un-read one.
   */
  focusedIssueId: string | null;
  focusIssue: (issueId: string | null) => void;
  /**
   * Put a warning aside, or bring it back.
   *
   * Document edits, and undoable: muting is a decision about the plan, and
   * ctrl-Z after muting the wrong one is what anyone would reach for.
   */
  muteIssue: (issueId: string) => void;
  unmuteIssue: (issueId: string) => void;

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
  | 'document'
  | 'history'
  | 'dirty'
  | 'activeFloorId'
  | 'selection'
  | 'viewport'
  | 'tool'
  | 'doorPresetId'
  | 'windowPresetId'
  | 'placeItemKind'
  | 'placeItemSize'
  | 'focusedIssueId'
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
    doorPresetId: 'door-80',
    windowPresetId: 'window-120',
    placeItemKind: null,
    placeItemSize: null,
    focusedIssueId: null,
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

    const shape = {
      width: spec.width,
      depth: spec.depth,
      thickness: spec.thickness,
      kind: 'exterior' as const,
      origin,
    };

    // Through `applyGraphEdit` so that if the new room's walls happen to meet
    // something already drawn, any openings on what gets split move with it.
    const edited = applyGraphEdit(
      floor,
      spec.notch
        ? createLShapedRoom(floor.graph, {
            ...shape,
            notchWidth: spec.notch.width,
            notchDepth: spec.notch.depth,
            notchCorner: spec.notch.corner,
          })
        : createRoomFromInnerSize(floor.graph, shape),
    ).floor;
    const graph = edited.graph;

    // Reconcile up front so the room that just appeared can be named as part of
    // the same edit; the store's own pass afterwards then finds nothing to do.
    const before = new Set(floor.rooms.map((room) => room.id));
    const reconciled = reconcileFloor(edited);
    const fresh = reconciled.rooms.find((room) => !before.has(room.id));

    const rooms = reconciled.rooms.map((room) =>
      room.id === fresh?.id ? { ...room, name: spec.name, type: spec.type } : room,
    );

    get().commit('Add room', (draft) => {
      const target = draft.floors.find((entry) => entry.id === floorId);
      if (!target) return;

      target.graph = graph;
      target.openings = edited.openings;
      target.rooms = rooms;
      target.ceilingHeight = spec.ceilingHeight;
    });

    if (fresh) get().select([{ kind: 'room', id: fresh.id }]);
  },

  setOpeningPreset: (presetId) => {
    const preset = presetById(presetId);
    if (!preset) return;
    if (preset.kind === 'window') set({ windowPresetId: presetId });
    else set({ doorPresetId: presetId });
  },

  addOpening: (wallId, offset, presetId) => {
    const floorId = get().activeFloorId;
    const floor = get().document.floors.find((entry) => entry.id === floorId);
    const wall = floor?.graph.walls[wallId];
    if (!floor || !wall) return;

    const preset =
      presetById(presetId ?? activeOpeningPreset(get()).id) ?? defaultPresetFor('door');
    const length = wallLength(floor.graph, wall);

    // A door wider than the wall it is on is not a door. Better to refuse than
    // to place something that can never be built.
    if (!fitsOnWall(length, preset.width)) return;

    const id = nextOpeningId(floor.openings);
    const opening = openingFromPreset(
      id,
      preset,
      wallId,
      clampOffset(length, preset.width, offset),
    );

    get().commit('Add opening', (draft) => {
      const target = draft.floors.find((entry) => entry.id === floorId);
      target?.openings.push(opening);
    });

    get().select([{ kind: 'opening', id }]);
  },

  updateOpening: (openingId, changes) => {
    const floorId = get().activeFloorId;

    get().commit('Change opening', (draft) => {
      const target = draft.floors.find((entry) => entry.id === floorId);
      const index = target?.openings.findIndex((entry) => entry.id === openingId) ?? -1;
      if (!target || index < 0) return;

      const next = { ...target.openings[index]!, ...changes };
      const wall = target.graph.walls[next.wallId];
      if (wall) {
        // Re-clamp after any change: widening a door can push it off the end of
        // its wall, and the offset has to follow.
        const length = wallLength(target.graph, wall);
        next.width = Math.min(next.width, Math.floor(length));
        next.offset = clampOffset(length, next.width, next.offset);
      }

      target.openings[index] = next;
    });
  },

  removeOpening: (openingId) => {
    const floorId = get().activeFloorId;

    get().commit('Delete opening', (draft) => {
      const target = draft.floors.find((entry) => entry.id === floorId);
      if (!target) return;
      target.openings = target.openings.filter((entry) => entry.id !== openingId);
    });

    get().select([]);
  },

  setPlaceItemKind: (kind) => {
    if (kind === null) {
      set({ placeItemKind: null, placeItemSize: null });
      return;
    }

    const definition = findDefinition(kind);
    if (!definition) return;

    // Choosing an object *is* choosing to place one; the tool follows. Its
    // size starts at the catalogue's default and is editable from there.
    set({
      placeItemKind: kind,
      placeItemSize: {
        width: definition.defaults.width,
        depth: definition.defaults.depth,
        height: definition.defaults.height,
      },
      tool: 'place-item',
      selection: [],
    });
  },

  setPlaceItemSize: (size) => {
    const current = get().placeItemSize;
    if (!current) return;

    const next = { ...current, ...size };
    set({
      placeItemSize: {
        width: Math.max(1, Math.round(next.width)),
        depth: Math.max(1, Math.round(next.depth)),
        height: Math.max(1, Math.round(next.height)),
      },
    });
  },

  addItem: (kind, x, y, rotation = 0, size) => {
    const floorId = get().activeFloorId;
    const floor = get().document.floors.find((entry) => entry.id === floorId);
    if (!floor || !findDefinition(kind)) return;

    const id = nextItemId(floor.items);
    const item = { ...createItem(kind, id, x, y, rotation), ...(size ?? {}) };

    get().commit(`Add ${item.label.toLowerCase()}`, (draft) => {
      draft.floors.find((entry) => entry.id === floorId)?.items.push(item);
    });

    get().select([{ kind: 'item', id }]);
  },

  updateItem: (itemId, changes, coalesceKey) => {
    const floorId = get().activeFloorId;

    get().commit(
      'Change object',
      (draft) => {
        const target = draft.floors.find((entry) => entry.id === floorId);
        const index = target?.items.findIndex((entry) => entry.id === itemId) ?? -1;
        if (!target || index < 0) return;

        const next = { ...target.items[index]!, ...changes };

        // The model is whole millimetres and degrees within one turn. Letting a
        // drag write 1200.0000001 would make every later comparison lie.
        next.x = Math.round(next.x);
        next.y = Math.round(next.y);
        next.width = Math.max(1, Math.round(next.width));
        next.depth = Math.max(1, Math.round(next.depth));
        next.height = Math.max(1, Math.round(next.height));
        next.elevation = Math.max(0, Math.round(next.elevation));
        next.rotation = ((next.rotation % 360) + 360) % 360;

        target.items[index] = next;
      },
      coalesceKey === undefined ? {} : { coalesceKey },
    );
  },

  removeItem: (itemId) => {
    const floorId = get().activeFloorId;

    get().commit('Delete object', (draft) => {
      const target = draft.floors.find((entry) => entry.id === floorId);
      if (!target) return;
      target.items = target.items.filter((entry) => entry.id !== itemId);
    });

    get().select([]);
  },

  duplicateItem: (itemId) => {
    const floorId = get().activeFloorId;
    const floor = get().document.floors.find((entry) => entry.id === floorId);
    const original = floor?.items.find((entry) => entry.id === itemId);
    if (!floor || !original) return;

    const id = nextItemId(floor.items);
    const copy = {
      ...original,
      id,
      params: { ...original.params },
      x: original.x + DUPLICATE_OFFSET,
      y: original.y + DUPLICATE_OFFSET,
    };

    get().commit(`Duplicate ${original.label.toLowerCase()}`, (draft) => {
      draft.floors.find((entry) => entry.id === floorId)?.items.push(copy);
    });

    get().select([{ kind: 'item', id }]);
  },

  focusIssue: (issueId) => set({ focusedIssueId: issueId }),

  muteIssue: (issueId) => {
    const floorId = get().activeFloorId;
    get().commit('Mute warning', (draft) => {
      const target = draft.floors.find((entry) => entry.id === floorId);
      if (!target || target.mutedIssues.includes(issueId)) return;
      target.mutedIssues.push(issueId);
    });
    if (get().focusedIssueId === issueId) set({ focusedIssueId: null });
  },

  unmuteIssue: (issueId) => {
    const floorId = get().activeFloorId;
    get().commit('Unmute warning', (draft) => {
      const target = draft.floors.find((entry) => entry.id === floorId);
      if (!target) return;
      target.mutedIssues = target.mutedIssues.filter((entry) => entry !== issueId);
    });
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
  // do something surprising. Leaving the placing tool also disarms the
  // catalogue — an object is placed by choosing it, so a tool still holding one
  // after you have moved on is a loaded gun.
  setTool: (tool) =>
    set(
      tool === 'place-item'
        ? { tool, selection: [] }
        : { tool, selection: [], placeItemKind: null, placeItemSize: null },
    ),
}));

/** Ids run o1, o2, … continuing from the highest already on the floor. */
function nextOpeningId(openings: readonly Opening[]): string {
  return nextId(openings, 'o');
}

/** Items run i1, i2, … on the same principle. */
function nextItemId(items: readonly Item[]): string {
  return nextId(items, 'i');
}

/**
 * The next id in a prefixed sequence.
 *
 * Continuing from the highest rather than counting the entries: deleting the
 * third of three and adding another must not hand out an id that an undo would
 * bring a second holder back for.
 */
function nextId(existing: readonly { readonly id: string }[], prefix: string): string {
  let highest = 0;
  for (const entry of existing) {
    if (!entry.id.startsWith(prefix)) continue;
    const suffix = Number(entry.id.slice(prefix.length));
    if (Number.isInteger(suffix) && suffix > highest) highest = suffix;
  }
  return `${prefix}${highest + 1}`;
}

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

/** The size the active opening tool would place. Doors when no such tool is up. */
export function activeOpeningPreset(state: EditorStore) {
  const id = state.tool === 'place-window' ? state.windowPresetId : state.doorPresetId;
  const kind = isOpeningTool(state.tool) ? OPENING_TOOLS[state.tool] : 'door';
  return presetById(id) ?? defaultPresetFor(kind);
}

/** The floor currently being edited. */
export function activeFloor(state: EditorStore) {
  return findFloor(state.document, state.activeFloorId);
}

export function displayUnit(state: EditorStore): LengthUnit {
  return state.document.unit;
}
