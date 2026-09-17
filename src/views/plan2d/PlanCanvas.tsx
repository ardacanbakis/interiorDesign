import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { boundingBox } from '../../core/geometry/polygon.ts';
import { type Vec2 } from '../../core/geometry/vec2.ts';
import { allNodes } from '../../core/graph/wallGraph.ts';
import { drawRoomRect, drawWallRun, setWallLength } from '../../core/graph/operations.ts';
import { roomsOf } from '../../core/model/derive.ts';
import { parseLength } from '../../core/units/length.ts';
import { activeFloor, useEditorStore } from '../../state/store.ts';
import { roomDimensions, wallDimensions, type Dimension } from './dimensions.ts';
import { DimensionsLayer } from './layers/DimensionsLayer.tsx';
import { GridLayer } from './layers/GridLayer.tsx';
import { RoomsLayer } from './layers/RoomsLayer.tsx';
import { WallsLayer } from './layers/WallsLayer.tsx';
import { snapPoint, squareToAxis, type Snap } from './snapping.ts';
import { polygonPath } from './svgPath.ts';
import { useElementSize } from './useElementSize.ts';
import {
  fitTo,
  gridSpacing,
  panBy,
  screenPixels,
  toModel,
  viewBox,
  zoomAt,
  type Viewport,
} from './viewport.ts';

/**
 * What the pointer is currently in the middle of.
 *
 * Modelled explicitly rather than as a scatter of booleans, because the states
 * genuinely exclude one another: a drag cannot be both panning the view and
 * drawing a room, and representing that as `isPanning && isDrawing` is how an
 * editor ends up doing both at once.
 */
type Interaction =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pan'; readonly pointerId: number; readonly lastScreen: Vec2 }
  | { readonly kind: 'draw-room'; readonly start: Vec2; readonly current: Vec2 }
  | { readonly kind: 'draw-wall'; readonly points: readonly Vec2[]; readonly current: Vec2 }
  | {
      readonly kind: 'drag-node';
      readonly nodeId: string;
      readonly pointerId: number;
      readonly moved: boolean;
    };

/** An open dimension input, floating over the canvas. */
interface DimensionEdit {
  readonly dimension: Dimension;
  readonly screen: Vec2;
}

export function PlanCanvas() {
  const container = useRef<HTMLDivElement>(null);
  const size = useElementSize(container);

  const floor = useEditorStore(activeFloor);
  const viewport = useEditorStore((state) => state.viewport);
  const setViewport = useEditorStore((state) => state.setViewport);
  const tool = useEditorStore((state) => state.tool);
  const selection = useEditorStore((state) => state.selection);
  const select = useEditorStore((state) => state.select);
  const commit = useEditorStore((state) => state.commit);
  const unit = useEditorStore((state) => state.document.unit);

  const [interaction, setInteraction] = useState<Interaction>({ kind: 'idle' });
  const [snap, setSnap] = useState<Snap | null>(null);
  const [editing, setEditing] = useState<DimensionEdit | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);

  const graph = floor?.graph;
  const rooms = useMemo(() => (floor ? roomsOf(floor) : []), [floor]);

  const selectedWallIds = useMemo(
    () => new Set(selection.filter((entry) => entry.kind === 'wall').map((entry) => entry.id)),
    [selection],
  );
  const selectedRoomIds = useMemo(
    () => new Set(selection.filter((entry) => entry.kind === 'room').map((entry) => entry.id)),
    [selection],
  );

  const pointerToModel = useCallback(
    (event: { clientX: number; clientY: number }): Vec2 => {
      const rect = container.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return toModel(viewport, size, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    },
    [viewport, size],
  );

  /**
   * Snap the pointer, then square the result against whatever the current run
   * started from. Squaring after snapping rather than before means a run can
   * still land exactly on a corner that happens to be off-axis.
   */
  const resolvePoint = useCallback(
    (raw: Vec2, anchor: Vec2 | null, snapsOff: boolean): Snap => {
      if (!graph) return { point: raw, kind: 'grid', guides: [] };

      const { minor } = gridSpacing(viewport);
      const result = snapPoint(graph, raw, {
        radius: screenPixels(viewport, 12),
        grid: minor,
        anchor,
        enabled: !snapsOff,
      });

      if (!anchor) return result;
      return { ...result, point: squareToAxis(anchor, result.point) };
    },
    [graph, viewport],
  );

  // ---- Zoom ----------------------------------------------------------------

  useEffect(() => {
    const element = container.current;
    if (!element) return;

    // Registered by hand rather than via onWheel so it can be non-passive:
    // React attaches wheel listeners passively and the browser would scroll the
    // page instead of zooming the plan.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();

      const rect = element.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };

      // Trackpads deliver many small deltas, mice a few large ones; the
      // exponential keeps both feeling proportional.
      const factor = Math.exp(-event.deltaY * 0.0015);
      setViewport(zoomAt(useEditorStore.getState().viewport, size, anchor, factor));
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [size, setViewport]);

  // ---- Space to pan --------------------------------------------------------

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !isTypingInto(event.target)) {
        event.preventDefault();
        setSpaceHeld(true);
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceHeld(false);
    };

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // ---- Frame the plan when it first has something in it -------------------

  // Fits when the floor goes from empty to not — on load, and again the moment
  // a room is created from typed measurements, which would otherwise appear
  // somewhere off screen at whatever zoom happened to be current.
  const hadContent = useRef(false);
  useEffect(() => {
    if (!graph || size.width === 0) return;

    const points = allNodes(graph).map((node) => ({ x: node.x, y: node.y }));
    if (points.length === 0) {
      hadContent.current = false;
      return;
    }

    if (hadContent.current) return;
    hadContent.current = true;
    setViewport(fitTo(boundingBox(points), size, { padding: 64 }));
  }, [graph, size, setViewport]);

  // ---- Pointer -------------------------------------------------------------

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!graph) return;
    setEditing(null);

    const panning = event.button === 1 || spaceHeld;
    if (panning) {
      event.currentTarget.setPointerCapture(event.pointerId);
      setInteraction({
        kind: 'pan',
        pointerId: event.pointerId,
        lastScreen: { x: event.clientX, y: event.clientY },
      });
      return;
    }

    if (event.button !== 0) return;
    const raw = pointerToModel(event);

    if (tool === 'draw-room') {
      const resolved = resolvePoint(raw, null, event.altKey);
      setSnap(resolved);
      setInteraction({ kind: 'draw-room', start: resolved.point, current: resolved.point });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (tool === 'draw-wall') {
      const anchor = interaction.kind === 'draw-wall' ? lastPoint(interaction.points) : null;
      const resolved = resolvePoint(raw, anchor, event.altKey);
      setSnap(resolved);

      if (interaction.kind !== 'draw-wall') {
        setInteraction({ kind: 'draw-wall', points: [resolved.point], current: resolved.point });
        return;
      }

      // Clicking the same place twice ends the run rather than adding a
      // zero-length wall — the usual way people expect to stop drawing.
      const previous = lastPoint(interaction.points);
      if (previous && previous.x === resolved.point.x && previous.y === resolved.point.y) {
        finishWallRun(interaction.points);
        return;
      }

      setInteraction({
        kind: 'draw-wall',
        points: [...interaction.points, resolved.point],
        current: resolved.point,
      });
      return;
    }

    // Select tool, and the pointer reached the background: nothing was hit.
    select([]);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!graph) return;

    if (interaction.kind === 'pan') {
      const delta = {
        x: event.clientX - interaction.lastScreen.x,
        y: event.clientY - interaction.lastScreen.y,
      };
      setViewport(panBy(useEditorStore.getState().viewport, delta));
      setInteraction({ ...interaction, lastScreen: { x: event.clientX, y: event.clientY } });
      return;
    }

    const raw = pointerToModel(event);

    if (interaction.kind === 'draw-room') {
      const resolved = resolvePoint(raw, null, event.altKey);
      setSnap(resolved);
      setInteraction({ ...interaction, current: resolved.point });
      return;
    }

    if (interaction.kind === 'draw-wall') {
      const anchor = lastPoint(interaction.points);
      const resolved = resolvePoint(raw, anchor, event.altKey);
      setSnap(resolved);
      setInteraction({ ...interaction, current: resolved.point });
      return;
    }

    if (interaction.kind === 'drag-node') {
      const resolved = resolvePoint(raw, null, event.altKey);
      setSnap(resolved);

      const nodeId = interaction.nodeId;
      commit(
        'Move corner',
        (draft) => {
          const target = draft.floors.find((entry) => entry.id === floor?.id);
          const node = target?.graph.nodes[nodeId];
          if (!target || !node) return;
          target.graph = {
            ...target.graph,
            nodes: { ...target.graph.nodes, [nodeId]: { ...node, ...resolved.point } },
          };
        },
        { coalesceKey: `drag-node:${nodeId}` },
      );

      setInteraction({ ...interaction, moved: true });
      return;
    }

    // Idle: still show where a click would land, so snapping is visible before
    // committing to it.
    if (tool !== 'select') {
      setSnap(resolvePoint(raw, null, event.altKey));
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (interaction.kind === 'pan' || interaction.kind === 'drag-node') {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setInteraction({ kind: 'idle' });
      setSnap(null);
      return;
    }

    if (interaction.kind === 'draw-room') {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      const { start, current } = interaction;
      setInteraction({ kind: 'idle' });
      setSnap(null);

      if (Math.abs(current.x - start.x) < 1 || Math.abs(current.y - start.y) < 1) return;

      commit('Draw room', (draft) => {
        const target = draft.floors.find((entry) => entry.id === floor?.id);
        if (!target) return;
        target.graph = drawRoomRect(target.graph, start, current, 'exterior').graph;
      });
    }
  };

  const finishWallRun = useCallback(
    (points: readonly Vec2[]) => {
      setInteraction({ kind: 'idle' });
      setSnap(null);
      if (points.length < 2) return;

      commit('Draw wall', (draft) => {
        const target = draft.floors.find((entry) => entry.id === floor?.id);
        if (!target) return;
        target.graph = drawWallRun(target.graph, points, 'interior').graph;
      });
    },
    [commit, floor?.id],
  );

  // Escape and Enter end a run; Escape with nothing running clears selection.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingInto(event.target)) return;

      if (event.key === 'Escape') {
        if (interaction.kind === 'draw-wall') {
          setInteraction({ kind: 'idle' });
          setSnap(null);
        } else if (interaction.kind === 'draw-room') {
          setInteraction({ kind: 'idle' });
          setSnap(null);
        } else {
          select([]);
        }
      }

      if (event.key === 'Enter' && interaction.kind === 'draw-wall') {
        finishWallRun(interaction.points);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [interaction, finishWallRun, select]);

  // ---- Dimensions ----------------------------------------------------------

  const dimensions = useMemo<Dimension[]>(() => {
    if (!graph || !floor) return [];

    const result: Dimension[] = [];

    for (const target of selection) {
      if (target.kind === 'wall' && graph.walls[target.id]) {
        result.push(
          ...wallDimensions(graph, target.id, viewport, (next) => {
            commit('Set wall length', (draft) => {
              const entry = draft.floors.find((candidate) => candidate.id === floor.id);
              if (!entry) return;
              entry.graph = setWallLength(entry.graph, target.id, next);
            });
          }),
        );
      }

      if (target.kind === 'room') {
        const room = rooms.find((candidate) => candidate.props.id === target.id);
        if (room) result.push(...roomDimensions(room, viewport));
      }
    }

    return result;
  }, [graph, floor, selection, viewport, rooms, commit]);

  // ---- Render --------------------------------------------------------------

  const cursor =
    interaction.kind === 'pan' || spaceHeld
      ? 'grabbing'
      : tool === 'select'
        ? 'default'
        : 'crosshair';

  return (
    <div
      ref={container}
      className="relative h-full w-full touch-none overflow-hidden select-none"
      style={{ background: 'var(--plan-bg)', cursor }}
      data-testid="plan-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(event) => {
        // Right-click ends a run rather than opening a menu over the plan.
        if (interaction.kind === 'draw-wall') {
          event.preventDefault();
          finishWallRun(interaction.points);
        }
      }}
    >
      {size.width > 0 && graph && floor && (
        <svg
          width={size.width}
          height={size.height}
          viewBox={viewBox(viewport, size)}
          style={{ display: 'block' }}
          role="presentation"
        >
          <GridLayer viewport={viewport} size={size} />

          <RoomsLayer
            rooms={rooms}
            viewport={viewport}
            selectedRoomIds={selectedRoomIds}
            {...(tool === 'select'
              ? {
                  onSelectRoom: (roomId: string, additive: boolean) =>
                    select([{ kind: 'room', id: roomId }], additive ? 'add' : 'replace'),
                }
              : {})}
          />

          <WallsLayer
            graph={graph}
            viewport={viewport}
            selectedWallIds={selectedWallIds}
            {...(tool === 'select'
              ? {
                  onSelectWall: (wallId: string, additive: boolean) =>
                    select([{ kind: 'wall', id: wallId }], additive ? 'add' : 'replace'),
                }
              : {})}
          />

          {tool === 'select' && (
            <NodeHandles
              graph={graph}
              viewport={viewport}
              onGrab={(nodeId, event) => {
                event.stopPropagation();
                (event.currentTarget as SVGElement).releasePointerCapture?.(event.pointerId);
                setInteraction({
                  kind: 'drag-node',
                  nodeId,
                  pointerId: event.pointerId,
                  moved: false,
                });
                container.current?.setPointerCapture(event.pointerId);
              }}
            />
          )}

          <DraftOverlay interaction={interaction} viewport={viewport} />
          <SnapGuides snap={snap} viewport={viewport} />

          <DimensionsLayer
            dimensions={dimensions}
            viewport={viewport}
            unit={unit}
            editing={editing?.dimension.id ?? null}
            onEdit={(dimension, screenAnchor) => {
              const rect = container.current?.getBoundingClientRect();
              setEditing({
                dimension,
                screen: {
                  x: screenAnchor.x - (rect?.left ?? 0),
                  y: screenAnchor.y - (rect?.top ?? 0),
                },
              });
            }}
          />
        </svg>
      )}

      {editing && (
        <DimensionInput
          edit={editing}
          unit={unit}
          onCancel={() => setEditing(null)}
          onCommit={(next) => {
            editing.dimension.onChange?.(next);
            setEditing(null);
          }}
        />
      )}

      {!graph && (
        <div className="grid h-full place-items-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No floor selected.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function lastPoint(points: readonly Vec2[]): Vec2 | null {
  return points[points.length - 1] ?? null;
}

/** True when a key event came from a text field, so shortcuts should stand down. */
function isTypingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

/** Draggable corners. */
function NodeHandles({
  graph,
  viewport,
  onGrab,
}: {
  graph: NonNullable<ReturnType<typeof activeFloor>>['graph'];
  viewport: Viewport;
  onGrab: (nodeId: string, event: React.PointerEvent<SVGCircleElement>) => void;
}) {
  const radius = screenPixels(viewport, 4);
  const hit = screenPixels(viewport, 9);

  return (
    <g>
      {allNodes(graph).map((node) => (
        <g key={node.id}>
          <circle
            cx={node.x}
            cy={node.y}
            r={radius}
            fill="var(--plan-bg)"
            stroke="var(--color-accent-500)"
            strokeWidth={screenPixels(viewport, 1.5)}
            pointerEvents="none"
          />
          <circle
            cx={node.x}
            cy={node.y}
            r={hit}
            fill="transparent"
            style={{ cursor: 'move' }}
            data-testid={`node-${node.id}`}
            onPointerDown={(event) => onGrab(node.id, event)}
          />
        </g>
      ))}
    </g>
  );
}

/** The room or wall currently being drawn. */
function DraftOverlay({ interaction, viewport }: { interaction: Interaction; viewport: Viewport }) {
  const stroke = screenPixels(viewport, 1.5);
  const dash = screenPixels(viewport, 6);

  if (interaction.kind === 'draw-room') {
    const { start, current } = interaction;
    return (
      <rect
        x={Math.min(start.x, current.x)}
        y={Math.min(start.y, current.y)}
        width={Math.abs(current.x - start.x)}
        height={Math.abs(current.y - start.y)}
        fill="var(--color-accent-500)"
        fillOpacity={0.12}
        stroke="var(--color-accent-500)"
        strokeWidth={stroke}
        strokeDasharray={`${dash} ${dash}`}
        pointerEvents="none"
      />
    );
  }

  if (interaction.kind === 'draw-wall') {
    const points = [...interaction.points, interaction.current];
    const path = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`)
      .join('');

    return (
      <g pointerEvents="none">
        <path
          d={path}
          fill="none"
          stroke="var(--color-accent-500)"
          strokeWidth={stroke}
          strokeDasharray={`${dash} ${dash}`}
        />
        {interaction.points.map((point, index) => (
          <circle
            key={index}
            cx={point.x}
            cy={point.y}
            r={screenPixels(viewport, 3)}
            fill="var(--color-accent-500)"
          />
        ))}
      </g>
    );
  }

  return null;
}

/**
 * Why the pointer moved where it did.
 *
 * A snap with no visible reason feels like the tool fighting you; a guide line
 * back to the corner it locked on to turns the same behaviour into help.
 */
function SnapGuides({ snap, viewport }: { snap: Snap | null; viewport: Viewport }) {
  if (!snap) return null;

  const stroke = screenPixels(viewport, 1);
  const marker = screenPixels(viewport, 4);

  return (
    <g pointerEvents="none">
      {snap.guides.map((guide, index) => (
        <line
          key={index}
          x1={guide.from.x}
          y1={guide.from.y}
          x2={guide.to.x}
          y2={guide.to.y}
          stroke="var(--color-snap)"
          strokeWidth={stroke}
          strokeDasharray={`${marker} ${marker}`}
        />
      ))}

      {snap.kind === 'node' && (
        <path
          d={polygonPath([
            { x: snap.point.x - marker, y: snap.point.y },
            { x: snap.point.x, y: snap.point.y - marker },
            { x: snap.point.x + marker, y: snap.point.y },
            { x: snap.point.x, y: snap.point.y + marker },
          ])}
          fill="var(--color-snap)"
        />
      )}

      {snap.kind === 'wall' && (
        <circle cx={snap.point.x} cy={snap.point.y} r={marker} fill="var(--color-snap)" />
      )}
    </g>
  );
}

/**
 * The input that appears over a dimension when it is clicked.
 *
 * HTML rather than SVG, because a real `<input>` brings keyboard handling,
 * selection, IME and accessibility with it — none of which is worth
 * reimplementing inside a `<foreignObject>`.
 */
function DimensionInput({
  edit,
  unit,
  onCommit,
  onCancel,
}: {
  edit: DimensionEdit;
  unit: 'mm' | 'cm' | 'm';
  onCommit: (value: number) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(() =>
    String(edit.dimension.value / (unit === 'cm' ? 10 : unit === 'm' ? 1000 : 1)),
  );
  const invalid = parseLength(text, unit) === null;

  return (
    <input
      autoFocus
      aria-label="Dimension"
      data-testid="dimension-input"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={onCancel}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') onCancel();
        if (event.key === 'Enter') {
          const parsed = parseLength(text, unit);
          if (parsed !== null && parsed > 0) onCommit(parsed);
          else onCancel();
        }
      }}
      className="tabular absolute z-10 w-24 rounded border px-1.5 py-0.5 text-center text-xs"
      style={{
        left: edit.screen.x - 48,
        top: edit.screen.y - 12,
        background: 'var(--surface-raised)',
        color: 'var(--text-primary)',
        borderColor: invalid ? 'var(--color-severity-error)' : 'var(--color-accent-500)',
      }}
    />
  );
}
