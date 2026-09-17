/**
 * Running the checks.
 *
 * Every rule sees the same floor and returns issues; nothing here knows what
 * any of them do. Adding a check is adding a file to `rules/` and a line to the
 * list below.
 *
 * Pure and synchronous, deliberately. A furnished room has a few dozen objects
 * and the whole pass is well under a millisecond, so there is no scheduling, no
 * debounce and no stale-results problem — the panel simply derives from the
 * document like everything else.
 */

import { type Floor } from '../model/schema.ts';
import { roomsOf } from '../model/derive.ts';
import { clearanceRule } from './rules/clearance.ts';
import { containmentRule } from './rules/containment.ts';
import { kitchenRule } from './rules/kitchen.ts';
import { openingsRule } from './rules/openings.ts';
import { overlapRule } from './rules/overlap.ts';
import { viewingRule } from './rules/viewing.ts';
import { DEFAULT_THRESHOLDS, type Thresholds } from './thresholds.ts';
import { bySeverity, type Issue, type Rule } from './types.ts';

export const RULES: readonly Rule[] = [
  containmentRule,
  overlapRule,
  clearanceRule,
  openingsRule,
  kitchenRule,
  viewingRule,
];

export interface CheckOptions {
  readonly thresholds?: Thresholds;
  /** Rule ids to leave out. Everything runs by default. */
  readonly disabled?: ReadonlySet<string>;
}

/**
 * Everything wrong with a floor, worst first.
 *
 * A rule that throws is reported rather than allowed to take the panel down
 * with it: a checker is an aid, and one bad rule must not stop the other five
 * from telling you your door cannot open.
 */
export function checkFloor(floor: Floor, options: CheckOptions = {}): Issue[] {
  const context = {
    floor,
    rooms: roomsOf(floor),
    thresholds: options.thresholds ?? DEFAULT_THRESHOLDS,
  };

  const issues: Issue[] = [];

  for (const rule of RULES) {
    if (options.disabled?.has(rule.id)) continue;

    try {
      issues.push(...rule.run(context));
    } catch (error) {
      issues.push({
        id: `rule-failed/${rule.id}`,
        rule: rule.id,
        severity: 'warning',
        title: `The “${rule.label}” check could not run`,
        detail: error instanceof Error ? error.message : String(error),
        subjects: [],
        highlight: [],
      });
    }
  }

  return issues.sort(bySeverity);
}

const cache = new WeakMap<Floor, Issue[]>();

/**
 * The issues on a floor, computed once per version of it.
 *
 * Cached against the floor object itself, exactly as faces and room geometry
 * are: a floor is immutable and replaced wholesale on every edit, so a render
 * that changed nothing does no work and an edited floor cannot serve a stale
 * answer, because it is a different object. Without this the whole check would
 * run on every keystroke in the inspector.
 *
 * Only the default thresholds are cached. A custom set is rare and cheap
 * enough to recompute.
 */
export function issuesOf(floor: Floor): Issue[] {
  const cached = cache.get(floor);
  if (cached) return cached;

  const issues = checkFloor(floor);
  cache.set(floor, issues);
  return issues;
}

/** How many of each severity, for the panel's header. */
export function countBySeverity(issues: readonly Issue[]): { errors: number; warnings: number } {
  return {
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
  };
}

/** The issues mentioning a given thing, for highlighting a selection. */
export function issuesAbout(issues: readonly Issue[], kind: string, id: string): Issue[] {
  return issues.filter((issue) =>
    issue.subjects.some((subject) => subject.kind === kind && subject.id === id),
  );
}
