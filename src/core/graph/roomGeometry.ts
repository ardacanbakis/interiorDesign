/**
 * Turning a face into a room you could measure with a tape.
 *
 * A face from `faces.ts` runs along wall **centrelines**, because that is where
 * the graph's nodes are. Nobody measures a room that way. The usable floor is
 * bounded by the walls' inner faces, so every edge has to be pulled in by half
 * the thickness of its own wall — half, because the other half belongs to the
 * room on the other side. That is exactly the point of shared walls: a 100mm
 * partition takes 50mm from each of the rooms it separates, not 100mm from
 * both.
 *
 * Walls of different thickness meeting at a corner pull in by different
 * amounts, so the new corner is where the two offset lines cross rather than
 * anywhere on the original. That is the whole of the calculation, and it is
 * why it is done with line intersections rather than by nudging each vertex.
 */

import {
  area as polygonArea,
  perimeter as polygonPerimeter,
  representativePoint,
  reverse,
  signedArea,
  type Polygon,
} from '../geometry/polygon.ts';
import { lineIntersection } from '../geometry/segment.ts';
import { normalize, perpendicular, sub, type Vec2 } from '../geometry/vec2.ts';
import { type Mm, type Mm2 } from '../units/length.ts';
import { type Face } from './faces.ts';
import { getWall, type WallGraph, type WallId } from './wallGraph.ts';

export interface RoomGeometry {
  /** The floor's boundary — the inner faces of the surrounding walls. */
  readonly outline: Polygon;
  /** Freestanding structures standing in the room, grown by their own walls. */
  readonly holes: readonly Polygon[];
  /** Usable floor area, holes excluded. */
  readonly area: Mm2;
  /** Length of the inner boundary. */
  readonly perimeter: Mm;
  /** A point comfortably inside the usable floor, for labels. */
  readonly interiorPoint: Vec2;
}

/**
 * Compute a room's usable floor from its face.
 *
 * Falls back to the centreline polygon if the offset would turn the room
 * inside out — which happens when walls are thicker than the gap between them,
 * as during the moment a wall is being dragged across a narrow room. Returning
 * a degenerate shape is better than returning a self-intersecting one that
 * would then render as a knot.
 */
export function roomGeometry(graph: WallGraph, face: Face): RoomGeometry {
  const offsets = face.wallIds.map((wallId) => getWall(graph, wallId).thickness / 2);
  const cleaned = simplifyRing(face.polygon, offsets);

  const outline = insetRing(cleaned.polygon, cleaned.offsets) ?? face.polygon;

  // A hole is the outside of something solid, so its walls push the room's
  // floor away rather than pulling it in — the same inset with the sign
  // flipped.
  const holes = face.holes.map((hole) => insetHole(graph, hole, face) ?? hole);

  const holeArea = holes.reduce((total, hole) => total + polygonArea(hole), 0);

  return {
    outline,
    holes,
    area: Math.max(0, polygonArea(outline) - holeArea),
    perimeter: polygonPerimeter(outline),
    interiorPoint: representativePoint(outline),
  };
}

/**
 * Offset every edge of a ring perpendicular to itself by its own distance.
 *
 * A **positive** offset pulls the edge towards the enclosed area, so the ring
 * shrinks; a **negative** one pushes it away and the ring grows. Both are
 * needed: room walls pull the floor in, and the walls of a column standing in
 * that room push the floor out around it.
 *
 * Each edge becomes an offset line and each new corner is where consecutive
 * lines meet, which is what makes walls of differing thickness join correctly
 * instead of leaving a step at every corner.
 *
 * Returns null when the offset destroys the ring — the walls met in the middle
 * and there is no floor left.
 */
export function insetRing(ring: Polygon, offsets: readonly Mm[]): Polygon | null {
  if (ring.length < 3 || offsets.length !== ring.length) return null;

  const originalArea = signedArea(ring);
  if (originalArea === 0) return null;

  // The ring may arrive wound either way; work clockwise and restore after.
  const clockwise = originalArea > 0;
  const working = clockwise ? ring : reverse(ring);
  const workingOffsets = clockwise ? offsets : [...offsets].reverse();

  const count = working.length;
  const lines: { point: Vec2; direction: Vec2 }[] = [];

  for (let index = 0; index < count; index++) {
    const start = working[index]!;
    const end = working[(index + 1) % count]!;
    const direction = sub(end, start);

    // For a clockwise ring in a y-down system, `perpendicular` points into the
    // enclosed area. (See the orientation notes in vec2.ts — this is the sign
    // that flips if that convention ever changes.)
    const inward = perpendicular(normalize(direction));
    const offset = workingOffsets[index] ?? 0;

    lines.push({
      point: { x: start.x + inward.x * offset, y: start.y + inward.y * offset },
      direction,
    });
  }

  const result: Vec2[] = [];
  for (let index = 0; index < count; index++) {
    const previous = lines[(index - 1 + count) % count]!;
    const current = lines[index]!;

    const corner = lineIntersection(
      previous.point,
      previous.direction,
      current.point,
      current.direction,
    );

    // Consecutive collinear edges never meet; the offset point is the answer.
    result.push(corner ?? current.point);
  }

  if (!isValidOffset(working, result)) return null;

  return clockwise ? result : reverse(result);
}

/**
 * Has the offset produced a real ring, or has it turned itself inside out?
 *
 * The test is per edge: if an edge of the result points the opposite way to the
 * edge it came from, the two ends have crossed over each other and the ring has
 * collapsed through itself. A 300mm cupboard offset inwards by 200mm produces
 * exactly that — four edges that have each swapped ends, giving a plausible
 * 100mm square in the middle that is not a room at all.
 *
 * Comparing areas instead would not do. It catches the collapse but also
 * rejects every *negative* offset, since growing a ring legitimately increases
 * its area — and growing is how a column's walls push the floor away from it.
 */
function isValidOffset(original: Polygon, offset: Polygon): boolean {
  const count = original.length;

  for (let index = 0; index < count; index++) {
    const next = (index + 1) % count;
    const before = sub(original[next]!, original[index]!);
    const after = sub(offset[next]!, offset[index]!);

    if (before.x * after.x + before.y * after.y <= 0) return false;
  }

  return signedArea(offset) > 0;
}

/**
 * Grow a hole by half the thickness of the walls around it, so the room's
 * floor stops at the outside of the column rather than at its centreline.
 *
 * Which wall bounds which edge of a hole is not recorded — holes come from a
 * different connected component than the face that contains them — so this
 * uses the thickest wall in that component as a uniform offset. Columns and
 * partitions are built of one thickness in practice, so this is exact in the
 * cases that occur and conservative otherwise.
 */
function insetHole(graph: WallGraph, hole: Polygon, face: Face): Polygon | null {
  const thickness = thickestWallNear(graph, face.wallIds);
  const offsets = hole.map(() => -thickness / 2);
  return insetRing(hole, offsets);
}

function thickestWallNear(graph: WallGraph, wallIds: readonly WallId[]): Mm {
  let thickest = 0;
  for (const wallId of wallIds) {
    const wall = graph.walls[wallId];
    if (wall && wall.thickness > thickest) thickest = wall.thickness;
  }
  return thickest;
}

interface CleanedRing {
  readonly polygon: Polygon;
  readonly offsets: readonly Mm[];
}

/**
 * Tidy a face ring before offsetting it, in two passes.
 *
 * **Spurs.** A partition attached to one wall but reaching no further divides
 * nothing, so the face traversal walks out along it and straight back. That
 * leaves a zero-width excursion in the ring: no effect on area, but it would
 * send the offset calculation into a self-intersecting tangle. Trimming the tip
 * repeatedly removes a spur of any length.
 *
 * **Collinear runs.** A wall split in two by a T-junction elsewhere leaves a
 * vertex mid-edge with nothing happening at it. Merging those keeps the outline
 * to its real corners — but only when both walls are the same thickness. Where
 * they differ the room genuinely has a step in its wall, and that step is real
 * and worth keeping.
 */
function simplifyRing(polygon: Polygon, offsets: readonly Mm[]): CleanedRing {
  let points = [...polygon];
  let sides = [...offsets];

  const restore = (): CleanedRing => ({ polygon, offsets });

  // Pass one — spurs.
  let trimmed = true;
  while (trimmed && points.length > 3) {
    trimmed = false;

    for (let index = 0; index < points.length; index++) {
      const count = points.length;
      const previous = points[(index - 1 + count) % count]!;
      const next = points[(index + 1) % count]!;

      // The step before and the step after land in the same place, so the
      // vertex between them is the tip of a spur.
      if (previous.x !== next.x || previous.y !== next.y) continue;

      // Points and edges are indexed off by one from each other: `offsets[j]`
      // belongs to the edge from `points[j]` to `points[j + 1]`. Dropping the
      // tip removes points `index` and `index + 1` (the latter being the
      // duplicate of the base), but edges `index - 1` and `index` — the two
      // that run out to the tip and back. Removing the same indices from both
      // would hand the wall after the spur the *spur's* thickness.
      const tip = index;
      const duplicateBase = (index + 1) % count;
      const edgeOut = (index - 1 + count) % count;
      const edgeBack = index;

      points = points.filter((_, at) => at !== tip && at !== duplicateBase);
      sides = sides.filter((_, at) => at !== edgeOut && at !== edgeBack);

      trimmed = true;
      break;
    }
  }

  if (points.length < 3) return restore();

  // Pass two — collinear runs between walls of equal thickness.
  let merged = true;
  while (merged && points.length > 3) {
    merged = false;

    for (let index = 0; index < points.length; index++) {
      const count = points.length;
      const previousIndex = (index - 1 + count) % count;

      if (sides[previousIndex] !== sides[index]) continue;

      const incoming = sub(points[index]!, points[previousIndex]!);
      const outgoing = sub(points[(index + 1) % count]!, points[index]!);
      if (Math.abs(incoming.x * outgoing.y - incoming.y * outgoing.x) > 1e-6) continue;
      // Collinear but doubling back is a spur, already handled above.
      if (incoming.x * outgoing.x + incoming.y * outgoing.y <= 0) continue;

      points.splice(index, 1);
      sides.splice(index, 1);
      merged = true;
      break;
    }
  }

  return points.length >= 3 ? { polygon: points, offsets: sides } : restore();
}
