/**
 * Two things in the same place.
 *
 * The check that has to be height-aware or it is useless. A rug under a table,
 * a shelf over a desk, a wall cupboard over a worktop and a television over a
 * TV stand all share floor plan, and none of them is a collision. Comparing
 * footprints alone would flag every one, and a checker that cries wolf four
 * times in a furnished room is a checker nobody leaves on.
 */

import { itemFootprint, itemHeightRange } from '../../catalog/placement.ts';
import { findDefinition } from '../../catalog/registry.ts';
import { heightsOverlap, overlapArea, polygonsOverlap } from '../../geometry/overlap.ts';
import { area } from '../../geometry/polygon.ts';
import { isFloorCovering } from '../blockers.ts';
import { issueId, type Issue, type Rule } from '../types.ts';

export const overlapRule: Rule = {
  id: 'overlap',
  label: 'Things in the same place',

  run: ({ floor, thresholds }) => {
    const issues: Issue[] = [];
    const items = floor.items.filter((item) => findDefinition(item.kind));

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const first = items[i]!;
        const second = items[j]!;

        // Something you walk on is not in anyone's way. Anything flat enough to
        // step onto is furniture's floor, not its neighbour.
        if (
          isFloorCovering(first, thresholds.stepOverHeight) ||
          isFloorCovering(second, thresholds.stepOverHeight)
        ) {
          continue;
        }

        if (!heightsOverlap(itemHeightRange(first), itemHeightRange(second))) continue;

        const a = itemFootprint(first);
        const b = itemFootprint(second);
        if (!polygonsOverlap(a, b)) continue;

        const shared = overlapArea(a, b);
        const smaller = Math.min(area(a), area(b));
        const fraction = smaller > 0 ? shared / smaller : 0;

        issues.push({
          id: issueId('overlap', first.id, second.id),
          rule: 'overlap',
          severity: 'error',
          title: `${first.label} and ${second.label} overlap`,
          detail:
            fraction > 0.6
              ? `The ${first.label.toLowerCase()} and the ${second.label.toLowerCase()} are in almost the same place. One of them has to move.`
              : `The ${first.label.toLowerCase()} and the ${second.label.toLowerCase()} run into each other by about ${Math.round(shared / 10_000) / 10} m², at a height where both are solid.`,
          subjects: [
            { kind: 'item', id: first.id },
            { kind: 'item', id: second.id },
          ],
          highlight: [a, b],
        });
      }
    }

    return issues;
  },
};
