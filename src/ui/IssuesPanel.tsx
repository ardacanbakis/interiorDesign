import { countBySeverity, issuesOf } from '../core/rules/engine.ts';
import { type Issue } from '../core/rules/types.ts';
import { activeFloor, useEditorStore } from '../state/store.ts';

/**
 * What is wrong with the plan.
 *
 * The panel that turns a drawing into a decision. Everything here is derived —
 * there is no "run the check" button, because a checker you have to remember to
 * run is one you find out about after the wardrobe has been delivered.
 *
 * Clicking a row selects the things it is about and lights the offending space
 * up on the plan, so a complaint is never a puzzle: you are looking at the
 * wardrobe, the bed and the 500mm of floor they are arguing over.
 */
export function IssuesPanel() {
  const floor = useEditorStore(activeFloor);
  const select = useEditorStore((state) => state.select);
  const focusIssue = useEditorStore((state) => state.focusIssue);
  const focused = useEditorStore((state) => state.focusedIssueId);

  if (!floor) return <Note>No floor selected.</Note>;

  const issues = issuesOf(floor);

  if (issues.length === 0) {
    return (
      <Note>
        {floor.items.length === 0
          ? 'Nothing to check yet. Add some furniture and this is where the problems will appear.'
          : 'Nothing wrong with this room. Every door opens, everything fits, and there is room to use it all.'}
      </Note>
    );
  }

  const { errors, warnings } = countBySeverity(issues);

  return (
    <div className="flex flex-col gap-2">
      <p
        className="text-[10px]"
        style={{ color: 'var(--text-muted)' }}
        data-testid="issues-summary"
      >
        {errors > 0 && (
          <strong style={{ color: 'var(--color-severity-error)' }}>
            {count(errors, 'problem')}
          </strong>
        )}
        {errors > 0 && warnings > 0 && ' · '}
        {warnings > 0 && (
          <span>{count(warnings, 'thing worth a look', 'things worth a look')}</span>
        )}
      </p>

      <ul className="flex flex-col gap-1">
        {issues.map((issue) => (
          <li key={issue.id}>
            <button
              type="button"
              data-testid={`issue-${issue.id}`}
              aria-pressed={focused === issue.id}
              onClick={() => {
                focusIssue(issue.id);
                select(issue.subjects.map((subject) => ({ kind: subject.kind, id: subject.id })));
              }}
              className="flex w-full flex-col gap-0.5 rounded border-l-2 px-2 py-1.5 text-left"
              style={{
                borderLeftColor: colourOf(issue),
                background:
                  focused === issue.id
                    ? 'color-mix(in oklab, var(--color-accent-500) 14%, transparent)'
                    : 'transparent',
              }}
            >
              <span className="text-[11px] font-medium" style={{ color: 'var(--text-primary)' }}>
                {issue.title}
              </span>
              <span className="text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}>
                {issue.detail}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-1 text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}>
        These are rules of thumb, not building regulations. Every figure they use is a default you
        can move.
      </p>
    </div>
  );
}

function colourOf(issue: Issue): string {
  return issue.severity === 'error'
    ? 'var(--color-severity-error)'
    : 'var(--color-severity-warning)';
}

function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
      {children}
    </p>
  );
}
