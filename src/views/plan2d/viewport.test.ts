import { describe, expect, it } from 'vitest';

import { vec2 } from '../../core/geometry/vec2.ts';
import {
  clampScale,
  fitTo,
  gridSpacing,
  MAX_SCALE,
  MIN_SCALE,
  panBy,
  screenPixels,
  toModel,
  toScreen,
  viewBox,
  visibleBounds,
  zoomAt,
  type Viewport,
} from './viewport.ts';

const size = { width: 1000, height: 600 };
const viewport: Viewport = { centre: vec2(0, 0), scale: 0.2 };

describe('toModel / toScreen', () => {
  it('maps the centre of the view to the viewport centre', () => {
    expect(toModel(viewport, size, vec2(500, 300))).toEqual({ x: 0, y: 0 });
    expect(toScreen(viewport, size, vec2(0, 0))).toEqual({ x: 500, y: 300 });
  });

  it('maps right and down consistently, with no flip', () => {
    // 0.2 px per mm, so 100px right of centre is 500mm right in the model.
    expect(toModel(viewport, size, vec2(600, 300))).toEqual({ x: 500, y: 0 });
    expect(toModel(viewport, size, vec2(500, 400))).toEqual({ x: 0, y: 500 });
  });

  it('round-trips', () => {
    for (const point of [vec2(0, 0), vec2(4000, -2500), vec2(-123, 456)]) {
      const screen = toScreen(viewport, size, point);
      const back = toModel(viewport, size, screen);
      expect(back.x).toBeCloseTo(point.x, 6);
      expect(back.y).toBeCloseTo(point.y, 6);
    }
  });

  it('follows the viewport centre', () => {
    const panned: Viewport = { centre: vec2(4000, 3000), scale: 0.2 };
    expect(toModel(panned, size, vec2(500, 300))).toEqual({ x: 4000, y: 3000 });
  });
});

describe('visibleBounds / viewBox', () => {
  it('reports the model rectangle on screen', () => {
    // 1000px wide at 0.2 px/mm is 5000mm across, centred on the origin.
    expect(visibleBounds(viewport, size)).toEqual({
      minX: -2500,
      minY: -1500,
      maxX: 2500,
      maxY: 1500,
    });
  });

  it('formats a viewBox in model units', () => {
    expect(viewBox(viewport, size)).toBe('-2500 -1500 5000 3000');
  });
});

describe('screenPixels', () => {
  it('converts a screen size into model units', () => {
    // A 12px label at 0.2 px/mm has to be drawn 60 model units tall.
    expect(screenPixels(viewport, 12)).toBe(60);
    expect(screenPixels({ ...viewport, scale: 1 }, 12)).toBe(12);
  });
});

describe('clampScale', () => {
  it('holds the zoom inside usable limits', () => {
    expect(clampScale(0.0000001)).toBe(MIN_SCALE);
    expect(clampScale(9999)).toBe(MAX_SCALE);
    expect(clampScale(0.5)).toBe(0.5);
  });
});

describe('zoomAt', () => {
  it('keeps the anchor point under the pointer', () => {
    // This is what makes wheel-zoom feel like the plan is under your finger.
    const anchorScreen = vec2(800, 200);
    const anchorModel = toModel(viewport, size, anchorScreen);

    const zoomed = zoomAt(viewport, size, anchorScreen, 2);
    const after = toScreen(zoomed, size, anchorModel);

    expect(after.x).toBeCloseTo(anchorScreen.x, 6);
    expect(after.y).toBeCloseTo(anchorScreen.y, 6);
  });

  it('holds the anchor when zooming out too', () => {
    const anchorScreen = vec2(120, 540);
    const anchorModel = toModel(viewport, size, anchorScreen);

    const zoomed = zoomAt(viewport, size, anchorScreen, 0.5);
    const after = toScreen(zoomed, size, anchorModel);

    expect(after.x).toBeCloseTo(anchorScreen.x, 6);
    expect(after.y).toBeCloseTo(anchorScreen.y, 6);
  });

  it('actually changes the scale', () => {
    expect(zoomAt(viewport, size, vec2(500, 300), 2).scale).toBeCloseTo(0.4);
  });

  it('does nothing once clamped, rather than drifting the centre', () => {
    const atLimit: Viewport = { centre: vec2(0, 0), scale: MAX_SCALE };
    expect(zoomAt(atLimit, size, vec2(800, 200), 2)).toBe(atLimit);
  });
});

describe('panBy', () => {
  it('moves the plan with the pointer', () => {
    // Dragging right moves the content right, so the centre moves left.
    const panned = panBy(viewport, vec2(100, 0));
    expect(panned.centre).toEqual({ x: -500, y: 0 });
  });

  it('is scale-aware', () => {
    const zoomedIn = panBy({ centre: vec2(0, 0), scale: 1 }, vec2(100, 0));
    expect(zoomedIn.centre).toEqual({ x: -100, y: 0 });
  });

  it('leaves the scale alone', () => {
    expect(panBy(viewport, vec2(50, 50)).scale).toBe(viewport.scale);
  });
});

describe('fitTo', () => {
  it('frames a plan with room around it', () => {
    const fitted = fitTo({ minX: 0, minY: 0, maxX: 10_000, maxY: 6000 }, size, { padding: 50 });

    expect(fitted.centre).toEqual({ x: 5000, y: 3000 });
    // 900px of usable width over 10m, and 500px over 6m — height is tighter.
    expect(fitted.scale).toBeCloseTo(500 / 6000);
  });

  it('fits the whole plan on both axes', () => {
    const bounds = { minX: 0, minY: 0, maxX: 10_000, maxY: 6000 };
    const fitted = fitTo(bounds, size, { padding: 50 });
    const visible = visibleBounds(fitted, size);

    expect(visible.minX).toBeLessThanOrEqual(bounds.minX);
    expect(visible.maxX).toBeGreaterThanOrEqual(bounds.maxX);
    expect(visible.minY).toBeLessThanOrEqual(bounds.minY);
    expect(visible.maxY).toBeGreaterThanOrEqual(bounds.maxY);
  });

  it('centres on an empty plan at a readable default instead of dividing by zero', () => {
    const fitted = fitTo({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, size);

    expect(fitted.centre).toEqual({ x: 0, y: 0 });
    expect(Number.isFinite(fitted.scale)).toBe(true);
    expect(fitted.scale).toBe(0.2);
  });

  it('handles a plan that is still a single straight wall', () => {
    // No height at all: the horizontal extent still decides the scale.
    const fitted = fitTo({ minX: 0, minY: 500, maxX: 4000, maxY: 500 }, size, { padding: 50 });

    expect(Number.isFinite(fitted.scale)).toBe(true);
    expect(fitted.scale).toBeCloseTo(900 / 4000);
    expect(fitted.centre).toEqual({ x: 2000, y: 500 });
  });

  it('never exceeds the zoom limits, however small the plan', () => {
    const fitted = fitTo({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, size);
    expect(fitted.scale).toBeLessThanOrEqual(MAX_SCALE);
  });
});

describe('gridSpacing', () => {
  it('keeps grid lines at least a few pixels apart', () => {
    for (const scale of [0.005, 0.02, 0.05, 0.2, 0.5, 1, 3]) {
      const { minor } = gridSpacing({ centre: vec2(0, 0), scale }, 8);
      expect(minor * scale).toBeGreaterThanOrEqual(8);
    }
  });

  it('gets finer as you zoom in', () => {
    const coarse = gridSpacing({ centre: vec2(0, 0), scale: 0.02 });
    const fine = gridSpacing({ centre: vec2(0, 0), scale: 2 });

    expect(fine.minor).toBeLessThan(coarse.minor);
  });

  it('uses round numbers a person would measure in', () => {
    for (const scale of [0.005, 0.02, 0.05, 0.2, 0.5, 1, 3]) {
      const { minor } = gridSpacing({ centre: vec2(0, 0), scale });
      const mantissa = minor / 10 ** Math.floor(Math.log10(minor));
      expect([1, 2, 5]).toContain(Math.round(mantissa));
    }
  });

  it('draws a heavier line at a sensible multiple', () => {
    const { minor, major } = gridSpacing({ centre: vec2(0, 0), scale: 0.2 });
    expect(major % minor).toBe(0);
    expect(major).toBeGreaterThan(minor);
  });
});
