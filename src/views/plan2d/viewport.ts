/**
 * Mapping between the plan and the screen.
 *
 * The plan lives in millimetres with Y pointing down; the screen is pixels with
 * Y pointing down. Because the conventions already agree, the mapping is a
 * scale and a translation with no flip anywhere — which is exactly why `vec2.ts`
 * chose Y-down in the first place.
 *
 * The SVG carries a `viewBox` in **model units**, so everything inside it is
 * drawn at its real size in millimetres: a 100mm wall is 100 units wide and
 * stays correct at every zoom with no arithmetic in the render path. The cost
 * is that anything meant to be a fixed size on screen — a label, a hairline, a
 * drag handle — has to be divided by the scale, which is what
 * {@link screenPixels} is for.
 */

import { type BoundingBox } from '../../core/geometry/polygon.ts';
import { type Vec2 } from '../../core/geometry/vec2.ts';
import { type Mm } from '../../core/units/length.ts';

export interface Viewport {
  /** The model point at the centre of the view. */
  readonly centre: Vec2;
  /** Screen pixels per millimetre. */
  readonly scale: number;
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Zoom limits.
 *
 * The lower bound shows roughly a 400m span, which is far more than any house;
 * the upper shows about 25cm across, enough to place a socket to the
 * millimetre. Past either end the plan stops being useful and starts being a
 * way to get lost.
 */
export const MIN_SCALE = 0.004;
export const MAX_SCALE = 6;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** The model-space rectangle currently visible. */
export function visibleBounds(viewport: Viewport, size: ViewportSize): BoundingBox {
  const halfWidth = size.width / 2 / viewport.scale;
  const halfHeight = size.height / 2 / viewport.scale;

  return {
    minX: viewport.centre.x - halfWidth,
    minY: viewport.centre.y - halfHeight,
    maxX: viewport.centre.x + halfWidth,
    maxY: viewport.centre.y + halfHeight,
  };
}

/** The `viewBox` attribute for the plan's SVG. */
export function viewBox(viewport: Viewport, size: ViewportSize): string {
  const bounds = visibleBounds(viewport, size);
  return `${bounds.minX} ${bounds.minY} ${bounds.maxX - bounds.minX} ${bounds.maxY - bounds.minY}`;
}

/** Screen pixels, relative to the element's top-left, to model coordinates. */
export function toModel(viewport: Viewport, size: ViewportSize, screen: Vec2): Vec2 {
  return {
    x: viewport.centre.x + (screen.x - size.width / 2) / viewport.scale,
    y: viewport.centre.y + (screen.y - size.height / 2) / viewport.scale,
  };
}

/** Model coordinates to screen pixels, relative to the element's top-left. */
export function toScreen(viewport: Viewport, size: ViewportSize, model: Vec2): Vec2 {
  return {
    x: size.width / 2 + (model.x - viewport.centre.x) * viewport.scale,
    y: size.height / 2 + (model.y - viewport.centre.y) * viewport.scale,
  };
}

/**
 * How many model units make `pixels` on screen.
 *
 * Everything drawn inside the SVG is in model units, so a label that should be
 * 12px tall at any zoom has to be sized `screenPixels(viewport, 12)`.
 */
export function screenPixels(viewport: Viewport, pixels: number): Mm {
  return pixels / viewport.scale;
}

/**
 * Zoom while holding one point still.
 *
 * Anchoring on the pointer is what makes wheel-zoom feel like the plan is under
 * your finger rather than sliding away from it.
 */
export function zoomAt(
  viewport: Viewport,
  size: ViewportSize,
  screenAnchor: Vec2,
  factor: number,
): Viewport {
  const scale = clampScale(viewport.scale * factor);
  // Clamped at a limit, so nothing moves.
  if (scale === viewport.scale) return viewport;

  const anchor = toModel(viewport, size, screenAnchor);

  // Keep `anchor` under `screenAnchor`: the centre moves towards or away from
  // it in proportion to how much the scale changed.
  const ratio = viewport.scale / scale;
  return {
    scale,
    centre: {
      x: anchor.x + (viewport.centre.x - anchor.x) * ratio,
      y: anchor.y + (viewport.centre.y - anchor.y) * ratio,
    },
  };
}

/** Pan by a screen-space delta. */
export function panBy(viewport: Viewport, delta: Vec2): Viewport {
  return {
    scale: viewport.scale,
    centre: {
      x: viewport.centre.x - delta.x / viewport.scale,
      y: viewport.centre.y - delta.y / viewport.scale,
    },
  };
}

export interface FitOptions {
  /** Screen pixels of breathing room around the content. */
  readonly padding?: number;
  /** Used when the content has no extent — a plan with a single wall. */
  readonly fallbackScale?: number;
}

/**
 * Frame a bounding box in the view.
 *
 * An empty or degenerate box — an empty plan, or one that is still a single
 * straight wall — cannot be fitted to, so the view centres on it at a readable
 * default rather than dividing by zero and disappearing.
 */
export function fitTo(bounds: BoundingBox, size: ViewportSize, options: FitOptions = {}): Viewport {
  const padding = options.padding ?? 48;
  const fallbackScale = options.fallbackScale ?? 0.2;

  const centre = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };

  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  const usableWidth = Math.max(1, size.width - padding * 2);
  const usableHeight = Math.max(1, size.height - padding * 2);

  if (width <= 0 && height <= 0) {
    return { centre, scale: clampScale(fallbackScale) };
  }

  // Whichever axis is tighter decides, so the whole plan fits.
  const scale = Math.min(
    width > 0 ? usableWidth / width : Infinity,
    height > 0 ? usableHeight / height : Infinity,
  );

  return { centre, scale: clampScale(scale) };
}

/**
 * Grid spacing that stays legible at any zoom.
 *
 * Steps through 1-2-5 decades and picks the smallest whose lines are at least
 * `minPixels` apart. A fixed spacing would be a wall of ink when zoomed out and
 * invisible when zoomed in.
 */
export function gridSpacing(viewport: Viewport, minPixels = 8): { minor: Mm; major: Mm } {
  const steps = [1, 2, 5];
  let minor = 1;

  // 10m is as coarse as a house plan ever needs.
  for (let decade = 0; decade <= 4; decade++) {
    let found = false;
    for (const step of steps) {
      const candidate = step * 10 ** decade;
      if (candidate * viewport.scale >= minPixels) {
        minor = candidate;
        found = true;
        break;
      }
    }
    if (found) break;
    minor = 10 ** (decade + 1);
  }

  // A heavier line every metre where that is sensible, otherwise every fifth.
  const major = minor <= 100 ? 1000 : minor * 5;
  return { minor, major };
}
