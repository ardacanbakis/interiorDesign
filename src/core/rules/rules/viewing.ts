/**
 * How far you sit from the television.
 *
 * The one rule here that is about comfort rather than about whether something
 * physically works, and the one most often got wrong: a 65" screen bought for a
 * room where the sofa is 2.2m away is a screen you sit too close to, and no
 * amount of moving it on the wall fixes that.
 *
 * Measured against the screen's *width* rather than its diagonal, because width
 * is what the catalogue stores and what a tape measure gives.
 */

import { distance } from '../../geometry/vec2.ts';
import { type Item } from '../../model/schema.ts';
import { issueId, type Issue, type Rule } from '../types.ts';

const SCREENS = new Set(['tv-wall']);
const SEATS = new Set(['sofa-2', 'sofa-3', 'sofa-corner', 'armchair']);

export const viewingRule: Rule = {
  id: 'viewing',
  label: 'Television viewing distance',

  run: ({ floor, thresholds }) => {
    const screens = floor.items.filter((item) => SCREENS.has(item.kind));
    const seats = floor.items.filter((item) => SEATS.has(item.kind));
    if (screens.length === 0 || seats.length === 0) return [];

    const issues: Issue[] = [];

    for (const screen of screens) {
      // The seat you would actually watch from is the nearest one.
      const nearest = seats.reduce((best, seat) =>
        gap(screen, seat) < gap(screen, best) ? seat : best,
      );

      const away = Math.round(gap(screen, nearest));
      const near = Math.round(screen.width * thresholds.tvDistanceMin);
      const far = Math.round(screen.width * thresholds.tvDistanceMax);

      if (away >= near && away <= far) continue;

      issues.push({
        id: issueId('viewing', screen.id, nearest.id),
        rule: 'viewing',
        severity: 'warning',
        title: away < near ? 'Sitting too close to the TV' : 'Sitting a long way from the TV',
        detail:
          away < near
            ? `The ${nearest.label.toLowerCase()} is ${metres(away)} from a ${Math.round(screen.width / 10)}cm screen. Comfortable is ${metres(near)} to ${metres(far)}.`
            : `The ${nearest.label.toLowerCase()} is ${metres(away)} from a ${Math.round(screen.width / 10)}cm screen — comfortable is ${metres(near)} to ${metres(far)}, so a bigger screen would suit the room.`,
        subjects: [
          { kind: 'item', id: screen.id },
          { kind: 'item', id: nearest.id },
        ],
        highlight: [
          [
            { x: screen.x, y: screen.y },
            { x: nearest.x, y: nearest.y },
          ],
        ],
      });
    }

    return issues;
  },
};

function gap(a: Item, b: Item): number {
  return distance({ x: a.x, y: a.y }, { x: b.x, y: b.y });
}

function metres(mm: number): string {
  return `${(Math.round(mm / 10) / 100).toFixed(2)}m`;
}
