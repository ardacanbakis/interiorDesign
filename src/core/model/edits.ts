/**
 * Applying a graph edit to a whole floor.
 *
 * `operations.ts` returns a new graph and a list of the walls it had to split.
 * Assigning the graph and ignoring the splits leaves every door on a split wall
 * pointing at an id that no longer exists — so this is the function tools call
 * instead, and the splits cannot be dropped by forgetting to look at them.
 */

import { rehomeOpenings, type RehomeResult } from '../openings/rehome.ts';
import { type OperationResult } from '../graph/operations.ts';
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
