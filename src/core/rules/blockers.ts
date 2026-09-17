/**
 * What counts as being in the way.
 *
 * Shared by most of the rules, and the place the height-awareness lives. Two
 * things sharing floor plan is not the question — a rug under a table, a shelf
 * over a desk and a wall unit over a worktop all do, and none of them is a
 * problem. The question is whether they share floor plan *at a height where it
 * matters*, and that is what makes the difference between a checker people
 * leave switched on and one they turn off in the first five minutes.
 */

import { itemBounds, itemFootprint, itemHeightRange } from '../catalog/placement.ts';
import { heightsOverlap, polygonsOverlap } from '../geometry/overlap.ts';
import { boundingBox, boundingBoxesOverlap, type Polygon } from '../geometry/polygon.ts';
import { allWalls, type WallGraph } from '../graph/wallGraph.ts';
import { wallPolygon } from '../graph/wallShapes.ts';
import { findDefinition } from '../catalog/registry.ts';
import { type Item } from '../model/schema.ts';
import { type Mm } from '../units/length.ts';

/** A vertical span, measured from the floor. */
export interface HeightBand {
  readonly bottom: Mm;
  readonly top: Mm;
}

/**
 * The band of height a clearance zone actually cares about.
 *
 * From the zone's own threshold up to the top of the object that asked for it.
 * A base unit's working clearance runs from 100mm to 850mm, so a wall cupboard
 * at 1400 is not blocking it — you stand under that. A wardrobe's door swing
 * runs to 2100, so the same cupboard is very much in the way.
 *
 * Deriving it rather than storing it keeps every definition one field shorter
 * and gets the answer right for all sixty without anyone having to think about
 * it per object.
 */
export function zoneBand(item: Item, minimumBlockingHeight: Mm): HeightBand {
  return {
    bottom: minimumBlockingHeight,
    top: Math.max(minimumBlockingHeight + 1, item.elevation + item.height),
  };
}

/** Items that stand in a zone at a height that matters. */
export function itemsBlocking(
  zone: Polygon,
  band: HeightBand,
  candidates: readonly Item[],
  exclude: ReadonlySet<string> = new Set(),
): Item[] {
  const zoneBox = boundingBox(zone);

  return candidates.filter((candidate) => {
    if (exclude.has(candidate.id)) return false;
    if (!findDefinition(candidate.kind)) return false;
    if (!heightsOverlap(itemHeightRange(candidate), band)) return false;
    if (!boundingBoxesOverlap(zoneBox, itemBounds(candidate))) return false;
    return polygonsOverlap(itemFootprint(candidate), zone);
  });
}

/**
 * Walls standing in a zone.
 *
 * A wall blocks everything, at every height, which is why it needs no band. A
 * bed with its access side against a wall has nowhere to get out, and that is
 * exactly as much of a problem as a wardrobe there would be.
 */
export function wallsBlocking(zone: Polygon, graph: WallGraph): string[] {
  const zoneBox = boundingBox(zone);

  return allWalls(graph)
    .filter((wall) => {
      const polygon = wallPolygon(graph, wall);
      if (!boundingBoxesOverlap(zoneBox, boundingBox(polygon))) return false;
      return polygonsOverlap(polygon, zone);
    })
    .map((wall) => wall.id);
}

/**
 * True for something you walk on rather than round.
 *
 * A rug occupies floor at 0–15mm, which technically overlaps everything
 * standing on the floor. Treating that as a collision would flag every room
 * with a rug in it, so anything this flat is simply not an obstruction.
 */
export function isFloorCovering(item: Item, stepOverHeight: Mm): boolean {
  return item.elevation === 0 && item.height <= stepOverHeight;
}
