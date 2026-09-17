import { memo } from 'react';

import { normalize, perpendicular, scale, sub, type Vec2 } from '../../../core/geometry/vec2.ts';
import { formatLength, type LengthUnit } from '../../../core/units/length.ts';
import { type Dimension } from '../dimensions.ts';
import { screenPixels, type Viewport } from '../viewport.ts';

/**
 * Dimension lines.
 *
 * The important part is that the numbers are **inputs**. Click one, type 2400,
 * press Enter, and the wall goes exactly there. Dragging with a pointer can
 * never be exact, and every plan here is going to be turned into furniture
 * someone has to actually buy — so the numeric path has to be the primary one,
 * not a fallback hidden in a properties panel.
 */
export const DimensionsLayer = memo(function DimensionsLayer({
  dimensions,
  viewport,
  unit,
  onEdit,
  editing,
}: {
  dimensions: readonly Dimension[];
  viewport: Viewport;
  unit: LengthUnit;
  /** Called when a number is clicked; the shell opens an input over it. */
  onEdit?: (dimension: Dimension, screenAnchor: Vec2) => void;
  editing?: string | null;
}) {
  const fontSize = screenPixels(viewport, 11);
  const stroke = screenPixels(viewport, 1);
  const tick = screenPixels(viewport, 4);

  return (
    <g pointerEvents="none">
      {dimensions.map((dimension) => {
        const direction = normalize(sub(dimension.to, dimension.from));
        if (direction.x === 0 && direction.y === 0) return null;

        const away = scale(perpendicular(direction), dimension.offset);
        const from = { x: dimension.from.x + away.x, y: dimension.from.y + away.y };
        const to = { x: dimension.to.x + away.x, y: dimension.to.y + away.y };
        const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };

        // Keep the number the right way up whichever way the wall runs.
        const angle = (Math.atan2(direction.y, direction.x) * 180) / Math.PI;
        const flipped = angle > 90 || angle < -90;
        const rotation = flipped ? angle + 180 : angle;

        const cross = scale(perpendicular(direction), tick);
        const editable = dimension.onChange !== undefined;
        const isEditing = editing === dimension.id;

        return (
          <g key={dimension.id} opacity={isEditing ? 0.25 : 1}>
            {/* Witness lines back to what is being measured. */}
            <path
              d={
                `M${dimension.from.x} ${dimension.from.y}L${from.x} ${from.y}` +
                `M${dimension.to.x} ${dimension.to.y}L${to.x} ${to.y}`
              }
              stroke="var(--plan-dim)"
              strokeWidth={stroke}
              strokeDasharray={`${tick} ${tick}`}
              opacity={0.6}
            />

            <path
              d={
                `M${from.x} ${from.y}L${to.x} ${to.y}` +
                `M${from.x - cross.x} ${from.y - cross.y}L${from.x + cross.x} ${from.y + cross.y}` +
                `M${to.x - cross.x} ${to.y - cross.y}L${to.x + cross.x} ${to.y + cross.y}`
              }
              stroke="var(--plan-dim)"
              strokeWidth={stroke}
              fill="none"
            />

            <g transform={`translate(${mid.x} ${mid.y}) rotate(${rotation})`}>
              {/* A plate behind the number so it stays readable over a wall. */}
              <rect
                x={-fontSize * 2}
                y={-fontSize * 1.5}
                width={fontSize * 4}
                height={fontSize * 1.5}
                rx={fontSize * 0.25}
                fill="var(--plan-bg)"
                opacity={0.9}
              />
              <text
                y={-fontSize * 0.45}
                textAnchor="middle"
                fontSize={fontSize}
                fill={editable ? 'var(--color-accent-600)' : 'var(--plan-dim)'}
                style={{
                  fontVariantNumeric: 'tabular-nums',
                  cursor: editable ? 'text' : 'default',
                  pointerEvents: editable && onEdit ? 'auto' : 'none',
                  textDecoration: editable ? 'underline dotted' : undefined,
                }}
                data-testid={`dimension-${dimension.id}`}
                onPointerDown={
                  editable && onEdit
                    ? (event) => {
                        event.stopPropagation();
                        onEdit(dimension, { x: event.clientX, y: event.clientY });
                      }
                    : undefined
                }
              >
                {formatLength(dimension.value, unit)}
              </text>
            </g>
          </g>
        );
      })}
    </g>
  );
});
