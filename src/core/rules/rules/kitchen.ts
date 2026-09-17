/**
 * The kitchen work triangle.
 *
 * Sink, hob and fridge: the three places you move between while cooking. The
 * rule of thumb is that the three legs together should come to between about
 * 3.6m and 8m — under that and two people cannot both be in there, over it and
 * you are walking the room to make a cup of tea.
 *
 * Unlike the clearance checks, this one is advice rather than geometry, so it
 * is always a warning and it always shows its working.
 */

import { distance } from '../../geometry/vec2.ts';
import { type Item } from '../../model/schema.ts';
import { issueId, type Issue, type Rule } from '../types.ts';

const SINK = 'sink';
const HOB = 'hob';
const FRIDGE = 'fridge';

export const kitchenRule: Rule = {
  id: 'kitchen',
  label: 'Kitchen work triangle',

  run: ({ floor, rooms, thresholds }) => {
    const kitchens = rooms.filter((room) => room.props.type === 'kitchen');
    if (kitchens.length === 0) return [];

    const issues: Issue[] = [];

    for (const kitchen of kitchens) {
      const inside = floor.items.filter((item) => within(item, kitchen.geometry.outline));

      const sink = inside.find((item) => item.kind === SINK);
      const hob = inside.find((item) => item.kind === HOB);
      const fridge = inside.find((item) => item.kind === FRIDGE);

      // Not a complaint: a kitchen half laid out has not gone wrong yet.
      if (!sink || !hob || !fridge) continue;

      const legs = [
        distance(centre(sink), centre(hob)),
        distance(centre(hob), centre(fridge)),
        distance(centre(fridge), centre(sink)),
      ];
      const total = Math.round(legs.reduce((sum, leg) => sum + leg, 0));

      if (total >= thresholds.kitchenTriangleMin && total <= thresholds.kitchenTriangleMax) {
        continue;
      }

      const cramped = total < thresholds.kitchenTriangleMin;

      issues.push({
        id: issueId('kitchen', kitchen.props.id, 'triangle'),
        rule: 'kitchen',
        severity: 'warning',
        title: cramped ? 'Kitchen is cramped to work in' : 'Kitchen is spread too far apart',
        detail: cramped
          ? `Sink, hob and fridge come to ${metres(total)} between them, under the ${metres(thresholds.kitchenTriangleMin)} that leaves room to work — and to get past whoever is cooking.`
          : `Sink, hob and fridge come to ${metres(total)} between them, over the ${metres(thresholds.kitchenTriangleMax)} where cooking turns into walking.`,
        subjects: [
          { kind: 'room', id: kitchen.props.id },
          { kind: 'item', id: sink.id },
          { kind: 'item', id: hob.id },
          { kind: 'item', id: fridge.id },
        ],
        highlight: [[centre(sink), centre(hob), centre(fridge)]],
      });
    }

    return issues;
  },
};

function centre(item: Item) {
  return { x: item.x, y: item.y };
}

function within(item: Item, outline: readonly { x: number; y: number }[]): boolean {
  // Centre-in-room is enough here: the triangle is about where things roughly
  // are, not about millimetres.
  let inside = false;
  const point = centre(item);

  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i]!;
    const b = outline[j]!;
    const straddles = a.y > point.y !== b.y > point.y;
    if (straddles && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function metres(mm: number): string {
  return `${(Math.round(mm / 10) / 100).toFixed(2)}m`;
}
