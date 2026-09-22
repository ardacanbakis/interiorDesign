/**
 * Applying a graph edit to a whole floor.
 *
 * `operations.ts` returns a new graph and a list of the walls it had to split.
 * Assigning the graph and ignoring the splits leaves every door on a split wall
 * pointing at an id that no longer exists — so this is the function tools call
 * instead, and the splits cannot be dropped by forgetting to look at them.
 */

import { rehomeMerged, rehomeOpenings, type RehomeResult } from '../openings/rehome.ts';
import { type OperationResult } from '../graph/operations.ts';
import { type WeldResult } from '../graph/weld.ts';
import { type Floor } from './schema.ts';

export interface FloorEditResult {
  readonly floor: Floor;
  /** Openings nudged along their wall to still fit after a split. */
  readonly moved: readonly string[];
  /** Openings dropped because no part of the split wall could hold them. */
  readonly dropped: readonly string[];
}

/**
 * Put a graph edit onto a floor, carrying its openings with it.
 *
 * Returns the same floor object when the edit changed nothing, so a tool that
 * runs on every pointer move does not mark the document as modified for a drag
 * that went nowhere.
 */
export function applyGraphEdit(floor: Floor, result: OperationResult): FloorEditResult {
  if (result.graph === floor.graph && result.splits.length === 0) {
    return { floor, moved: [], dropped: [] };
  }

  const rehomed: RehomeResult = rehomeOpenings(floor.openings, result.splits);

  return {
    floor: {
      ...floor,
      graph: result.graph,
      openings: rehomed.openings === floor.openings ? floor.openings : [...rehomed.openings],
    },
    moved: rehomed.moved,
    dropped: rehomed.dropped,
  };
}

/**
 * Put a weld onto a floor, carrying its openings with it.
 *
 * Two sets of records, applied in the order they happened: the cuts that turned
 * partial overlaps into exact ones, then the merges that collapsed each exact
 * overlap into one wall. Applying them the other way round would look for a
 * door on a wall that the cut had already replaced.
 */
export function applyWeld(floor: Floor, result: WeldResult): FloorEditResult {
  if (result.graph === floor.graph && result.splits.length === 0 && result.merges.length === 0) {
    return { floor, moved: [], dropped: [] };
  }

  const cut = rehomeOpenings(floor.openings, result.splits);
  const merged = rehomeMerged(cut.openings, result.merges);

  const dropped = [...new Set([...cut.dropped, ...merged.dropped])];
  const moved = [...new Set([...cut.moved, ...merged.moved])].filter((id) => !dropped.includes(id));

  return {
    floor: { ...floor, graph: result.graph, openings: [...merged.openings] },
    moved,
    dropped,
  };
}

/**
 * Drop openings whose host wall has gone.
 *
 * A safety net rather than the main mechanism — {@link applyGraphEdit} is what
 * keeps openings attached. This catches the case where a wall is deleted
 * outright, which produces no split record because nothing was split, and
 * guards against a future edit path that forgets to route through the helper.
 * An opening referencing a wall that is not there would otherwise throw the
 * moment anything tried to draw it.
 */
export function pruneOrphanedOpenings(floor: Floor): Floor {
  const orphaned = floor.openings.filter((opening) => !floor.graph.walls[opening.wallId]);
  if (orphaned.length === 0) return floor;

  return {
    ...floor,
    openings: floor.openings.filter((opening) => floor.graph.walls[opening.wallId] !== undefined),
  };
}
