import { memo } from 'react';

import {
  gridSpacing,
  screenPixels,
  visibleBounds,
  type Viewport,
  type ViewportSize,
} from '../viewport.ts';

/**
 * The background grid.
 *
 * Spacing adapts to the zoom (see `gridSpacing`), so the lines stay a readable
 * distance apart whether the view shows a whole house or a single socket. Lines
 * are drawn only across what is actually visible rather than over some large
 * fixed extent, which keeps the element count flat as you zoom out.
 */
export const GridLayer = memo(function GridLayer({
  viewport,
  size,
}: {
  viewport: Viewport;
  size: ViewportSize;
}) {
  if (size.width === 0 || size.height === 0) return null;

  const bounds = visibleBounds(viewport, size);
  const { minor, major } = gridSpacing(viewport);

  // Hairlines, constant on screen at any zoom.
  const minorWidth = screenPixels(viewport, 1);
  const majorWidth = screenPixels(viewport, 1);

  const minorLines: string[] = [];
  const majorLines: string[] = [];

  const firstX = Math.ceil(bounds.minX / minor) * minor;
  for (let x = firstX; x <= bounds.maxX; x += minor) {
    const line = `M${x} ${bounds.minY}V${bounds.maxY}`;
    (x % major === 0 ? majorLines : minorLines).push(line);
  }

  const firstY = Math.ceil(bounds.minY / minor) * minor;
  for (let y = firstY; y <= bounds.maxY; y += minor) {
    const line = `M${bounds.minX} ${y}H${bounds.maxX}`;
    (y % major === 0 ? majorLines : minorLines).push(line);
  }

  return (
    <g aria-hidden="true" pointerEvents="none">
      <path
        d={minorLines.join('')}
        stroke="var(--plan-grid-minor)"
        strokeWidth={minorWidth}
        fill="none"
      />
      <path
        d={majorLines.join('')}
        stroke="var(--plan-grid-major)"
        strokeWidth={majorWidth}
        fill="none"
      />
    </g>
  );
});
