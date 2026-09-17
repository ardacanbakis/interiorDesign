import { useState, type ReactNode } from 'react';

import { floorArea, roomsOf } from '../core/model/derive.ts';
import { formatArea } from '../core/units/length.ts';
import { type SaveState } from '../persistence/autosave.ts';
import { activeFloor, useEditorStore } from '../state/store.ts';
import { PlanCanvas } from '../views/plan2d/PlanCanvas.tsx';
import { Inspector } from './Inspector.tsx';
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
        <SidePanel side="left" title="Rooms">
          <RoomList />
        </SidePanel>

        <main className="relative min-w-0 flex-1">
          <PlanCanvas />
        </main>

        <SidePanel side="right" title="Inspector">
          <Inspector />
        </SidePanel>
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

function SidePanel({
  side,
  title,
  children,
}: {
  side: 'left' | 'right';
  title: string;
  children: ReactNode;
}) {
  return (
    <aside
      className={`hidden w-64 shrink-0 flex-col overflow-y-auto md:flex ${
        side === 'left' ? 'border-r' : 'border-l'
      }`}
      style={{ background: 'var(--surface-panel)', borderColor: 'var(--surface-border)' }}
      aria-label={title}
    >
      <h2
        className="sticky top-0 z-10 border-b px-3 py-2 text-[11px] font-semibold tracking-wider uppercase"
        style={{
          background: 'var(--surface-panel)',
          borderColor: 'var(--surface-border)',
          color: 'var(--text-muted)',
        }}
      >
        {title}
      </h2>
      <div className="p-3">{children}</div>
    </aside>
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
        </>
      )}
    </footer>
  );
}
