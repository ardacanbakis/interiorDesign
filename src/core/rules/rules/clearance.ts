/**
 * Can you actually use it?
 *
 * One rule that covers about twenty checks, because the catalogue already
 * answers the hard part. Every object declares the space it needs to function —
 * a wardrobe's door swing, a WC's elbow room, the floor a drawer needs to come
 * out into — with a reason written for the person who will read it. All this
 * rule does is ask whether anything is standing in it.
 *
 * That is why `clearances()` was worth putting on the definition rather than
 * writing a rule per object: adding a piece of furniture brings its own
 * ergonomics with it, and this file never changes.
 */

import { placedClearances } from '../../catalog/placement.ts';
import { getDefinition } from '../../catalog/registry.ts';
import { itemsBlocking, wallsBlocking, zoneBand } from '../blockers.ts';
import { issueId, type Issue, type Rule } from '../types.ts';

export const clearanceRule: Rule = {
  id: 'clearance',
  label: 'Room to use things',

  run: ({ floor }) => {
    const issues: Issue[] = [];

    for (const item of floor.items) {
      // An item of a kind this build does not have cannot state its needs.
      let zones;
      try {
        getDefinition(item.kind);
        zones = placedClearances(item);
      } catch {
        continue;
      }

      for (const zone of zones) {
        const band = zoneBand(item, zone.minimumBlockingHeight);
        const blockers = itemsBlocking(zone.polygon, band, floor.items, new Set([item.id]));
        const walls = wallsBlocking(zone.polygon, floor.graph);

        if (blockers.length === 0 && walls.length === 0) continue;

        issues.push({
          id: issueId('clearance', item.id, zone.id),
          rule: 'clearance',
          severity: zone.severity,
          title: `${item.label}: ${zone.reason.toLowerCase()}`,
          detail: describe(
            zone.reason,
            blockers.map((one) => one.label),
            walls.length > 0,
          ),
          subjects: [
            { kind: 'item', id: item.id },
            ...blockers.map((one) => ({ kind: 'item', id: one.id }) as const),
          ],
          highlight: [zone.polygon],
        });
      }
    }

    return issues;
  },
};

/**
 * The sentence the panel shows.
 *
 * Names what is in the way, because "not enough room in front of the WC" sends
 * you looking and "the washing machine is in the way" tells you what to move.
 */
function describe(reason: string, blockers: readonly string[], wall: boolean): string {
  const names = [...new Set(blockers)];
  const parts: string[] = [];

  if (names.length === 1) parts.push(`the ${names[0]!.toLowerCase()} is in the way`);
  else if (names.length === 2) {
    parts.push(`the ${names[0]!.toLowerCase()} and the ${names[1]!.toLowerCase()} are in the way`);
  } else if (names.length > 2) {
    const last = names[names.length - 1]!.toLowerCase();
    parts.push(
      `${names
        .slice(0, -1)
        .map((name) => `the ${name.toLowerCase()}`)
        .join(', ')} and the ${last} are in the way`,
    );
  }

  if (wall) parts.push('it runs into a wall');

  return parts.length === 0 ? reason : `${reason}: ${parts.join(', and ')}.`;
}
