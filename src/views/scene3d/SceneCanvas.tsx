import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { buildScene, hiddenWallIds, planBounds, withoutWalls } from '../../core/scene/build.ts';
import { dolly, frame, orbit, pan, type OrbitCamera } from '../../core/scene/camera.ts';
import { faceAt, renderScene, type ProjectedFace } from '../../core/scene/render.ts';
import { polygonPath } from '../plan2d/svgPath.ts';
import { useElementSize } from '../plan2d/useElementSize.ts';
import { activeFloor, useEditorStore, type SelectionTarget } from '../../state/store.ts';
import { fillFor, opacityFor } from './palette.ts';

/**
 * The room, in three dimensions.
 *
 * Drawn as SVG polygons, exactly like the plan — the solids and the projection
 * are worked out in `core/scene`, and this file's whole job is to put the
 * result on screen and let you turn it round.
 *
 * ## Why not a 3D library
 *
 * Because the hard part of this view is not the pixels. It is knowing where a
 * wall is once the doors have been cut out of it, and where a wardrobe's
 * carcass is once it has been resized and turned 30° — and all of that is
 * arithmetic over the same document the plan reads, with a unit test on every
 * step. Keeping the renderer in the same language means the whole path from
 * "wardrobe at 30°" to "these pixels" stays inspectable, in a project whose
 * entire claim is that its numbers are right. A better-looking renderer can be
 * dropped in later without any of that moving.
 */
export function SceneCanvas() {
  const container = useRef<HTMLDivElement>(null);
  const size = useElementSize(container);

  const floor = useEditorStore(activeFloor);
  const camera = useEditorStore((state) => state.camera);
  const setCamera = useEditorStore((state) => state.setCamera);
  const cutaway = useEditorStore((state) => state.cutaway);
  const selection = useEditorStore((state) => state.selection);
  const select = useEditorStore((state) => state.select);

  const [drag, setDrag] = useState<Drag | null>(null);

  // Built once per floor. Turning the view does not rebuild a single wall,
  // which is what keeps an orbit smooth with sixty objects in the room.
  const solids = useMemo(() => (floor ? buildScene(floor) : []), [floor]);

  const visible = useMemo(() => {
    if (!floor || !cutaway) return solids;
    return withoutWalls(solids, hiddenWallIds(floor, camera));
  }, [floor, solids, cutaway, camera]);

  const faces = useMemo(() => renderScene(visible, camera, size), [visible, camera, size]);

  const selectedIds = useMemo(() => {
    const byKind = new Map<string, Set<string>>();
    for (const target of selection) {
      const set = byKind.get(target.kind) ?? new Set<string>();
      set.add(target.id);
      byKind.set(target.kind, set);
    }
    return byKind;
  }, [selection]);

  const isSelected = useCallback(
    (face: ProjectedFace) =>
      face.source.kind !== 'none' &&
      (selectedIds.get(face.source.kind)?.has(face.source.id) ?? false),
    [selectedIds],
  );

  /**
   * Frame the plan the first time there is something to frame.
   *
   * Once only, and never again: re-framing whenever the furniture changes would
   * throw away a view you had just set up because you moved a chair.
   *
   * It also stands down the moment the camera is touched. The canvas cannot
   * frame anything until it has been measured, which is a frame or two after it
   * appears — long enough for a quick scroll to land first and be silently
   * overruled a moment later. Whoever moved the camera last should win, and
   * between the two of them that is never this.
   */
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || !floor || size.width === 0) return;

    const bounds = planBounds(floor);
    if (!bounds) return;

    framed.current = true;
    setCamera(frame(bounds, floor.ceilingHeight, size, camera));
    // `camera` is read to keep the angle, not to react to it — following it
    // here would re-frame the plan on every orbit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor, size, setCamera]);

  const moveCamera = useCallback(
    (next: OrbitCamera) => {
      framed.current = true;
      setCamera(next);
    },
    [setCamera],
  );

  const refit = useCallback(() => {
    if (!floor || size.width === 0) return;
    const bounds = planBounds(floor);
    if (bounds) moveCamera(frame(bounds, floor.ceilingHeight, size, camera));
  }, [floor, size, camera, moveCamera]);

  const localPoint = (event: { clientX: number; clientY: number }) => {
    const rect = container.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);

    setDrag({
      pointerId: event.pointerId,
      // Middle button and shift both pan, matching the plan's conventions.
      mode: event.button === 1 || event.shiftKey ? 'pan' : 'orbit',
      last: { x: event.clientX, y: event.clientY },
      moved: false,
    });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;

    const dx = event.clientX - drag.last.x;
    const dy = event.clientY - drag.last.y;
    if (dx === 0 && dy === 0) return;

    moveCamera(drag.mode === 'pan' ? panBy(camera, dx, dy, size) : orbitBy(camera, dx, dy));
    setDrag({
      ...drag,
      last: { x: event.clientX, y: event.clientY },
      // A click that moved is a drag, and must not also select something.
      moved: drag.moved || Math.abs(dx) > 2 || Math.abs(dy) > 2,
    });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (!drag.moved && drag.mode === 'orbit') {
      const hit = faceAt(faces, localPoint(event));
      select(hit ? targetsFor(hit) : [], event.shiftKey ? 'toggle' : 'replace');
    }

    setDrag(null);
  };

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    moveCamera(dolly(camera, event.deltaY > 0 ? 1.12 : 1 / 1.12));
  };

  return (
    <div
      ref={container}
      data-testid="scene-canvas"
      className="relative h-full w-full touch-none overflow-hidden select-none"
      style={{
        background: 'var(--scene-sky)',
        cursor: drag ? (drag.mode === 'pan' ? 'grabbing' : 'move') : 'grab',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      onWheel={onWheel}
      onContextMenu={(event) => event.preventDefault()}
    >
      <svg
        width={size.width}
        height={size.height}
        viewBox={`0 0 ${Math.max(1, size.width)} ${Math.max(1, size.height)}`}
        role="img"
        aria-label="Three-dimensional view of the plan"
        style={{ display: 'block' }}
      >
        {faces.map((face) => {
          const selected = isSelected(face);
          return (
            <path
              key={face.id}
              d={polygonPath(face.points)}
              fill={fillFor(face.material, face.shade, selected)}
              fillOpacity={opacityFor(face.material)}
              // A hairline in the fill's own colour, darkened. Without it,
              // two faces of the same brightness meeting edge on read as one
              // surface and the shape of the object disappears.
              stroke={fillFor(face.material, face.shade * 0.72, selected)}
              strokeWidth={0.75}
              strokeLinejoin="round"
              shapeRendering="geometricPrecision"
            />
          );
        })}
      </svg>

      {faces.length === 0 && <EmptyNote hasFloor={Boolean(floor)} />}

      <SceneControls onFit={refit} />
    </div>
  );
}

// ---------------------------------------------------------------------------

interface Drag {
  readonly pointerId: number;
  readonly mode: 'orbit' | 'pan';
  readonly last: { readonly x: number; readonly y: number };
  readonly moved: boolean;
}

/** A quarter turn per 250 pixels, which is about a comfortable wrist. */
const ORBIT_PER_PIXEL = Math.PI / 2 / 250;

function orbitBy(camera: OrbitCamera, dx: number, dy: number): OrbitCamera {
  // Dragging right turns the room to the right, which means moving the camera
  // the other way round it — the handle you are holding is the room, not the
  // tripod.
  return orbit(camera, -dx * ORBIT_PER_PIXEL, dy * ORBIT_PER_PIXEL);
}

/**
 * Pan by a screen distance, converted to millimetres at the target's depth, so
 * a drag moves what is under the pointer by roughly that much however far away
 * the camera is.
 */
function panBy(
  camera: OrbitCamera,
  dx: number,
  dy: number,
  size: { readonly width: number; readonly height: number },
): OrbitCamera {
  if (size.height <= 0) return camera;

  const perPixel = (2 * Math.tan(camera.fieldOfView / 2) * camera.distance) / size.height;
  // Dragging down pulls the floor towards you, which moves the target away.
  return pan(camera, -dx * perPixel, dy * perPixel);
}

/** What clicking a surface should select. */
function targetsFor(face: ProjectedFace): SelectionTarget[] {
  const { source } = face;
  if (source.kind === 'none') return [];
  return [{ kind: source.kind, id: source.id }];
}

function EmptyNote({ hasFloor }: { hasFloor: boolean }) {
  return (
    <p
      data-testid="scene-empty"
      className="pointer-events-none absolute inset-0 grid place-items-center px-8 text-center text-xs"
      style={{ color: 'var(--text-muted)' }}
    >
      {hasFloor
        ? 'Nothing to show yet — draw a room and it will appear here.'
        : 'No floor selected.'}
    </p>
  );
}

/**
 * The controls that only make sense here.
 *
 * Deliberately three: frame the plan, put the walls back, and a line telling
 * you that dragging turns it. A 3D view with a control panel is a 3D view
 * nobody uses.
 */
function SceneControls({ onFit }: { onFit: () => void }) {
  const cutaway = useEditorStore((state) => state.cutaway);
  const setCutaway = useEditorStore((state) => state.setCutaway);

  return (
    <div
      className="absolute top-3 right-3 flex flex-col items-end gap-2"
      // The canvas captures the pointer as soon as one goes down on it, so that
      // a drag that leaves the element still turns the room. Capture also means
      // the browser sends the pointer-up to the canvas rather than to whatever
      // is under it, and no click is ever generated — which would leave these
      // buttons looking pressable and doing nothing.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        className="flex items-center gap-1 rounded border p-1"
        style={{
          background: 'var(--surface-panel)',
          borderColor: 'var(--surface-border-strong)',
        }}
      >
        <button
          type="button"
          data-testid="scene-cutaway"
          aria-pressed={cutaway}
          onClick={() => setCutaway(!cutaway)}
          className="rounded px-2 py-1 text-[11px]"
          style={{
            background: cutaway ? 'var(--color-accent-500)' : 'transparent',
            color: cutaway ? '#fff' : 'var(--text-secondary)',
          }}
        >
          Cutaway
        </button>
        <button
          type="button"
          data-testid="scene-fit"
          onClick={onFit}
          className="rounded px-2 py-1 text-[11px]"
          style={{ color: 'var(--text-secondary)' }}
        >
          Fit
        </button>
      </div>

      <p
        className="pointer-events-none rounded px-2 py-1 text-[10px]"
        style={{ background: 'var(--surface-panel)', color: 'var(--text-muted)' }}
      >
        Drag to turn · shift-drag to pan · scroll to zoom
      </p>
    </div>
  );
}
