/**
 * What each material looks like.
 *
 * Every colour is a CSS custom property defined in `index.css`, so the 3D view
 * follows the light and dark themes the same way the plan does rather than
 * carrying its own hard-coded palette that goes wrong at night.
 *
 * Shading is applied with `color-mix` against a shadow colour, which keeps the
 * whole thing declarative: one fill string per face, no colour arithmetic in
 * JavaScript, and the theme still in charge of the hues.
 */

import { type SceneMaterial } from '../../core/scene/types.ts';

const VARIABLES: Record<SceneMaterial, string> = {
  wall: '--scene-wall',
  floor: '--scene-floor',
  ground: '--scene-ground',
  'door-leaf': '--scene-door',
  sill: '--scene-sill',
  carcass: '--scene-carcass',
  soft: '--scene-soft',
  surface: '--scene-surface',
  metal: '--scene-metal',
  glass: '--scene-glass',
  appliance: '--scene-appliance',
};

/**
 * Brightness is quantised before it reaches the DOM.
 *
 * A face's shade depends only on which way it points, so during an orbit the
 * same wall moves through a continuum of nearly identical values. Rounding to
 * whole steps means React sees the same `fill` string from frame to frame and
 * leaves the attribute alone — visually identical, and a great deal less work.
 */
const STEPS = 20;

export function fillFor(material: SceneMaterial, shade: number, selected = false): string {
  const level = Math.round(Math.max(0, Math.min(1, shade)) * STEPS) / STEPS;
  const percent = Math.round(level * 100);

  const base = selected ? 'var(--color-accent-500)' : `var(${VARIABLES[material]})`;
  return `color-mix(in oklab, ${base} ${percent}%, var(--scene-shadow))`;
}

/** Glass is the one thing you should be able to see through. */
export function opacityFor(material: SceneMaterial): number {
  return material === 'glass' ? 0.4 : 1;
}
