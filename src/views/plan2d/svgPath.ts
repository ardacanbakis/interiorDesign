import { type Polygon } from '../../core/geometry/polygon.ts';

/**
 * A closed SVG path for a ring, in model coordinates.
 *
 * Coordinates go in unrounded. The plan's own numbers are already whole
 * millimetres, and the few that are not — offset corners, swing arcs — are
 * better left exact than snapped to the nearest millimetre purely for the
 * benefit of the path string.
 */
export function polygonPath(polygon: Polygon): string {
  if (polygon.length === 0) return '';

  const [first, ...rest] = polygon;
  return `M${first!.x} ${first!.y}${rest.map((point) => `L${point.x} ${point.y}`).join('')}Z`;
}

/** One path holding several rings, for even-odd filling with holes. */
export function ringsPath(rings: readonly Polygon[]): string {
  return rings.map(polygonPath).join(' ');
}
