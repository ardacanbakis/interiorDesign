/**
 * Doors and windows.
 *
 * Openings are not items, so they carry no `clearances()` of their own and need
 * their own rule. Three things are checked, and the first is the one this whole
 * project was started over: a door that cannot open.
 *
 * The swing sector is the **full** quarter circle regardless of how far the
 * door is currently drawn open. A shut door still needs the room to open, so
 * checking only the swept part would give a plan a clean bill of health right
 * up until somebody tried to walk through it.
 */

import { add, negate, scale, type Vec2 } from '../../geometry/vec2.ts';
import { type Polygon } from '../../geometry/polygon.ts';
import { doorSwing, openingFrame } from '../../openings/geometry.ts';
import { itemsBlocking } from '../blockers.ts';
import { issueId, type Issue, type Rule } from '../types.ts';

export const openingsRule: Rule = {
  id: 'openings',
  label: 'Doors and windows',

  run: ({ floor, thresholds }) => {
    const issues: Issue[] = [];

    for (const opening of floor.openings) {
      const wall = floor.graph.walls[opening.wallId];
      if (!wall) continue;

      const frame = openingFrame(floor.graph, wall, opening);

      if (opening.kind === 'door') {
        const swing = doorSwing(floor.graph, wall, opening);

        // From the floor to the top of the door: a leaf sweeps its whole height,
        // so a wall shelf at 1600 is as much of an obstruction as a chest is.
        const blockers = itemsBlocking(
          swing.sector,
          { bottom: 0, top: opening.height },
          floor.items,
        );

        if (blockers.length > 0) {
          issues.push({
            id: issueId('openings', opening.id, 'swing'),
            rule: 'openings',
            severity: 'error',
            title: `${opening.label} cannot open`,
            detail: `${list(blockers.map((one) => one.label))} in the way of the door's swing. It needs the whole quarter circle, whether or not it is standing open now.`,
            subjects: [
              { kind: 'opening', id: opening.id },
              ...blockers.map((one) => ({ kind: 'item', id: one.id }) as const),
            ],
            highlight: [swing.sector],
          });
        }

        // Somewhere to stand on each side while using it. Both sides matter:
        // a door you can open into a wardrobe is no better than one you cannot.
        for (const side of [1, -1] as const) {
          const landing = approach(
            frame.centre,
            frame.across,
            side,
            opening.width,
            thresholds.doorLanding,
          );
          const standing = itemsBlocking(landing, { bottom: 0, top: opening.height }, floor.items);
          if (standing.length === 0) continue;

          issues.push({
            id: issueId('openings', opening.id, `landing-${side}`),
            rule: 'openings',
            severity: 'warning',
            title: `${opening.label} is awkward to get through`,
            detail: `${list(standing.map((one) => one.label))} within ${thresholds.doorLanding}mm of the doorway, so there is nowhere to stand while opening it.`,
            subjects: [
              { kind: 'opening', id: opening.id },
              ...standing.map((one) => ({ kind: 'item', id: one.id }) as const),
            ],
            highlight: [landing],
          });
        }

        continue;
      }

      // A window: anything taller than the sill in front of it takes the light
      // and the view, which is the entire reason the window is there.
      for (const side of [1, -1] as const) {
        const approachZone = approach(
          frame.centre,
          frame.across,
          side,
          opening.width,
          thresholds.windowApproach,
        );
        const blockers = itemsBlocking(
          approachZone,
          { bottom: opening.sillHeight, top: opening.sillHeight + opening.height },
          floor.items,
        );
        if (blockers.length === 0) continue;

        issues.push({
          id: issueId('openings', opening.id, `blocked-${side}`),
          rule: 'openings',
          severity: 'warning',
          title: `${opening.label} is blocked`,
          detail: `${list(blockers.map((one) => one.label))} standing in front of the window, above its ${opening.sillHeight}mm sill.`,
          subjects: [
            { kind: 'opening', id: opening.id },
            ...blockers.map((one) => ({ kind: 'item', id: one.id }) as const),
          ],
          highlight: [approachZone],
        });
      }
    }

    return issues;
  },
};

/** The rectangle of floor in front of an opening, on one side of its wall. */
function approach(centre: Vec2, across: Vec2, side: 1 | -1, width: number, depth: number): Polygon {
  const out = scale(across, side);
  const alongHalf = { x: -out.y * (width / 2), y: out.x * (width / 2) };
  const near = add(centre, scale(out, 1));
  const far = add(centre, scale(out, depth));

  return [
    add(near, negate(alongHalf)),
    add(far, negate(alongHalf)),
    add(far, alongHalf),
    add(near, alongHalf),
  ];
}

/** "The bed is" / "The bed and the wardrobe are", for a readable sentence. */
function list(labels: readonly string[]): string {
  const names = [...new Set(labels)].map((label) => `the ${label.toLowerCase()}`);
  if (names.length === 1) return `${capitalise(names[0]!)} is`;
  const last = names[names.length - 1]!;
  return `${capitalise(names.slice(0, -1).join(', '))} and ${last} are`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
