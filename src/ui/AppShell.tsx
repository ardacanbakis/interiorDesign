import { useState, type ReactNode } from 'react';

import { floorArea, roomsOf } from '../core/model/derive.ts';
import { activeIssues, countBySeverity } from '../core/rules/engine.ts';
import { formatArea } from '../core/units/length.ts';
import { type SaveState } from '../persistence/autosave.ts';
import { activeFloor, useEditorStore } from '../state/store.ts';
import { PlanCanvas } from '../views/plan2d/PlanCanvas.tsx';
import { CataloguePanel } from './CataloguePanel.tsx';
import { Inspector } from './Inspector.tsx';
import { IssuesPanel } from './IssuesPanel.tsx';
import { NewRoomPanel } from './NewRoomPanel.tsx';
import { Toolbar } from './Toolbar.tsx';
import { useKeyboardShortcuts } from './useKeyboardShortcuts.ts';

export interface AppShellProps {
  readonly saveState?: SaveState;
  /** False when storage is unavailable, so nothing will be kept. */
  readonly persistent?: boolean;
  readonly restoring?: boolean;
}

/**
 * The application frame.
 *
 * A fixed toolbar, a three-column body, and a status bar. The plan column is
 * the only one that grows; the side panels are fixed-width so the drawing area
 * is never squeezed, and they fold away below tablet width where a phone is
 * really only going to be reading the plan.
 */
export function AppShell({
  saveState = 'idle',
  persistent = true,
  restoring = false,
}: AppShellProps) {
  useKeyboardShortcuts();

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--surface-app)' }}>
      <Toolbar />

      {!persistent && <StorageWarning />}

      <div className="flex min-h-0 flex-1">
        <LeftPanel />

        <main className="relative min-w-0 flex-1">
          <PlanCanvas />
        </main>

        <RightPanel />
      </div>

      <StatusBar saveState={saveState} restoring={restoring} />
    </div>
  );
}

/**
 * Every room on this floor.
 *
 * Doubles as the answer to "did that wall actually close the room?" — a shape
 * that looks enclosed but is not simply does not appear here, which is a far
 * quicker diagnosis than hunting for the gap on the canvas.
 */
function RoomList() {
  const floor = useEditorStore(activeFloor);
  const select = useEditorStore((state) => state.select);
  const selection = useEditorStore((state) => state.selection);
  const [adding, setAdding] = useState(false);

  if (!floor) return <Note>No floor selected.</Note>;

  // Derived rather than read from `room.lastArea`: that field caches the
  // *centreline* area and exists only to decide which name survives a merge.
  // Showing it here would put a different number beside the room's name than
  // the one printed inside it on the canvas.
  const rooms = roomsOf(floor);

  // An empty plan opens straight onto the form rather than an instruction to go
  // and draw something. Typing the measurements is the point.
  if (rooms.length === 0 || adding) {
    return (
      <div className="flex flex-col gap-3">
        <NewRoomPanel onDone={() => setAdding(false)} />
        {adding && (
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="text-[11px] underline"
            style={{ color: 'var(--text-muted)' }}
          >
            Cancel
          </button>
        )}
        {rooms.length === 0 && (
          <Note>Or draw one with the Room or Wall tool — a room appears by itself.</Note>
        )}
      </div>
    );
  }

  const selectedIds = new Set(
    selection.filter((entry) => entry.kind === 'room').map((entry) => entry.id),
  );

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-0.5">
        {rooms.map(({ props, geometry }) => {
          const selected = selectedIds.has(props.id);
          return (
            <li key={props.id}>
              <button
                type="button"
                data-testid={`room-list-${props.id}`}
                onClick={() => select([{ kind: 'room', id: props.id }])}
                className="flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left text-xs"
                style={{
                  background: selected ? 'var(--color-accent-500)' : 'transparent',
                  color: selected ? '#fff' : 'var(--text-primary)',
                }}
              >
                <span className="truncate">{props.name}</span>
                <span
                  className="tabular shrink-0 text-[10px]"
                  style={{ color: selected ? 'rgba(255,255,255,0.8)' : 'var(--text-muted)' }}
                >
                  {formatArea(geometry.area)} m²
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        data-testid="add-room"
        onClick={() => setAdding(true)}
        className="w-full rounded border border-dashed py-1.5 text-[11px]"
        style={{ borderColor: 'var(--surface-border-strong)', color: 'var(--text-secondary)' }}
      >
        Add room
      </button>
    </div>
  );
}

/**
 * Rooms and the catalogue, as two tabs.
 *
 * They are the same kind of thing — what to add to the plan — and both want the
 * full height of the panel. Stacking them would give the catalogue about four
 * visible rows, which for sixty objects is a scroll bar with a hint of a list
 * attached.
 */
function LeftPanel() {
  const [tab, setTab] = useState<'rooms' | 'objects'>('rooms');
  const armed = useEditorStore((state) => state.placeItemKind);

  // Arming an object from anywhere brings its tab forward, so the highlighted
  // entry is never hidden behind the room list.
  const [lastArmed, setLastArmed] = useState(armed);
  if (lastArmed !== armed) {
    setLastArmed(armed);
    if (armed) setTab('objects');
  }

  return (
    <aside
      className="hidden w-64 shrink-0 flex-col overflow-y-auto border-r md:flex"
      style={{ background: 'var(--surface-panel)', borderColor: 'var(--surface-border)' }}
      aria-label={tab === 'rooms' ? 'Rooms' : 'Objects'}
    >
      <div
        role="tablist"
        aria-label="Left panel"
        className="sticky top-0 z-10 flex border-b"
        style={{ background: 'var(--surface-panel)', borderColor: 'var(--surface-border)' }}
      >
        {(['rooms', 'objects'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            data-testid={`tab-${id}`}
            onClick={() => setTab(id)}
            className="flex-1 px-3 py-2 text-[11px] font-semibold tracking-wider uppercase"
            style={{
              color: tab === id ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom:
                tab === id ? '2px solid var(--color-accent-500)' : '2px solid transparent',
            }}
          >
            {id}
          </button>
        ))}
      </div>

      <div className="p-3">{tab === 'rooms' ? <RoomList /> : <CataloguePanel />}</div>
    </aside>
  );
}

/**
 * The inspector and the checker, as two tabs.
 *
 * The check is the point of the whole project — "will it actually fit" — so it
 * is one click from wherever you are, and the tab carries its own count. It
 * comes forward by itself the first time something goes wrong, because a
 * warning you have to go looking for is one you find out about after the
 * wardrobe has been delivered; after that it stays where you put it.
 */
function RightPanel() {
  const floor = useEditorStore(activeFloor);
  const focused = useEditorStore((state) => state.focusedIssueId);
  const issues = floor ? activeIssues(floor) : [];
  const { errors, warnings } = countBySeverity(issues);

  const [tab, setTab] = useState<'inspector' | 'issues'>('inspector');

  // Clicking a row in the panel is the other way in; if something out there
  // focused an issue, this is the tab that shows it.
  const [lastFocused, setLastFocused] = useState(focused);
  if (lastFocused !== focused) {
    setLastFocused(focused);
    if (focused) setTab('issues');
  }

  // One nudge, the first time a plan goes from clean to not.
  const [announced, setAnnounced] = useState(errors > 0);
  if (announced !== errors > 0) {
    setAnnounced(errors > 0);
    if (errors > 0) setTab('issues');
  }

  return (
    <aside
      className="hidden w-64 shrink-0 flex-col overflow-y-auto border-l md:flex"
      style={{ background: 'var(--surface-panel)', borderColor: 'var(--surface-border)' }}
      aria-label={tab === 'inspector' ? 'Inspector' : 'Issues'}
    >
      <div
        role="tablist"
        aria-label="Right panel"
        className="sticky top-0 z-10 flex border-b"
        style={{ background: 'var(--surface-panel)', borderColor: 'var(--surface-border)' }}
      >
        {(['inspector', 'issues'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            data-testid={`tab-${id}`}
            onClick={() => setTab(id)}
            className="flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-semibold tracking-wider uppercase"
            style={{
              color: tab === id ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom:
                tab === id ? '2px solid var(--color-accent-500)' : '2px solid transparent',
            }}
          >
            {id}
            {id === 'issues' && issues.length > 0 && (
              <span
                className="tabular rounded-full px-1.5 text-[10px] font-semibold"
                data-testid="issues-count"
                style={{
                  background:
                    errors > 0 ? 'var(--color-severity-error)' : 'var(--color-severity-warning)',
                  color: '#fff',
                }}
              >
                {errors + warnings}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="p-3">{tab === 'inspector' ? <Inspector /> : <IssuesPanel />}</div>
    </aside>
  );
}

function StorageWarning() {
  return (
    <div
      role="status"
      className="shrink-0 px-3 py-1.5 text-xs"
      style={{
        background: 'color-mix(in oklab, var(--color-severity-warning) 18%, transparent)',
        color: 'var(--text-primary)',
      }}
    >
      This browser will not let the app store anything, so your plan will be lost when you close the
      tab. Export it to a file to keep it.
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
      {children}
    </p>
  );
}

const SAVE_LABELS: Record<SaveState, string> = {
  idle: 'Ready',
  pending: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Could not save',
};

function StatusBar({ saveState, restoring }: { saveState: SaveState; restoring: boolean }) {
  const floor = useEditorStore(activeFloor);
  const roomCount = floor?.rooms.length ?? 0;
  const itemCount = floor?.items.length ?? 0;
  const area = floor ? floorArea(floor) : 0;

  return (
    <footer
      className="tabular flex h-7 shrink-0 items-center gap-4 border-t px-3 text-[11px]"
      style={{
        background: 'var(--surface-panel)',
        borderColor: 'var(--surface-border)',
        color: 'var(--text-muted)',
      }}
    >
      <span
        data-testid="save-state"
        style={saveState === 'error' ? { color: 'var(--color-severity-error)' } : undefined}
      >
        {restoring ? 'Opening…' : SAVE_LABELS[saveState]}
      </span>

      {floor && (
        <>
          <span>{floor.name}</span>
          <span data-testid="room-count">{roomCount === 1 ? '1 room' : `${roomCount} rooms`}</span>
          {area > 0 && <span data-testid="floor-area">{formatArea(area)} m²</span>}
          {itemCount > 0 && (
            <span data-testid="item-count">
              {itemCount === 1 ? '1 object' : `${itemCount} objects`}
            </span>
          )}
        </>
      )}
    </footer>
  );
}
