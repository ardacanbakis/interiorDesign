import { distance } from '../core/geometry/vec2.ts';
import { setWallLength } from '../core/graph/operations.ts';
import { ROOM_TYPES, type RoomType } from '../core/graph/roomIdentity.ts';
import {
  DEFAULT_WALL_THICKNESS,
  getWall,
  nodePoint,
  removeWall,
  updateWall,
  wallLength,
  type WallKind,
} from '../core/graph/wallGraph.ts';
import { maxOpeningWidth } from '../core/openings/geometry.ts';
import { roomsOf } from '../core/model/derive.ts';
import { type Floor } from '../core/model/schema.ts';
import { formatArea, formatLength } from '../core/units/length.ts';
import { activeFloor, useEditorStore } from '../state/store.ts';
import { LengthInput } from './LengthInput.tsx';

/**
 * The panel where measurements are typed.
 *
 * Deliberately the *authoritative* way to set a dimension, not a read-out of
 * what dragging produced. Everything here is a number someone will eventually
 * take to a shop, so the exact path has to be the easy one.
 */
export function Inspector() {
  const floor = useEditorStore(activeFloor);
  const selection = useEditorStore((state) => state.selection);

  if (!floor) return <Empty>No floor selected.</Empty>;

  if (selection.length === 0) {
    return (
      <Empty>Nothing selected. Click a wall or a room, or draw one with the tools above.</Empty>
    );
  }

  if (selection.length > 1) {
    return <Empty>{selection.length} things selected. Select one to edit its measurements.</Empty>;
  }

  const target = selection[0]!;

  if (target.kind === 'wall' && floor.graph.walls[target.id]) {
    return <WallInspector floor={floor} wallId={target.id} />;
  }

  if (target.kind === 'room') {
    return <RoomInspector floor={floor} roomId={target.id} />;
  }

  if (target.kind === 'opening' && floor.openings.some((entry) => entry.id === target.id)) {
    return <OpeningInspector floor={floor} openingId={target.id} />;
  }

  return <Empty>Nothing to edit.</Empty>;
}

const WALL_KIND_LABELS: Record<WallKind, string> = {
  exterior: 'Exterior',
  interior: 'Interior',
  partition: 'Partition',
};

function WallInspector({ floor, wallId }: { floor: Floor; wallId: string }) {
  const commit = useEditorStore((state) => state.commit);
  const select = useEditorStore((state) => state.select);
  const unit = useEditorStore((state) => state.document.unit);

  const wall = getWall(floor.graph, wallId);
  const length = Math.round(
    distance(nodePoint(floor.graph, wall.a), nodePoint(floor.graph, wall.b)),
  );

  const editFloor = (label: string, change: (floor: Floor) => void) => {
    commit(label, (draft) => {
      const target = draft.floors.find((entry) => entry.id === floor.id);
      if (target) change(target);
    });
  };

  return (
    <Section title="Wall">
      <LengthInput
        label="Length"
        value={length}
        unit={unit}
        min={1}
        onChange={(next) =>
          editFloor('Set wall length', (target) => {
            target.graph = setWallLength(target.graph, wallId, next);
          })
        }
        hint="Measured along the centreline, corner to corner."
      />

      <LengthInput
        label="Thickness"
        value={wall.thickness}
        unit={unit}
        min={10}
        max={1000}
        onChange={(next) =>
          editFloor('Set wall thickness', (target) => {
            target.graph = updateWall(target.graph, wallId, { thickness: next });
          })
        }
        hint="Split evenly between the rooms on either side."
      />

      <Field label="Type">
        <select
          value={wall.kind}
          data-testid="wall-kind"
          onChange={(event) => {
            const kind = event.target.value as WallKind;
            editFloor('Change wall type', (target) => {
              target.graph = updateWall(target.graph, wallId, {
                kind,
                thickness: DEFAULT_WALL_THICKNESS[kind],
              });
            });
          }}
          className="w-full rounded border px-2 py-1 text-xs"
          style={{
            background: 'var(--surface-raised)',
            color: 'var(--text-primary)',
            borderColor: 'var(--surface-border-strong)',
          }}
        >
          {(Object.keys(WALL_KIND_LABELS) as WallKind[]).map((kind) => (
            <option key={kind} value={kind}>
              {WALL_KIND_LABELS[kind]} ({DEFAULT_WALL_THICKNESS[kind]}mm)
            </option>
          ))}
        </select>
      </Field>

      <button
        type="button"
        data-testid="delete-wall"
        onClick={() => {
          editFloor('Delete wall', (target) => {
            target.graph = removeWall(target.graph, wallId);
          });
          select([]);
        }}
        className="mt-2 w-full rounded border py-1.5 text-xs font-medium"
        style={{
          borderColor: 'var(--color-severity-error)',
          color: 'var(--color-severity-error)',
        }}
      >
        Delete wall
      </button>
    </Section>
  );
}

/**
 * A door or window.
 *
 * Hinge and side are two buttons rather than a dropdown because they are the
 * fields most often wrong on first placement, and flipping them is something
 * you do while looking at the plan rather than while reading a list. Which way
 * a door opens decides whether it hits the bed.
 */
function OpeningInspector({ floor, openingId }: { floor: Floor; openingId: string }) {
  const updateOpening = useEditorStore((state) => state.updateOpening);
  const removeOpening = useEditorStore((state) => state.removeOpening);
  const unit = useEditorStore((state) => state.document.unit);

  const opening = floor.openings.find((entry) => entry.id === openingId);
  if (!opening) return <Empty>That opening is no longer there.</Empty>;

  const wall = floor.graph.walls[opening.wallId];
  const hostLength = wall ? Math.round(wallLength(floor.graph, wall)) : 0;
  const isDoor = opening.kind === 'door';

  return (
    <Section title={opening.label}>
      <LengthInput
        label="Width"
        value={opening.width}
        unit={unit}
        min={300}
        max={Math.max(300, maxOpeningWidth(hostLength))}
        onChange={(width) => updateOpening(openingId, { width })}
        hint={hostLength > 0 ? `Its wall is ${formatLength(hostLength, unit)} ${unit} long.` : ''}
      />

      <LengthInput
        label="Height"
        value={opening.height}
        unit={unit}
        min={300}
        max={3000}
        onChange={(height) => updateOpening(openingId, { height })}
      />

      <LengthInput
        label="From the corner"
        value={opening.offset}
        unit={unit}
        min={0}
        max={Math.max(0, hostLength)}
        onChange={(offset) => updateOpening(openingId, { offset })}
        hint="Centre of the opening, measured along the wall."
      />

      {!isDoor && (
        <LengthInput
          label="Sill height"
          value={opening.sillHeight}
          unit={unit}
          min={0}
          max={2500}
          onChange={(sillHeight) => updateOpening(openingId, { sillHeight })}
          hint="Height of the bottom of the opening above the floor."
        />
      )}

      {isDoor && (
        <>
          <Field label="Hinged at">
            <Toggle
              testId="opening-hinge"
              options={[
                { value: 'a', label: 'This end' },
                { value: 'b', label: 'That end' },
              ]}
              value={opening.hinge}
              onChange={(hinge) => updateOpening(openingId, { hinge: hinge as 'a' | 'b' })}
            />
          </Field>

          <Field label="Opens towards">
            <Toggle
              testId="opening-side"
              options={[
                { value: 'left', label: 'One side' },
                { value: 'right', label: 'The other' },
              ]}
              value={opening.side}
              onChange={(side) => updateOpening(openingId, { side: side as 'left' | 'right' })}
            />
          </Field>

          <Field label={`Open ${Math.round(opening.openAmount * 100)}%`}>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(opening.openAmount * 100)}
              data-testid="opening-amount"
              aria-label="How far open"
              onChange={(event) =>
                updateOpening(openingId, { openAmount: Number(event.target.value) / 100 })
              }
              className="w-full"
            />
          </Field>
        </>
      )}

      <button
        type="button"
        data-testid="delete-opening"
        onClick={() => removeOpening(openingId)}
        className="mt-2 w-full rounded border py-1.5 text-xs font-medium"
        style={{
          borderColor: 'var(--color-severity-error)',
          color: 'var(--color-severity-error)',
        }}
      >
        Delete {isDoor ? 'door' : 'opening'}
      </button>
    </Section>
  );
}

/** Two or three mutually exclusive choices, shown as a row of buttons. */
function Toggle({
  options,
  value,
  onChange,
  testId,
}: {
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  testId: string;
}) {
  return (
    <div
      className="flex overflow-hidden rounded border"
      style={{ borderColor: 'var(--surface-border-strong)' }}
      data-testid={testId}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className="flex-1 py-1 text-[11px]"
            style={{
              background: active ? 'var(--color-accent-500)' : 'var(--surface-raised)',
              color: active ? '#fff' : 'var(--text-secondary)',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function RoomInspector({ floor, roomId }: { floor: Floor; roomId: string }) {
  const commit = useEditorStore((state) => state.commit);
  const unit = useEditorStore((state) => state.document.unit);

  const room = roomsOf(floor).find((entry) => entry.props.id === roomId);
  if (!room) return <Empty>That room is no longer there.</Empty>;

  const setProps = (label: string, change: (props: { name: string; type: RoomType }) => void) => {
    commit(label, (draft) => {
      const target = draft.floors.find((entry) => entry.id === floor.id);
      const index = target?.rooms.findIndex((entry) => entry.id === roomId) ?? -1;
      if (!target || index < 0) return;

      const next = { ...target.rooms[index]! };
      change(next);
      target.rooms[index] = next;
    });
  };

  const width = Math.round(
    Math.max(...room.geometry.outline.map((p) => p.x)) -
      Math.min(...room.geometry.outline.map((p) => p.x)),
  );
  const depth = Math.round(
    Math.max(...room.geometry.outline.map((p) => p.y)) -
      Math.min(...room.geometry.outline.map((p) => p.y)),
  );

  return (
    <Section title="Room">
      <Field label="Name">
        <input
          type="text"
          value={room.props.name}
          data-testid="room-name"
          onChange={(event) =>
            setProps('Rename room', (props) => (props.name = event.target.value))
          }
          onKeyDown={(event) => event.stopPropagation()}
          className="w-full rounded border px-2 py-1 text-xs"
          style={{
            background: 'var(--surface-raised)',
            color: 'var(--text-primary)',
            borderColor: 'var(--surface-border-strong)',
          }}
        />
      </Field>

      <Field label="Used as">
        <select
          value={room.props.type}
          data-testid="room-type"
          onChange={(event) =>
            setProps('Change room type', (props) => (props.type = event.target.value as RoomType))
          }
          className="w-full rounded border px-2 py-1 text-xs capitalize"
          style={{
            background: 'var(--surface-raised)',
            color: 'var(--text-primary)',
            borderColor: 'var(--surface-border-strong)',
          }}
        >
          {ROOM_TYPES.map((type) => (
            <option key={type} value={type} className="capitalize">
              {type}
            </option>
          ))}
        </select>
      </Field>

      <dl className="tabular mt-1 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <Readout label="Floor area" value={`${formatArea(room.geometry.area)} m²`} />
        <Readout
          label="Perimeter"
          value={`${formatLength(Math.round(room.geometry.perimeter), unit)} ${unit}`}
        />
        <Readout label="Widest" value={`${formatLength(width, unit)} ${unit}`} />
        <Readout label="Deepest" value={`${formatLength(depth, unit)} ${unit}`} />
      </dl>

      <p className="mt-2 text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}>
        Measured inside the walls, so these are the numbers a tape measure gives. To change them,
        select a wall and set its length.
      </p>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>
        {title}
      </p>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </span>
      {children}
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt style={{ color: 'var(--text-muted)' }}>{label}</dt>
      <dd className="text-right" style={{ color: 'var(--text-primary)' }}>
        {value}
      </dd>
    </>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
      {children}
    </p>
  );
}
