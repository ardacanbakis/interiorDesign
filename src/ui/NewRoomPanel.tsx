import { useId, useState } from 'react';

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

  const valid = width > 0 && depth > 0;

  const submit = () => {
    if (!valid) return;

    createRoom({
      width,
      depth,
      thickness,
      ceilingHeight,
      name: name.trim() || defaultNameFor(type),
      type,
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
        {formatArea(width * depth)} m² of floor
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

/** A sensible name so the field can be left blank. */
function defaultNameFor(type: RoomType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}
