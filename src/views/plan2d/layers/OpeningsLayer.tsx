import { memo } from 'react';

import { add, negate, scale, type Vec2 } from '../../../core/geometry/vec2.ts';
import { type WallGraph } from '../../../core/graph/wallGraph.ts';
import { doorSwing, openingFrame } from '../../../core/openings/geometry.ts';
import { type Opening } from '../../../core/model/schema.ts';
import { polygonPath } from '../svgPath.ts';
import { screenPixels, type Viewport } from '../viewport.ts';

/**
 * Doors and windows.
 *
 * Three things are drawn, and each answers a different question:
 *
 * - **The gap.** A door is a hole in the masonry, so the wall is painted over
 *   in the background colour where the opening is. Punching a real hole in the
 *   wall geometry would be the alternative, but every wall would then have to
 *   be rebuilt whenever a door moved, for an identical picture.
 * - **The leaf**, at whatever the door is currently open to. This is what makes
 *   the open/close slider worth having.
 * - **The swing arc**, always the full quarter circle. That is the question
 *   being asked: not where the door is, but what space it needs.
 */
export const OpeningsLayer = memo(function OpeningsLayer({
  graph,
  openings,
  viewport,
  selectedIds,
  onSelect,
}: {
  graph: WallGraph;
  openings: readonly Opening[];
  viewport: Viewport;
  selectedIds: ReadonlySet<string>;
  onSelect?: (openingId: string, additive: boolean) => void;
}) {
  const stroke = screenPixels(viewport, 1.5);
  const hairline = screenPixels(viewport, 1);
  const dash = screenPixels(viewport, 5);

  return (
    <g>
      {openings.map((opening) => {
        const wall = graph.walls[opening.wallId];
        // An opening whose wall has gone is pruned by `reconcileFloor`, but a
        // render can land between the two; skipping is cheaper than throwing.
        if (!wall) return null;

        const frame = openingFrame(graph, wall, opening);
        const selected = selectedIds.has(opening.id);
        const accent = selected ? 'var(--color-accent-500)' : 'var(--plan-ink)';

        return (
          <g key={opening.id} data-testid={`opening-${opening.id}`}>
            {/* The hole itself. */}
            <path d={polygonPath(frame.cutout)} fill="var(--plan-bg)" pointerEvents="none" />

            {/* The reveals — the two faces of wall the opening cuts through. */}
            <path
              d={
                `M${frame.cutout[0]!.x} ${frame.cutout[0]!.y}L${frame.cutout[3]!.x} ${frame.cutout[3]!.y}` +
                `M${frame.cutout[1]!.x} ${frame.cutout[1]!.y}L${frame.cutout[2]!.x} ${frame.cutout[2]!.y}`
              }
              stroke={accent}
              strokeWidth={hairline}
              pointerEvents="none"
            />

            {opening.kind === 'window' ? (
              <WindowGlazing frame={frame} colour={accent} width={hairline} />
            ) : null}

            {opening.kind === 'door' ? (
              <DoorLeaf
                graph={graph}
                wall={wall}
                opening={opening}
                colour={accent}
                stroke={stroke}
                hairline={hairline}
                dash={dash}
              />
            ) : null}

            {onSelect && (
              <path
                d={polygonPath(frame.cutout)}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelect(opening.id, event.shiftKey);
                }}
              />
            )}
          </g>
        );
      })}
    </g>
  );
});

/**
 * A window, drawn the way plans draw one: the glass as a band through the
 * middle of the wall, with the frame either side of it.
 *
 * Two hairlines a sixth of a wall apart is the literal thing, and at 100mm of
 * wall that is under 20mm of separation — invisible at any zoom where a whole
 * room is on screen. Filling the glass instead makes a window unmistakably a
 * window rather than a hole someone forgot to put a door in.
 */
function WindowGlazing({
  frame,
  colour,
  width,
}: {
  frame: ReturnType<typeof openingFrame>;
  colour: string;
  width: number;
}) {
  const half = scale(frame.across, frame.thickness / 6);

  const glass: Vec2[] = [
    add(frame.startPoint, negate(half)),
    add(frame.endPoint, negate(half)),
    add(frame.endPoint, half),
    add(frame.startPoint, half),
  ];

  const frameEdge = scale(frame.across, frame.thickness / 2);

  return (
    <g pointerEvents="none">
      {/* The frame: a line along each face of the wall, closing the reveal. */}
      <path
        d={
          `M${add(frame.startPoint, negate(frameEdge)).x} ${add(frame.startPoint, negate(frameEdge)).y}` +
          `L${add(frame.endPoint, negate(frameEdge)).x} ${add(frame.endPoint, negate(frameEdge)).y}` +
          `M${add(frame.startPoint, frameEdge).x} ${add(frame.startPoint, frameEdge).y}` +
          `L${add(frame.endPoint, frameEdge).x} ${add(frame.endPoint, frameEdge).y}`
        }
        stroke={colour}
        strokeWidth={width}
        fill="none"
      />

      <path d={polygonPath(glass)} fill={colour} opacity={0.5} />
    </g>
  );
}

function DoorLeaf({
  graph,
  wall,
  opening,
  colour,
  stroke,
  hairline,
  dash,
}: {
  graph: WallGraph;
  wall: NonNullable<WallGraph['walls'][string]>;
  opening: Opening;
  colour: string;
  stroke: number;
  hairline: number;
  dash: number;
}) {
  const swing = doorSwing(graph, wall, opening);

  return (
    <g pointerEvents="none">
      {/* The whole sweep, dashed: the space the door needs whether or not it is
          currently using it. */}
      <path
        d={arcPath(swing.hinge, swing.sector)}
        fill="none"
        stroke={colour}
        strokeWidth={hairline}
        strokeDasharray={`${dash} ${dash}`}
        opacity={0.55}
      />

      {/* The leaf where it is now. */}
      <line
        x1={swing.hinge.x}
        y1={swing.hinge.y}
        x2={swing.leafEnd.x}
        y2={swing.leafEnd.y}
        stroke={colour}
        strokeWidth={stroke}
        strokeLinecap="round"
      />
    </g>
  );
}

/** The outer edge of a swing sector, without the two radii back to the hinge. */
function arcPath(hinge: Vec2, sector: readonly Vec2[]): string {
  const rim = sector.slice(1);
  if (rim.length === 0) return '';

  void hinge;
  return `M${rim[0]!.x} ${rim[0]!.y}${rim
    .slice(1)
    .map((point) => `L${point.x} ${point.y}`)
    .join('')}`;
}
