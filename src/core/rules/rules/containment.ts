/**
 * Is it in the room at all?
 *
 * Catches the two ways furniture ends up somewhere it cannot be: pushed through
 * a wall, and dragged out of the room entirely. Both look plausible enough on
 * screen at a low zoom, and both make every other number on the plan wrong.
 *
 * Furniture is *meant* to touch walls, so the test is containment within the
 * room's usable floor — the inner faces — with touching allowed. A wardrobe
 * flat against the wall is exactly right; a wardrobe 20mm into it is not.
 */

import { itemFootprint } from '../../catalog/placement.ts';
import { findDefinition } from '../../catalog/registry.ts';
import { polygonInside, polygonsOverlap } from '../../geometry/overlap.ts';
import { issueId, type Issue, type Rule } from '../types.ts';

export const containmentRule: Rule = {
  id: 'containment',
  label: 'Objects inside their room',

  run: ({ floor, rooms }) => {
    if (rooms.length === 0) return [];

    const issues: Issue[] = [];

    for (const item of floor.items) {
      if (!findDefinition(item.kind)) continue;

      const footprint = itemFootprint(item);
      if (rooms.some((room) => polygonInside(footprint, room.geometry.outline))) continue;

      // Which room it mostly belongs to, so the message can name it.
      const host = rooms.find((room) => polygonsOverlap(footprint, room.geometry.outline));

      issues.push({
        id: issueId('containment', item.id),
        rule: 'containment',
        severity: 'error',
        title: `${item.label} does not fit where it is`,
        detail: host
          ? `The ${item.label.toLowerCase()} sticks out of ${host.props.name} — into a wall, or past the end of the room.`
          : `The ${item.label.toLowerCase()} is not inside any room.`,
        subjects: [
          { kind: 'item', id: item.id },
          ...(host ? [{ kind: 'room', id: host.props.id } as const] : []),
        ],
        highlight: [footprint],
      });
    }

    return issues;
  },
};
