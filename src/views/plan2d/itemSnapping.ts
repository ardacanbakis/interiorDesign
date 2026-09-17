/**
 * Snapping for furniture.
 *
 * Quite a different problem from snapping a point, and worth its own module.
 * A wall corner is one coordinate; a wardrobe is a position *and* an
 * orientation, and the thing people actually want is almost never "put its
 * centre here". It is "put its back against that wall", and then "and butt it
 * up against the one already there".
 *
 * So the snap is worked out in the wall's own frame:
 *
 *   1. Find the nearest wall face within reach of the pointer.
 *   2. Turn the item to face away from it — its back flat against the masonry.
 *   3. Slide it along the wall to where the pointer is, then let it catch on the
 *      edge of a neighbour standing against the same wall.
 *
 * Nothing in reach falls back to the grid, which is what you want in the middle
 * of a room where a sofa floats.
 */

import {
  dot,
  normalize,
  perpendicular,
  scale,
  sub,
  add,
  type Vec2,
} from '../../core/geometry/vec2.ts';
import { allWalls, nodePoint, type WallGraph } from '../../core/graph/wallGraph.ts';
import { itemAxes, itemBounds, rotationFacing } from '../../core/catalog/placement.ts';
import { type Item } from '../../core/model/schema.ts';
import { type Mm } from '../../core/units/length.ts';
import { type SnapGuide } from './snapping.ts';

export type ItemSnapKind = 'wall' | 'neighbour' | 'grid' | 'free';

export interface ItemSnap {
  readonly x: Mm;
  readonly y: Mm;
  readonly rotation: number;
  readonly kind: ItemSnapKind;
  readonly guides: readonly SnapGuide[];
}

export interface ItemSnapOptions {
  /** How far from a wall face the item is still pulled onto it. */
  readonly reach: Mm;
  /** Grid spacing for the free case. */
  readonly grid: Mm;
  /** Other items on the floor, for edge-to-edge snapping. */
  readonly neighbours?: readonly Item[];
  /** Held modifier turns the lot off. */
  readonly enabled?: boolean;
}

/**
 * Where an item should land for a pointer position.
 *
 * `item` supplies the size and the current rotation; only its position and
 * rotation are decided here.
 */
export function snapItem(
  graph: WallGraph,
  item: Item,
  target: Vec2,
  options: ItemSnapOptions,
): ItemSnap {
  if (options.enabled === false) {
    return {
      x: Math.round(target.x),
      y: Math.round(target.y),
      rotation: item.rotation,
      kind: 'free',
      guides: [],
    };
  }

  // Reach is measured to the item's *back*, not to its centre. An item snapped
  // to a wall stands half its depth off the face, so a 600mm wardrobe dragged to
  // exactly where it belongs has its centre 300mm away — and a reach measured
  // from the centre would refuse to snap at the one position that is right.
  const wall = nearestWallFace(graph, target, options.reach + item.depth / 2);
  if (!wall) return toGrid(target, item.rotation, options.grid);

  // Facing away from the wall, so the back is what touches it.
  const rotation = rotationFacing(wall.outward);
  const back = scale(wall.outward, item.depth / 2);

  // How far along the wall the pointer is, then let a neighbour catch it.
  const raw = dot(sub(target, wall.origin), wall.along);
  const along = snapAlongWall(raw, item, wall, options);

  const centre = add(add(wall.origin, scale(wall.along, along.value)), back);

  return {
    x: Math.round(centre.x),
    y: Math.round(centre.y),
    rotation,
    kind: along.caught ? 'neighbour' : 'wall',
    guides: along.guides,
  };
}

// ---------------------------------------------------------------------------

interface WallFace {
  /** A point on the face, at the wall's `a` end. */
  readonly origin: Vec2;
  /** Unit vector along the wall, from `a` to `b`. */
  readonly along: Vec2;
  /** Unit vector off the face, away from the wall. */
  readonly outward: Vec2;
  readonly length: Mm;
}

/**
 * The nearest wall face to a point, on the side the point is on.
 *
 * A wall has two faces and a piece of furniture goes against one of them. Which
 * one is not a guess: it is whichever side of the centreline the pointer is on,
 * so dragging a bed across a partition moves it into the next room rather than
 * flipping it back.
 */
function nearestWallFace(graph: WallGraph, point: Vec2, reach: Mm): WallFace | null {
  let best: WallFace | null = null;
  let bestDistance = reach;

  for (const wall of allWalls(graph)) {
    const a = nodePoint(graph, wall.a);
    const b = nodePoint(graph, wall.b);
    const span = sub(b, a);
    const length = Math.hypot(span.x, span.y);
    if (length === 0) continue;

    const along = normalize(span);
    const right = perpendicular(along);

    // Only walls the point is actually beside, not ones it is off the end of.
    const t = dot(sub(point, a), along);
    if (t < 0 || t > length) continue;

    const side = dot(sub(point, a), right) >= 0 ? 1 : -1;
    const outward = scale(right, side);
    const face = add(a, scale(outward, wall.thickness / 2));

    // How far off the face the point is. Negative means it is inside the
    // masonry, which is an ordinary thing for a pointer being dragged across a
    // wall, so the magnitude is what counts.
    const distance = Math.abs(dot(sub(point, face), outward));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { origin: face, along, outward, length };
    }
  }

  return best;
}

interface AlongResult {
  readonly value: Mm;
  readonly caught: boolean;
  readonly guides: readonly SnapGuide[];
}

/**
 * Slide along the wall, catching on the neighbours.
 *
 * Only items standing against the same face count. Two wardrobes on opposite
 * walls of a room happen to line up in this coordinate all the time, and
 * catching on one of those would be baffling.
 */
function snapAlongWall(raw: Mm, item: Item, wall: WallFace, options: ItemSnapOptions): AlongResult {
  const half = item.width / 2;
  const neighbours = options.neighbours ?? [];

  let best: { value: Mm; guide: SnapGuide } | null = null;
  let bestDistance = options.reach;

  for (const other of neighbours) {
    if (other.id === item.id) continue;

    // Same face, which means: pointing the same way, and standing at the same
    // distance off the wall.
    const facing = itemAxes(other).front;
    if (dot(facing, wall.outward) < 0.99) continue;

    const centre = { x: other.x, y: other.y };
    const offWall = dot(sub(centre, wall.origin), wall.outward);
    if (Math.abs(offWall - other.depth / 2) > options.reach) continue;

    const otherAlong = dot(sub(centre, wall.origin), wall.along);

    // Shoulder to shoulder, either side.
    for (const candidate of [
      otherAlong + other.width / 2 + half,
      otherAlong - other.width / 2 - half,
    ]) {
      const distance = Math.abs(candidate - raw);
      if (distance >= bestDistance) continue;

      bestDistance = distance;
      const edge =
        candidate > otherAlong ? otherAlong + other.width / 2 : otherAlong - other.width / 2;
      const meeting = add(wall.origin, scale(wall.along, edge));
      const bounds = itemBounds(other);
      best = {
        value: candidate,
        guide: {
          from: meeting,
          to: add(meeting, scale(wall.outward, Math.max(bounds.maxY - bounds.minY, other.depth))),
        },
      };
    }
  }

  if (best) return { value: best.value, caught: true, guides: [best.guide] };

  // Not against anything: keep the item on the wall rather than hanging off the
  // end of it, but do not force it into a corner it was not aimed at.
  const clamped = Math.min(Math.max(raw, half), Math.max(half, wall.length - half));
  return { value: clamped, caught: false, guides: [] };
}

function toGrid(target: Vec2, rotation: number, grid: Mm): ItemSnap {
  if (grid <= 0) {
    return { x: Math.round(target.x), y: Math.round(target.y), rotation, kind: 'grid', guides: [] };
  }
  return {
    x: Math.round(target.x / grid) * grid,
    y: Math.round(target.y / grid) * grid,
    rotation,
    kind: 'grid',
    guides: [],
  };
}
