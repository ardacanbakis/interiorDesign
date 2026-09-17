/**
 * Snapping.
 *
 * A pointer cannot hit a millimetre, and a plan where walls miss each other by
 * 3mm is not a plan — the graph stays planar only because walls that are meant
 * to meet actually do. Snapping is what closes the gap between what someone
 * points at and what they mean.
 *
 * Candidates are gathered from several sources and the strongest wins:
 *
 *   1. **Corners.** An existing node is almost always what was meant.
 *   2. **Along a wall.** The nearest point on a wall's centreline, so a new
 *      wall meets an existing one exactly and splits it cleanly.
 *   3. **Alignment.** The same X or Y as some other corner, which is how walls
 *      end up lining up across a plan without anyone measuring.
 *   4. **Grid.** The fallback, at whatever spacing is currently legible.
 *
 * Each candidate carries a guide so the reason for the snap can be drawn.
 * Snapping that moves the pointer without saying why is the thing that makes
 * drawing tools feel possessed.
 */

import { distance, type Vec2 } from '../../core/geometry/vec2.ts';
import { parameterAlong, pointAt } from '../../core/geometry/segment.ts';
import { allNodes, allWalls, wallSegment, type WallGraph } from '../../core/graph/wallGraph.ts';
import { type Mm } from '../../core/units/length.ts';

export type SnapKind = 'node' | 'wall' | 'alignment' | 'axis' | 'grid';

export interface SnapGuide {
  readonly from: Vec2;
  readonly to: Vec2;
}

export interface Snap {
  readonly point: Vec2;
  readonly kind: SnapKind;
  /** Drawn so the user can see what the pointer locked on to. */
  readonly guides: readonly SnapGuide[];
}

export interface SnapOptions {
  /** How far, in model units, the pointer may be pulled. */
  readonly radius: Mm;
  /** Current grid spacing, from `gridSpacing`. */
  readonly grid: Mm;
  /**
   * The point a run is being drawn from. When present, the pointer also snaps
   * to sharing its X or Y, which is how a rectilinear plan gets drawn without
   * fighting for exact right angles.
   */
  readonly anchor?: Vec2 | null;
  /** Nodes to ignore — the one being dragged should not snap to itself. */
  readonly exclude?: ReadonlySet<string>;
  /** Held modifier disables snapping entirely. */
  readonly enabled?: boolean;
}

/**
 * Snap a raw pointer position.
 *
 * Always returns a point: with snapping off, or nothing in range, that is the
 * raw position rounded to the nearest millimetre, because the model stores
 * whole millimetres and a fractional coordinate has nowhere to go.
 */
export function snapPoint(graph: WallGraph, raw: Vec2, options: SnapOptions): Snap {
  if (options.enabled === false) {
    return { point: round(raw), kind: 'grid', guides: [] };
  }

  const exclude = options.exclude ?? new Set<string>();

  return (
    snapToNode(graph, raw, options.radius, exclude) ??
    snapToWall(graph, raw, options.radius) ??
    snapToAlignment(graph, raw, options, exclude) ??
    snapToGrid(raw, options.grid)
  );
}

function round(point: Vec2): Vec2 {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

/** An existing corner. The strongest candidate, and usually the intended one. */
function snapToNode(
  graph: WallGraph,
  raw: Vec2,
  radius: Mm,
  exclude: ReadonlySet<string>,
): Snap | null {
  let best: Vec2 | null = null;
  let bestDistance = radius;

  for (const node of allNodes(graph)) {
    if (exclude.has(node.id)) continue;

    const point = { x: node.x, y: node.y };
    const d = distance(raw, point);
    if (d < bestDistance) {
      bestDistance = d;
      best = point;
    }
  }

  return best ? { point: best, kind: 'node', guides: [] } : null;
}

/**
 * The nearest point on a wall's centreline.
 *
 * Snapping to the centreline rather than to a face is deliberate: the graph
 * stores centrelines, and a new wall ending on one produces a clean split
 * rather than a node floating inside the masonry.
 */
function snapToWall(graph: WallGraph, raw: Vec2, radius: Mm): Snap | null {
  let best: Vec2 | null = null;
  let bestDistance = radius;

  for (const wall of allWalls(graph)) {
    const segment = wallSegment(graph, wall);
    const t = Math.min(1, Math.max(0, parameterAlong(segment, raw)));
    const candidate = pointAt(segment, t);

    const d = distance(raw, candidate);
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }

  return best ? { point: round(best), kind: 'wall', guides: [] } : null;
}

/**
 * Line up with the anchor, or with an existing corner, on one axis.
 *
 * Two quite different things share this pass. Squaring against the anchor is
 * what keeps a run rectilinear while it is being drawn; lining up with a distant
 * corner is what makes two walls on opposite sides of a plan share an edge. Both
 * produce a guide line, because a pointer that jumps without explanation is
 * worse than one that does not snap at all.
 */
function snapToAlignment(
  graph: WallGraph,
  raw: Vec2,
  options: SnapOptions,
  exclude: ReadonlySet<string>,
): Snap | null {
  const { radius, anchor } = options;

  const xCandidates: { value: number; from: Vec2 }[] = [];
  const yCandidates: { value: number; from: Vec2 }[] = [];

  if (anchor) {
    xCandidates.push({ value: anchor.x, from: anchor });
    yCandidates.push({ value: anchor.y, from: anchor });
  }

  for (const node of allNodes(graph)) {
    if (exclude.has(node.id)) continue;
    const point = { x: node.x, y: node.y };
    xCandidates.push({ value: node.x, from: point });
    yCandidates.push({ value: node.y, from: point });
  }

  const bestX = nearest(xCandidates, raw.x, radius);
  const bestY = nearest(yCandidates, raw.y, radius);

  if (!bestX && !bestY) return null;

  const point = round({ x: bestX?.value ?? raw.x, y: bestY?.value ?? raw.y });
  const guides: SnapGuide[] = [];
  if (bestX) guides.push({ from: bestX.from, to: point });
  if (bestY) guides.push({ from: bestY.from, to: point });

  // Squaring off the anchor is a different thing from lining up with a wall
  // across the room, and the two are drawn differently.
  const againstAnchor =
    anchor !== null &&
    anchor !== undefined &&
    ((bestX?.value === anchor.x && bestX.from === anchor) ||
      (bestY?.value === anchor.y && bestY.from === anchor));

  return { point, kind: againstAnchor ? 'axis' : 'alignment', guides };
}

function nearest(
  candidates: readonly { value: number; from: Vec2 }[],
  target: number,
  radius: Mm,
): { value: number; from: Vec2 } | null {
  let best: { value: number; from: Vec2 } | null = null;
  let bestDistance = radius;

  for (const candidate of candidates) {
    const d = Math.abs(candidate.value - target);
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }

  return best;
}

function snapToGrid(raw: Vec2, grid: Mm): Snap {
  if (grid <= 0) return { point: round(raw), kind: 'grid', guides: [] };

  return {
    point: {
      x: Math.round(raw.x / grid) * grid,
      y: Math.round(raw.y / grid) * grid,
    },
    kind: 'grid',
    guides: [],
  };
}

/**
 * Force a run to be horizontal or vertical.
 *
 * Applied after snapping while a wall is being drawn. The plan is rectilinear
 * by design — it is what keeps face extraction robust and snapping predictable
 * — so a run that came out of snapping at 2° off is squared up here rather than
 * quietly admitted to the graph.
 */
export function squareToAxis(anchor: Vec2, point: Vec2): Vec2 {
  const dx = Math.abs(point.x - anchor.x);
  const dy = Math.abs(point.y - anchor.y);
  return dx >= dy ? { x: point.x, y: anchor.y } : { x: anchor.x, y: point.y };
}
