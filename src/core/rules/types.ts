/**
 * What the checker says, and how it says it.
 *
 * A rule is a pure function from a floor to a list of issues. That is the whole
 * interface, and it is what makes this the most testable part of the project:
 * every rule can be given a room with two objects in it and asked what it
 * thinks, at exact numbers, with no editor involved.
 *
 * An issue is written to be *acted on*. It carries the ids of the things it is
 * about, so clicking it selects them, and a polygon, so the plan can show you
 * where the problem is rather than leaving you to find it.
 */

import { type Polygon } from '../geometry/polygon.ts';
import { type Floor } from '../model/schema.ts';
import { type DerivedRoom } from '../model/derive.ts';
import { type Thresholds } from './thresholds.ts';

/**
 * How much it matters.
 *
 * `error` means it does not work: a door that cannot open, two things in the
 * same place. `warning` means it works but you will not enjoy it. Nothing here
 * is illegal — these are not building regulations — so there is no third level
 * pretending otherwise.
 */
export type Severity = 'error' | 'warning';

export type IssueSubject =
  | { readonly kind: 'item'; readonly id: string }
  | { readonly kind: 'opening'; readonly id: string }
  | { readonly kind: 'room'; readonly id: string }
  | { readonly kind: 'wall'; readonly id: string };

export interface Issue {
  /**
   * Stable across edits that do not change the issue.
   *
   * The panel is re-derived on every keystroke, so an id built from the rule
   * and its subjects keeps a row in place while you drag the thing it is about
   * — rather than flickering out and back in as a new row.
   */
  readonly id: string;
  readonly rule: string;
  readonly severity: Severity;
  /** A few words, for the list. */
  readonly title: string;
  /** A sentence saying what is wrong and, where there is one, by how much. */
  readonly detail: string;
  readonly subjects: readonly IssueSubject[];
  /** Where to look. Drawn on the plan when the issue is selected. */
  readonly highlight: readonly Polygon[];
}

export interface RuleContext {
  readonly floor: Floor;
  readonly rooms: readonly DerivedRoom[];
  readonly thresholds: Thresholds;
}

export interface Rule {
  readonly id: string;
  /** Shown in the settings list, so it can be switched off. */
  readonly label: string;
  readonly run: (context: RuleContext) => Issue[];
}

/** Build an issue id from its parts, so two rules cannot collide. */
export function issueId(rule: string, ...parts: readonly string[]): string {
  return [rule, ...parts].join('/');
}

const ORDER: Record<Severity, number> = { error: 0, warning: 1 };

/** Worst first, then stable by id so the list does not shuffle as you work. */
export function bySeverity(a: Issue, b: Issue): number {
  return ORDER[a.severity] - ORDER[b.severity] || a.id.localeCompare(b.id);
}
