import { memo } from 'react';

import { centroid } from '../../../core/geometry/polygon.ts';
import { type placedShape, placedShapeIfKnown } from '../../../core/catalog/placement.ts';
import { type PlanArc, type PlanStroke } from '../../../core/catalog/types.ts';
import { type Item } from '../../../core/model/schema.ts';
import { polygonPath } from '../svgPath.ts';
import { screenPixels, type Viewport } from '../viewport.ts';

/**
 * The furniture.
 *
 * Everything here comes from the catalogue: this layer knows how to draw a
 * polygon, a polyline and an arc, and nothing whatever about beds. Adding a
 * piece of furniture never comes back to this file, which is the point of
 * keeping objects as data.
 *
 * Three things are drawn per item, in order:
 *
 * - **The footprint**, filled — what the object occupies on the floor.
 * - **The voids**, painted back out. The space under a bed or a wall-hung
 *   basin is floor you can put something on, and shading it solid would be a
 *   lie the clearance checks do not tell.
 * - **The detail** — the strokes and swing arcs that make a symbol readable as
 *   a wardrobe rather than a rectangle.
 */
export const ItemsLayer = memo(function ItemsLayer({
  items,
  viewport,
  selectedIds,
  dimmed = false,
  onSelect,
  onGrab,
}: {
  items: readonly Item[];
  viewport: Viewport;
  selectedIds: ReadonlySet<string>;
  /** True while another tool is active, so furniture stays visible but quiet. */
  dimmed?: boolean;
  onSelect?: (itemId: string, additive: boolean) => void;
  onGrab?: (itemId: string, event: React.PointerEvent<SVGPathElement>) => void;
}) {
  const hairline = screenPixels(viewport, 0.75);
  const normal = screenPixels(viewport, 1.25);
  const heavy = screenPixels(viewport, 2);
  const dash = screenPixels(viewport, 5);

  const weights: Record<NonNullable<PlanStroke['weight']>, number> = {
    hairline,
    normal,
    heavy,
  };

  return (
    <g opacity={dimmed ? 0.55 : 1}>
      {items.map((item) => {
        const shape = placedShapeIfKnown(item);
        if (!shape) return null;

        const selected = selectedIds.has(item.id);
        const ink = selected ? 'var(--color-accent-500)' : 'var(--plan-item-ink)';

        return (
          <g key={item.id} data-testid={`item-${item.id}`}>
            <path
              d={polygonPath(shape.outline)}
              fill={selected ? 'var(--plan-item-fill-selected)' : 'var(--plan-item-fill)'}
              stroke={ink}
              strokeWidth={selected ? normal : hairline}
              strokeLinejoin="round"
              pointerEvents="none"
            />

            {shape.voids.map((hole, index) => (
              <path
                key={`void-${index}`}
                d={polygonPath(hole)}
                fill="var(--plan-room-fill)"
                fillOpacity={0.75}
                pointerEvents="none"
              />
            ))}

            {shape.strokes.map((line, index) => (
              <path
                key={`stroke-${index}`}
                d={strokePath(line)}
                fill="none"
                stroke={ink}
                strokeWidth={weights[line.weight ?? 'hairline']}
                strokeLinecap="round"
                strokeLinejoin="round"
                {...(line.dashed ? { strokeDasharray: `${dash} ${dash}` } : {})}
                pointerEvents="none"
              />
            ))}

            {shape.arcs.map((curve, index) => (
              <path
                key={`arc-${index}`}
                d={arcPath(curve)}
                fill="none"
                stroke={ink}
                strokeWidth={hairline}
                {...(curve.dashed === false ? {} : { strokeDasharray: `${dash} ${dash}` })}
                opacity={0.6}
                pointerEvents="none"
              />
            ))}

            {(onSelect || onGrab) && (
              <path
                d={polygonPath(shape.outline)}
                fill="transparent"
                style={{ cursor: onGrab ? 'move' : 'pointer' }}
                data-testid={`item-hit-${item.id}`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelect?.(item.id, event.shiftKey);
                  onGrab?.(item.id, event);
                }}
              />
            )}

            {selected && <Label item={item} shape={shape} viewport={viewport} />}
          </g>
        );
      })}
    </g>
  );
});

/**
 * The item's name, on the item.
 *
 * Only while selected. Sixty labelled rectangles is a page of text with a plan
 * hidden somewhere behind it; one is an answer to "which of these did I just
 * click".
 */
function Label({
  item,
  shape,
  viewport,
}: {
  item: Item;
  shape: ReturnType<typeof placedShape>;
  viewport: Viewport;
}) {
  const centre = centroid(shape.outline);
  const size = screenPixels(viewport, 11);

  return (
    <text
      x={centre.x}
      y={centre.y}
      fontSize={size}
      textAnchor="middle"
      dominantBaseline="middle"
      fill="var(--color-accent-500)"
      pointerEvents="none"
      style={{ paintOrder: 'stroke', stroke: 'var(--plan-bg)', strokeWidth: size / 4 }}
    >
      {item.label}
    </text>
  );
}

function strokePath(line: PlanStroke): string {
  const [first, ...rest] = line.points;
  if (!first) return '';
  return (
    `M${first.x} ${first.y}` +
    rest.map((point) => `L${point.x} ${point.y}`).join('') +
    (line.closed ? 'Z' : '')
  );
}

/**
 * An arc as a polyline.
 *
 * SVG's own arc command needs a large-arc flag and a sweep direction, both of
 * which depend on the y-down convention in ways that are easy to get subtly
 * backwards. Sampling is a couple of lines, has no orientation to get wrong,
 * and at a quarter circle of a wardrobe door is indistinguishable.
 */
function arcPath(curve: PlanArc): string {
  const span = curve.endAngle - curve.startAngle;
  const steps = Math.max(4, Math.ceil(Math.abs(span) / (Math.PI / 24)));

  const points = Array.from({ length: steps + 1 }, (_, index) => {
    const angle = curve.startAngle + (span * index) / steps;
    return {
      x: curve.centre.x + Math.cos(angle) * curve.radius,
      y: curve.centre.y + Math.sin(angle) * curve.radius,
    };
  });

  const [first, ...rest] = points;
  if (!first) return '';
  return `M${first.x} ${first.y}` + rest.map((point) => `L${point.x} ${point.y}`).join('');
}
