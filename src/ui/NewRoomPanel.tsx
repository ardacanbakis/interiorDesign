import { useId, useState } from 'react';

import { MIN_ARM, type NotchCorner } from '../core/graph/operations.ts';
import { ROOM_TYPES, type RoomType } from '../core/graph/roomIdentity.ts';
import { DEFAULT_WALL_THICKNESS } from '../core/graph/wallGraph.ts';
import { FLOOR_DEFAULTS } from '../core/model/document.ts';
import { formatArea, type Mm } from '../core/units/length.ts';
import { activeFloor, useEditorStore } from '../state/store.ts';
import { LengthInput } from './LengthInput.tsx';

/**
 * Starting a room from its measurements.
 *
 * The fastest path from a tape measure to a plan, and the one that matters most
 * when a single room is the unit of work: drawing a rectangle by eye and then
 * correcting four wall lengths is three steps too many when the numbers are
 * already written on the back of an envelope.
 *
 * The width and depth asked for here are the **clear distance between wall
 * faces** — what a tape measure gives. The walls are then built outside that,
 * so the room comes out measuring exactly what was typed rather than that
 * minus a wall. The live area readout is there to make the promise checkable
 * before anything is committed.
 */
export function NewRoomPanel({ onDone }: { onDone?: () => void }) {
  const floor = useEditorStore(activeFloor);
  const createRoom = useEditorStore((state) => state.createRoom);
  const unit = useEditorStore((state) => state.document.unit);

  const headingId = useId();
  const nameId = useId();
  const typeId = useId();

  const [width, setWidth] = useState<Mm>(3600);
  const [depth, setDepth] = useState<Mm>(4200);
  const [thickness, setThickness] = useState<Mm>(DEFAULT_WALL_THICKNESS.interior);
  const [ceilingHeight, setCeilingHeight] = useState<Mm>(
    floor?.ceilingHeight ?? FLOOR_DEFAULTS.ceilingHeight,
  );
  const [name, setName] = useState('');
  const [type, setType] = useState<RoomType>('bedroom');

  const [shape, setShape] = useState<'rectangle' | 'l-shape'>('rectangle');
  const [notchWidth, setNotchWidth] = useState<Mm>(1500);
  const [notchDepth, setNotchDepth] = useState<Mm>(1200);
  const [notchCorner, setNotchCorner] = useState<NotchCorner>('top-right');

  const isL = shape === 'l-shape';

  // An arm thinner than the minimum makes walls that overlap their own
  // neighbours, so the form refuses it rather than drawing something nobody
  // asked for.
  const notchFits =
    notchWidth > 0 &&
    notchDepth > 0 &&
    width - notchWidth >= MIN_ARM &&
    depth - notchDepth >= MIN_ARM;

  const valid = width > 0 && depth > 0 && (!isL || notchFits);
  const area = isL ? width * depth - notchWidth * notchDepth : width * depth;

  const submit = () => {
    if (!valid) return;

    createRoom({
      width,
      depth,
      thickness,
      ceilingHeight,
      name: name.trim() || defaultNameFor(type),
      type,
      ...(isL ? { notch: { width: notchWidth, depth: notchDepth, corner: notchCorner } } : {}),
    });

    setName('');
    onDone?.();
  };

  return (
    <form
      aria-labelledby={headingId}
      data-testid="new-room-panel"
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div>
        <p id={headingId} className="text-[11px] font-semibold">
          New room
        </p>
        <p className="mt-0.5 text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}>
          Measure wall face to wall face — the walls go outside these numbers.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label="Room shape"
        className="flex overflow-hidden rounded border"
        style={{ borderColor: 'var(--surface-border-strong)' }}
      >
        {(
          [
            ['rectangle', 'Rectangle'],
            ['l-shape', 'L-shape'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={shape === id}
            data-testid={`shape-${id}`}
            onClick={() => setShape(id)}
            className="flex-1 py-1 text-[11px]"
            style={{
              background: shape === id ? 'var(--color-accent-500)' : 'var(--surface-raised)',
              color: shape === id ? '#fff' : 'var(--text-secondary)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <LengthInput
          label="Width"
          value={width}
          unit={unit}
          min={500}
          max={30_000}
          onChange={setWidth}
        />
        <LengthInput
          label="Depth"
          value={depth}
          unit={unit}
          min={500}
          max={30_000}
          onChange={setDepth}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <LengthInput
          label="Ceiling"
          value={ceilingHeight}
          unit={unit}
          min={1800}
          max={6000}
          onChange={setCeilingHeight}
        />
        <LengthInput
          label="Wall thickness"
          value={thickness}
          unit={unit}
          min={50}
          max={600}
          onChange={setThickness}
        />
      </div>

      {isL && (
        <div className="flex flex-col gap-2">
          <p className="text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}>
            Width and depth above are the whole rectangle. This is the corner taken out of it.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <LengthInput
              label="Corner width"
              value={notchWidth}
              unit={unit}
              min={100}
              max={Math.max(100, width - MIN_ARM)}
              onChange={setNotchWidth}
            />
            <LengthInput
              label="Corner depth"
              value={notchDepth}
              unit={unit}
              min={100}
              max={Math.max(100, depth - MIN_ARM)}
              onChange={setNotchDepth}
            />
          </div>

          <ShapePreview
            width={width}
            depth={depth}
            notchWidth={notchWidth}
            notchDepth={notchDepth}
            corner={notchCorner}
            onPick={setNotchCorner}
          />

          {!notchFits && (
            <p
              className="text-[10px] leading-snug"
              style={{ color: 'var(--color-severity-error)' }}
              data-testid="notch-problem"
            >
              The corner leaves less than {MIN_ARM / 10}cm of room beside it. Make it smaller, or
              the room bigger.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor={typeId} className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          Used as
        </label>
        <select
          id={typeId}
          value={type}
          data-testid="new-room-type"
          onChange={(event) => setType(event.target.value as RoomType)}
          className="w-full rounded border px-2 py-1 text-xs capitalize"
          style={{
            background: 'var(--surface-raised)',
            color: 'var(--text-primary)',
            borderColor: 'var(--surface-border-strong)',
          }}
        >
          {ROOM_TYPES.map((entry) => (
            <option key={entry} value={entry} className="capitalize">
              {entry}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={nameId} className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          Name
        </label>
        <input
          id={nameId}
          type="text"
          value={name}
          data-testid="new-room-name"
          placeholder={defaultNameFor(type)}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          className="w-full rounded border px-2 py-1 text-xs"
          style={{
            background: 'var(--surface-raised)',
            color: 'var(--text-primary)',
            borderColor: 'var(--surface-border-strong)',
          }}
        />
      </div>

      <p
        className="tabular rounded px-2 py-1.5 text-center text-xs"
        data-testid="new-room-preview"
        style={{ background: 'var(--surface-app)', color: 'var(--text-secondary)' }}
      >
        {formatArea(area)} m² of floor
      </p>

      <button
        type="submit"
        disabled={!valid}
        data-testid="create-room"
        className="w-full rounded py-1.5 text-xs font-medium"
        style={{
          background: valid ? 'var(--color-accent-500)' : 'var(--surface-border-strong)',
          color: '#fff',
          cursor: valid ? 'pointer' : 'not-allowed',
        }}
      >
        Create room
      </button>
    </form>
  );
}

/**
 * The room, as it will be, with the corners as buttons.
 *
 * Which corner is missing is a spatial question, and four words in a dropdown
 * are a poor way to ask it — you would place the room, look at it, and come
 * back. Clicking the corner on a picture of the room is the same decision made
 * by looking, and the outline is drawn from the live measurements so the shape
 * is the one that will be built.
 */
function ShapePreview({
  width,
  depth,
  notchWidth,
  notchDepth,
  corner,
  onPick,
}: {
  width: Mm;
  depth: Mm;
  notchWidth: Mm;
  notchDepth: Mm;
  corner: NotchCorner;
  onPick: (corner: NotchCorner) => void;
}) {
  // Drawn in its own units and scaled by the viewBox, so the preview is the
  // room's real proportions rather than a generic L.
  const nw = Math.min(notchWidth, width);
  const nd = Math.min(notchDepth, depth);

  const outline: Record<NotchCorner, string> = {
    'top-right': `M0 0 H${width - nw} V${nd} H${width} V${depth} H0 Z`,
    'top-left': `M${nw} 0 H${width} V${depth} H0 V${nd} H${nw} Z`,
    'bottom-right': `M0 0 H${width} V${depth - nd} H${width - nw} V${depth} H0 Z`,
    'bottom-left': `M0 0 H${width} V${depth} H${nw} V${depth - nd} H0 Z`,
  };

  const corners: { id: NotchCorner; x: number; y: number }[] = [
    { id: 'top-left', x: 0, y: 0 },
    { id: 'top-right', x: width, y: 0 },
    { id: 'bottom-left', x: 0, y: depth },
    { id: 'bottom-right', x: width, y: depth },
  ];

  // Screen-constant handles: the viewBox is in millimetres, so a fixed radius
  // would be invisible in a big room and enormous in a small one.
  const handle = Math.max(width, depth) / 14;

  return (
    <svg
      viewBox={`${-handle} ${-handle} ${width + handle * 2} ${depth + handle * 2}`}
      className="w-full"
      style={{ maxHeight: 150 }}
      role="group"
      aria-label="Which corner is missing"
      data-testid="shape-preview"
    >
      <path
        d={outline[corner]}
        fill="var(--plan-room-fill)"
        stroke="var(--plan-ink)"
        strokeWidth={handle / 6}
        strokeLinejoin="round"
      />

      {corners.map((entry) => (
        <circle
          key={entry.id}
          cx={entry.x}
          cy={entry.y}
          r={handle / 2}
          data-testid={`corner-${entry.id}`}
          aria-label={entry.id.replace('-', ' ')}
          aria-pressed={corner === entry.id}
          role="button"
          tabIndex={0}
          style={{ cursor: 'pointer' }}
          fill={corner === entry.id ? 'var(--color-accent-500)' : 'var(--surface-raised)'}
          stroke="var(--surface-border-strong)"
          strokeWidth={handle / 10}
          onClick={() => onPick(entry.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onPick(entry.id);
            }
          }}
        />
      ))}
    </svg>
  );
}

/** A sensible name so the field can be left blank. */
function defaultNameFor(type: RoomType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}
