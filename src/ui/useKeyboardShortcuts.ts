import { useEffect } from 'react';

import { boundingBox } from '../core/geometry/polygon.ts';
import { allNodes, removeWall } from '../core/graph/wallGraph.ts';
import { frame } from '../core/scene/camera.ts';
import { planBounds } from '../core/scene/build.ts';
import { downloadDocument } from '../persistence/file.ts';
import { fitTo } from '../views/plan2d/viewport.ts';
import { useEditorStore, type ToolId } from '../state/store.ts';

/**
 * A nominal canvas, for the shortcuts that frame the view.
 *
 * The keyboard has no element to measure. Both framing functions take the
 * narrower of the two fields of view, so for any landscape window the answer is
 * the same whatever the exact pixels — and the buttons, which do know their
 * size, use the real one.
 */
const NOMINAL_CANVAS = { width: 1000, height: 700 };

/**
 * Global keyboard shortcuts.
 *
 * Bound on the window so they work wherever the focus is — except inside a text
 * field, where every one of these keys means something else. Pressing R while
 * naming a room should type an R, not switch to the room tool.
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingInto(event.target)) return;

      const store = useEditorStore.getState();
      const meta = event.metaKey || event.ctrlKey;

      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }

      if (meta && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        store.redo();
        return;
      }

      // The file keys people already have in their fingers. Each one is also a
      // browser shortcut, so each has to be taken over explicitly — and each is
      // worth taking over, because "save the page" and "new window" are never
      // what someone means while looking at a floor plan.
      if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault();
        downloadDocument(store.document);
        return;
      }

      if (meta && (event.key.toLowerCase() === 'o' || event.key.toLowerCase() === 'n')) {
        event.preventDefault();
        // Opening and starting again both belong to the file menu, which owns
        // the file input and the confirmation. Clicking its button is the
        // honest way to reach them rather than duplicating either here.
        const selector = event.key.toLowerCase() === 'o' ? 'open-file' : 'new-file';
        const button = window.document.querySelector<HTMLButtonElement>(
          `[data-testid="${selector}"]`,
        );
        button?.click();
        return;
      }

      // Modified keys past this point belong to the browser.
      if (meta || event.altKey) return;

      // Reaching for a tool is a request to go and draw, so it brings the plan
      // back — the same thing clicking the tool does. See `Toolbar`.
      const pickTool = (tool: ToolId) => {
        store.setTool(tool);
        if (store.view === 'scene') store.setView('plan');
      };

      // Shift+W: a window is the thing that goes in a wall, and W was taken.
      if (event.shiftKey && event.key.toLowerCase() === 'w') {
        pickTool('place-window');
        return;
      }

      switch (event.key.toLowerCase()) {
        case '2':
          store.setView('plan');
          break;
        case '3':
          store.setView('scene');
          break;
        case 'v':
          pickTool('select');
          break;
        case 'r':
          pickTool('draw-room');
          break;
        case 'w':
          pickTool('draw-wall');
          break;
        case 'd':
          pickTool('place-opening');
          break;
        case 'f': {
          const floor = store.document.floors.find((entry) => entry.id === store.activeFloorId);
          if (!floor) break;

          if (store.view === 'scene') {
            const bounds = planBounds(floor);
            if (bounds) {
              store.setCamera(frame(bounds, floor.ceilingHeight, NOMINAL_CANVAS, store.camera));
            }
            break;
          }

          const points = allNodes(floor.graph).map((node) => ({ x: node.x, y: node.y }));
          if (points.length === 0) break;
          store.setViewport(fitTo(boundingBox(points), NOMINAL_CANVAS, { padding: 64 }));
          break;
        }
        case 'delete':
        case 'backspace': {
          const openings = store.selection.filter((entry) => entry.kind === 'opening');
          const walls = store.selection.filter((entry) => entry.kind === 'wall');
          const items = store.selection.filter((entry) => entry.kind === 'item');
          if (openings.length === 0 && walls.length === 0 && items.length === 0) break;

          event.preventDefault();

          for (const opening of openings) store.removeOpening(opening.id);
          for (const item of items) store.removeItem(item.id);

          if (walls.length > 0) {
            store.commit('Delete wall', (draft) => {
              const floor = draft.floors.find((entry) => entry.id === store.activeFloorId);
              if (!floor) return;
              for (const wall of walls) floor.graph = removeWall(floor.graph, wall.id);
            });
            store.select([]);
          }
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

function isTypingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}
