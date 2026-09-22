/**
 * Keeping openings attached when their wall is cut in two.
 *
 * Drawing a partition across a room splits the walls it meets, and the halves
 * get fresh ids. Any door or window hosted on the original is left pointing at
 * a wall that no longer exists — it vanishes from the plan, and because the
 * document still holds it, it comes back wrong the moment anything else is
 * edited.
 *
 * `insertWall` already reports every split it performs. This applies those
 * reports to the openings, in order, so a door stays where it was on whichever
 * half of the wall it now sits.
 */

import { clampOffset } from './geometry.ts';
import { type Opening } from '../model/schema.ts';
import { type WallSplit } from '../graph/wallGraph.ts';
import { type WallMerge } from '../graph/weld.ts';
import { type Mm } from '../units/length.ts';

export interface RehomeResult {
  readonly openings: readonly Opening[];
  /** Openings that had to be nudged along their wall to still fit. */
  readonly moved: readonly string[];
  /**
   * Openings dropped because no part of the split wall could hold them.
   *
   * Reported rather than discarded quietly: a door disappearing from a plan is
   * something the person who drew it needs to be told about.
   */
  readonly dropped: readonly string[];
}

/**
 * Re-home every opening across a sequence of wall splits.
 *
 * Splits are applied in the order they happened, because a run of walls can cut
 * the same wall more than once and each later record refers to a part produced
 * by an earlier one.
 */
export function rehomeOpenings(
  openings: readonly Opening[],
  splits: readonly WallSplit[],
): RehomeResult {
  if (splits.length === 0) {
    return { openings, moved: [], dropped: [] };
  }

  let working = [...openings];
  const moved = new Set<string>();
  const dropped = new Set<string>();

  for (const split of splits) {
    const firstLength: Mm = split.t * split.originalLength;
    const secondLength: Mm = split.originalLength - firstLength;

    working = working.flatMap((opening) => {
      if (opening.wallId !== split.originalWallId) return [opening];

      // The half holding the opening's centre is the one it belongs to. An
      // opening straddling the cut has to go somewhere, and the side its middle
      // falls on is the least surprising answer.
      const onFirst = opening.offset <= firstLength;
      const wallId = onFirst ? split.parts[0] : split.parts[1];
      const partLength = onFirst ? firstLength : secondLength;
      const rawOffset = onFirst ? opening.offset : opening.offset - firstLength;

      if (opening.width > partLength) {
        dropped.add(opening.id);
        return [];
      }

      const offset = clampOffset(partLength, opening.width, rawOffset);
      if (offset !== Math.round(rawOffset)) moved.add(opening.id);

      return [{ ...opening, wallId, offset }];
    });
  }

  return {
    openings: working,
    moved: [...moved].filter((id) => !dropped.has(id)),
    dropped: [...dropped],
  };
}

/**
 * Move openings onto the wall that survived a merge.
 *
 * When two rooms are pushed together their facing walls become one, and
 * whichever of the two is left standing has to take the other's doors and
 * windows with it. That is not just a change of id: everything about an
 * opening is measured from its wall's `a` end, so if the survivor runs the
 * opposite way then the distance along it, the end the hinge is at, and the
 * side the leaf swings towards all have to turn round together. Change the
 * distance and forget the other two and the door ends up hinged on the wrong
 * side, opening into the room next door.
 */
export function rehomeMerged(
  openings: readonly Opening[],
  merges: readonly WallMerge[],
): RehomeResult {
  if (merges.length === 0) {
    return { openings, moved: [], dropped: [] };
  }

  let working = [...openings];
  const moved = new Set<string>();
  const dropped = new Set<string>();

  for (const merge of merges) {
    working = working.flatMap((opening) => {
      if (opening.wallId !== merge.fromWallId) return [opening];

      if (opening.width > merge.length) {
        dropped.add(opening.id);
        return [];
      }

      const raw = merge.reversed ? merge.length - opening.offset : opening.offset;
      const offset = clampOffset(merge.length, opening.width, raw);
      if (offset !== Math.round(raw)) moved.add(opening.id);

      const turned: Partial<Opening> = merge.reversed
        ? {
            hinge: opening.hinge === 'a' ? 'b' : 'a',
            side: opening.side === 'left' ? 'right' : 'left',
          }
        : {};

      return [{ ...opening, ...turned, wallId: merge.toWallId, offset }];
    });
  }

  return {
    openings: working,
    moved: [...moved].filter((id) => !dropped.has(id)),
    dropped: [...dropped],
  };
}
