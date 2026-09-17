/**
 * Small builders, so a furniture definition reads like a description of the
 * furniture rather than like geometry code.
 *
 * Everything here works in an item's local coordinates: origin at the centre of
 * the footprint, +x across its width, +y towards its front, +z up from the
 * floor. See `types.ts`.
 */

import { type Polygon } from '../geometry/polygon.ts';
import { vec2, type Vec2 } from '../geometry/vec2.ts';
import { type Mm } from '../units/length.ts';
import {
  type ClearanceSeverity,
  type ClearanceZone,
  type PlanArc,
  type PlanShape,
  type PlanStroke,
  type SolidPart,
  type Vec3,
} from './types.ts';

/** A rectangle centred on the origin. */
export function rect(width: Mm, depth: Mm): Polygon {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  return [
    vec2(-halfWidth, -halfDepth),
    vec2(halfWidth, -halfDepth),
    vec2(halfWidth, halfDepth),
    vec2(-halfWidth, halfDepth),
  ];
}

/**
 * A rectangle placed anywhere, given its centre.
 *
 * Most parts of a piece of furniture are off-centre — a sofa arm, a bedside
 * drawer — so this is the one used most.
 */
export function rectAt(centreX: number, centreY: number, width: Mm, depth: Mm): Polygon {
  return rect(width, depth).map((point) => vec2(point.x + centreX, point.y + centreY));
}

/**
 * A rounded rectangle, approximated as a polygon.
 *
 * Used for anything upholstered or sanitary: a sofa drawn as a hard rectangle
 * reads as a cupboard.
 */
export function roundedRect(width: Mm, depth: Mm, radius: Mm, segments = 4): Polygon {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const r = Math.max(0, Math.min(radius, halfWidth, halfDepth));
  if (r === 0) return rect(width, depth);

  const corners: { x: number; y: number; from: number }[] = [
    { x: halfWidth - r, y: halfDepth - r, from: 0 },
    { x: -halfWidth + r, y: halfDepth - r, from: Math.PI / 2 },
    { x: -halfWidth + r, y: -halfDepth + r, from: Math.PI },
    { x: halfWidth - r, y: -halfDepth + r, from: (3 * Math.PI) / 2 },
  ];

  const points: Vec2[] = [];
  for (const corner of corners) {
    for (let step = 0; step <= segments; step++) {
      const angle = corner.from + (Math.PI / 2) * (step / segments);
      points.push(vec2(corner.x + Math.cos(angle) * r, corner.y + Math.sin(angle) * r));
    }
  }
  return points;
}

/** An ellipse, for round tables and basins. */
export function ellipse(width: Mm, depth: Mm, segments = 24): Polygon {
  const points: Vec2[] = [];
  for (let step = 0; step < segments; step++) {
    const angle = (step / segments) * Math.PI * 2;
    points.push(vec2((Math.cos(angle) * width) / 2, (Math.sin(angle) * depth) / 2));
  }
  return points;
}

export function stroke(points: readonly Vec2[], options: Partial<PlanStroke> = {}): PlanStroke {
  return { points, ...options };
}

/** A straight line between two points. */
export function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  options: Partial<PlanStroke> = {},
): PlanStroke {
  return stroke([vec2(x1, y1), vec2(x2, y2)], options);
}

/** A closed rectangle drawn as a stroke, not a fill — a drawer front, a panel. */
export function outlineRect(
  centreX: number,
  centreY: number,
  width: Mm,
  depth: Mm,
  options: Partial<PlanStroke> = {},
): PlanStroke {
  return stroke(rectAt(centreX, centreY, width, depth), { closed: true, ...options });
}

export function arc(
  centre: Vec2,
  radius: Mm,
  startAngle: number,
  endAngle: number,
  dashed = true,
): PlanArc {
  return { centre, radius, startAngle, endAngle, dashed };
}

/** Assemble a plan shape, so definitions need not spell out empty arrays. */
export function shape(
  outline: Polygon,
  parts: {
    strokes?: readonly PlanStroke[];
    arcs?: readonly PlanArc[];
    voids?: readonly Polygon[];
  } = {},
): PlanShape {
  return {
    outline,
    strokes: parts.strokes ?? [],
    arcs: parts.arcs ?? [],
    voids: parts.voids ?? [],
  };
}

// ---------------------------------------------------------------------------
// Solids
// ---------------------------------------------------------------------------

/**
 * One box of a solid.
 *
 * `z` is the height of the box's **underside**, not its centre, because that is
 * how furniture is actually described — a worktop is at 900, a wall cupboard
 * starts at 1400.
 */
export function box(
  centreX: number,
  centreY: number,
  z: Mm,
  size: Vec3,
  material: SolidPart['material'] = 'carcass',
): SolidPart {
  return {
    centre: { x: centreX, y: centreY, z: z + size.z / 2 },
    size,
    material,
  };
}

/**
 * The size of one box.
 *
 * Clamped away from zero deliberately. Every dimension an item has is editable,
 * and definitions describe their parts by subtraction — "the carcass is the
 * depth less the door", "the frame is the height less the mattress". Shrink the
 * item far enough and one of those subtractions goes negative, and a box with a
 * negative dimension is not a smaller box, it is a rendering bug. One clamp
 * here saves the same guard in sixty definitions.
 */
export function size3(x: Mm, y: Mm, z: Mm): Vec3 {
  return { x: Math.max(1, x), y: Math.max(1, y), z: Math.max(1, z) };
}

/** A simple slab filling the item's footprint — the commonest single part. */
export function slab(
  width: Mm,
  depth: Mm,
  z: Mm,
  height: Mm,
  material: SolidPart['material'] = 'carcass',
): SolidPart {
  return box(0, 0, z, size3(width, depth, height), material);
}

// ---------------------------------------------------------------------------
// Clearance
// ---------------------------------------------------------------------------

export interface FrontZoneOptions {
  readonly id: string;
  readonly reason: string;
  /** How far out from the front face the space is needed. */
  readonly depth: Mm;
  /** Defaults to the item's full width. */
  readonly width?: Mm;
  readonly severity?: ClearanceSeverity;
  /** Obstructions shorter than this are ignored. Defaults to 100mm. */
  readonly minimumBlockingHeight?: Mm;
}

/**
 * The space an item needs directly in front of it.
 *
 * The overwhelmingly common case: wardrobe doors, drawer pulls, oven doors,
 * getting into a shower. Measured from the front face (+y) outwards.
 */
export function frontZone(itemWidth: Mm, itemDepth: Mm, options: FrontZoneOptions): ClearanceZone {
  const width = options.width ?? itemWidth;
  const front = itemDepth / 2;

  return {
    id: options.id,
    reason: options.reason,
    polygon: rectAt(0, front + options.depth / 2, width, options.depth),
    severity: options.severity ?? 'warning',
    minimumBlockingHeight: options.minimumBlockingHeight ?? 100,
  };
}

export interface SideZoneOptions extends Omit<FrontZoneOptions, 'depth'> {
  /** How far out from the side face the space is needed. */
  readonly reach: Mm;
  readonly side: 'left' | 'right';
  /** How much of the item's length the zone runs along. Defaults to all of it. */
  readonly along?: Mm;
  /** Where along the item that run is centred. Defaults to the middle. */
  readonly offset?: Mm;
}

/** The space beside an item — getting out of a bed, standing beside a WC. */
export function sideZone(itemWidth: Mm, itemDepth: Mm, options: SideZoneOptions): ClearanceZone {
  const along = options.along ?? itemDepth;
  const edge = itemWidth / 2;
  const direction = options.side === 'right' ? 1 : -1;

  return {
    id: options.id,
    reason: options.reason,
    polygon: rectAt(
      direction * (edge + options.reach / 2),
      options.offset ?? 0,
      options.reach,
      along,
    ),
    severity: options.severity ?? 'warning',
    minimumBlockingHeight: options.minimumBlockingHeight ?? 100,
  };
}
