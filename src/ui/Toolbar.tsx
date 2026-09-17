import { type ReactNode } from 'react';

import { boundingBox } from '../core/geometry/polygon.ts';
import { allNodes } from '../core/graph/wallGraph.ts';
import { fitTo, zoomAt } from '../views/plan2d/viewport.ts';
import { OPENING_PRESETS } from '../core/openings/defaults.ts';
import { findDefinition } from '../core/catalog/registry.ts';
import { activeFloor, useEditorStore, type ToolId } from '../state/store.ts';
import { FileMenu } from './FileMenu.tsx';

interface ToolDefinition {
  readonly id: ToolId;
  readonly label: string;
  /** Single key, shown in the tooltip and bound globally. */
  readonly shortcut: string;
  readonly hint: string;
  readonly icon: ReactNode;
}

const TOOLS: readonly ToolDefinition[] = [
  {
    id: 'select',
    label: 'Select',
    shortcut: 'V',
    hint: 'Click a wall or room. Drag a corner to move it.',
    icon: <path d="M4 3l9 7-4 .6L11 15l-2 .8-2-4.4L4 14z" fill="currentColor" />,
  },
  {
    id: 'draw-room',
    label: 'Room',
    shortcut: 'R',
    hint: 'Drag out a rectangle. Walls are shared with anything it meets.',
    icon: (
      <rect
        x="3"
        y="4"
        width="12"
        height="10"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    ),
  },
  {
    id: 'draw-wall',
    label: 'Wall',
    shortcut: 'W',
    hint: 'Click to place corners. Enter or right-click to finish, Escape to cancel.',
    icon: (
      <path
        d="M3 13V6h7v7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    ),
  },
  {
    id: 'place-opening',
    label: 'Door',
    shortcut: 'D',
    hint: 'Point at a wall to place the opening chosen on the right.',
    icon: (
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M4 14V4h5v10" />
        <path d="M9 4a6 6 0 016 6h-6" strokeDasharray="1.6 1.6" />
      </g>
    ),
  },
];

export function Toolbar() {
  const tool = useEditorStore((state) => state.tool);
  const setTool = useEditorStore((state) => state.setTool);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const canUndo = useEditorStore((state) => state.history.past.length > 0);
  const canRedo = useEditorStore((state) => state.history.future.length > 0);
  const undoLabel = useEditorStore((state) => state.history.past.at(-1)?.label ?? null);
  const redoLabel = useEditorStore((state) => state.history.future.at(-1)?.label ?? null);

  const activeHint = TOOLS.find((entry) => entry.id === tool)?.hint;

  return (
    <header
      className="flex h-12 shrink-0 items-center gap-3 border-b px-3"
      style={{ background: 'var(--surface-panel)', borderColor: 'var(--surface-border)' }}
    >
      <div className="flex items-center gap-2">
        <Logo />
        <span className="text-sm font-semibold tracking-tight">interiorDesign</span>
      </div>

      <Divider />

      <div role="toolbar" aria-label="Drawing tools" className="flex items-center gap-1">
        {TOOLS.map((entry) => (
          <ToolButton
            key={entry.id}
            active={tool === entry.id}
            label={entry.label}
            shortcut={entry.shortcut}
            onClick={() => setTool(entry.id)}
            testId={`tool-${entry.id}`}
          >
            {entry.icon}
          </ToolButton>
        ))}
      </div>

      <Divider />

      <FileMenu />

      <Divider />

      <div className="flex items-center gap-1">
        <IconButton
          label={undoLabel ? `Undo ${undoLabel.toLowerCase()}` : 'Undo'}
          shortcut="Ctrl+Z"
          disabled={!canUndo}
          onClick={undo}
          testId="undo"
        >
          <path
            d="M6 7H11a3.5 3.5 0 010 7H8M6 7l2.5-2.5M6 7l2.5 2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </IconButton>
        <IconButton
          label={redoLabel ? `Redo ${redoLabel.toLowerCase()}` : 'Redo'}
          shortcut="Ctrl+Shift+Z"
          disabled={!canRedo}
          onClick={redo}
          testId="redo"
        >
          <path
            d="M12 7H7a3.5 3.5 0 000 7h3M12 7L9.5 4.5M12 7L9.5 9.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </IconButton>
      </div>

      <Divider />

      {tool === 'place-opening' && <OpeningPresetPicker />}
      {tool === 'place-item' && <ArmedObject />}

      <ZoomControls />

      <p
        className="ml-auto hidden truncate pl-4 text-xs lg:block"
        style={{ color: 'var(--text-muted)' }}
      >
        {activeHint}
      </p>
    </header>
  );
}

/**
 * Which opening the tool will place next.
 *
 * Shown only while the tool is active. Choosing the size before placing rather
 * than correcting it afterwards matters because the width decides whether the
 * opening fits the wall at all — a 100cm entrance door simply will not go on a
 * 90cm return.
 */
function OpeningPresetPicker() {
  const presetId = useEditorStore((state) => state.openingPresetId);
  const setPreset = useEditorStore((state) => state.setOpeningPreset);

  return (
    <select
      value={presetId}
      aria-label="Opening type"
      data-testid="opening-preset"
      onChange={(event) => setPreset(event.target.value)}
      className="h-8 rounded border px-2 text-xs"
      style={{
        background: 'var(--surface-raised)',
        color: 'var(--text-primary)',
        borderColor: 'var(--surface-border-strong)',
      }}
    >
      {OPENING_PRESETS.map((preset) => (
        <option key={preset.id} value={preset.id}>
          {preset.label} — {preset.width / 10}cm
        </option>
      ))}
    </select>
  );
}

/**
 * What the placing tool is currently holding.
 *
 * There is no toolbar button for placing furniture: an object is chosen from
 * the catalogue, which is already an unambiguous instruction, and a tool button
 * that did nothing until you had also picked something would be a trap. This is
 * the tool's only presence in the toolbar — a reminder of what is in hand, and
 * the way to put it down.
 */
function ArmedObject() {
  const kind = useEditorStore((state) => state.placeItemKind);
  const setTool = useEditorStore((state) => state.setTool);
  const definition = kind ? findDefinition(kind) : null;

  if (!definition) return null;

  return (
    <div
      className="flex h-8 items-center gap-2 rounded px-2 text-xs"
      style={{ background: 'var(--color-accent-500)', color: '#fff' }}
      data-testid="armed-object"
    >
      <span>Placing {definition.label.toLowerCase()}</span>
      <button
        type="button"
        onClick={() => setTool('select')}
        aria-label="Stop placing"
        title="Stop placing (Escape)"
        data-testid="disarm-object"
        className="grid h-4 w-4 place-items-center rounded-full"
        style={{ background: 'rgba(255,255,255,0.25)' }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path
            d="M2 2l6 6M8 2l-6 6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

function ZoomControls() {
  const viewport = useEditorStore((state) => state.viewport);
  const setViewport = useEditorStore((state) => state.setViewport);
  const floor = useEditorStore(activeFloor);

  // Zoom about the middle of the view, which is the only anchor a button has.
  const zoom = (factor: number) => {
    const size = { width: 1000, height: 700 };
    setViewport(zoomAt(viewport, size, { x: size.width / 2, y: size.height / 2 }, factor));
  };

  const fit = () => {
    if (!floor) return;
    const points = allNodes(floor.graph).map((node) => ({ x: node.x, y: node.y }));
    if (points.length === 0) return;
    setViewport(fitTo(boundingBox(points), { width: 1000, height: 700 }, { padding: 64 }));
  };

  return (
    <div className="flex items-center gap-1">
      <IconButton label="Zoom out" onClick={() => zoom(1 / 1.4)} testId="zoom-out">
        <path d="M4 9h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </IconButton>
      <IconButton label="Zoom in" onClick={() => zoom(1.4)} testId="zoom-in">
        <path d="M9 4v10M4 9h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </IconButton>
      <IconButton label="Fit plan to view" shortcut="F" onClick={fit} testId="zoom-fit">
        <path
          d="M4 7V4h3M14 7V4h-3M4 11v3h3M14 11v3h-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </IconButton>
    </div>
  );
}

function ToolButton({
  active,
  label,
  shortcut,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  label: string;
  shortcut: string;
  onClick: () => void;
  children: ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={`${label} (${shortcut})`}
      data-testid={testId}
      className="flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors"
      style={{
        background: active ? 'var(--color-accent-500)' : 'transparent',
        color: active ? '#fff' : 'var(--text-secondary)',
      }}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        {children}
      </svg>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function IconButton({
  label,
  shortcut,
  disabled = false,
  onClick,
  children,
  testId,
}: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      data-testid={testId}
      className="grid h-8 w-8 place-items-center rounded transition-colors"
      style={{
        color: 'var(--text-secondary)',
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

function Divider() {
  return <div className="h-5 w-px" style={{ background: 'var(--surface-border-strong)' }} />;
}

function Logo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
      <rect
        x="1.5"
        y="1.5"
        width="15"
        height="15"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M1.5 10.5h7m0-9v15" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M11 6.5h3"
        stroke="var(--color-accent-500)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
