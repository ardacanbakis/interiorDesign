import { useState } from 'react';

import { activeIssues, countBySeverity, mutedIssues } from '../core/rules/engine.ts';
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
 *
 * A warning can be put aside. Some of them are right about the geometry and
 * wrong about the room — the bedside table *is* within 700mm of the door, and
 * that is where it lives — and a checker that cannot be told "I know" is one
 * that gets switched off wholesale. Errors cannot: a door that will not open
 * is not something to agree to live with.
 */
export function IssuesPanel() {
  const floor = useEditorStore(activeFloor);
  const select = useEditorStore((state) => state.select);
  const focusIssue = useEditorStore((state) => state.focusIssue);
  const focused = useEditorStore((state) => state.focusedIssueId);
  const muteIssue = useEditorStore((state) => state.muteIssue);
  const unmuteIssue = useEditorStore((state) => state.unmuteIssue);

  const [showMuted, setShowMuted] = useState(false);

  if (!floor) return <Note>No floor selected.</Note>;

  const issues = activeIssues(floor);
  const muted = mutedIssues(floor);

  const focus = (issue: Issue) => {
    focusIssue(issue.id);
    select(issue.subjects.map((subject) => ({ kind: subject.kind, id: subject.id })));
  };

  if (issues.length === 0 && muted.length === 0) {
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
        {issues.length === 0 && 'Nothing left to look at.'}
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
            <IssueRow
              issue={issue}
              focused={focused === issue.id}
              onFocus={() => focus(issue)}
              {...(issue.severity === 'warning' ? { onMute: () => muteIssue(issue.id) } : {})}
            />
          </li>
        ))}
      </ul>

      {muted.length > 0 && (
        <div className="mt-1 flex flex-col gap-1">
          <button
            type="button"
            data-testid="toggle-muted"
            aria-expanded={showMuted}
            onClick={() => setShowMuted((open) => !open)}
            className="text-left text-[10px] underline"
            style={{ color: 'var(--text-muted)' }}
          >
            {count(muted.length, 'warning')} put aside — {showMuted ? 'hide' : 'show'}
          </button>

          {showMuted && (
            <ul className="flex flex-col gap-1" data-testid="muted-issues">
              {muted.map((issue) => (
                <li key={issue.id}>
                  <IssueRow
                    issue={issue}
                    focused={focused === issue.id}
                    muted
                    onFocus={() => focus(issue)}
                    onUnmute={() => unmuteIssue(issue.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="mt-1 text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}>
        These are rules of thumb, not building regulations. Every figure they use is a default you
        can move, and a warning you have looked at can be put aside.
      </p>
    </div>
  );
}

function IssueRow({
  issue,
  focused,
  muted = false,
  onFocus,
  onMute,
  onUnmute,
}: {
  issue: Issue;
  focused: boolean;
  muted?: boolean;
  onFocus: () => void;
  onMute?: () => void;
  onUnmute?: () => void;
}) {
  return (
    <div
      className="flex items-start gap-1 rounded border-l-2 pr-1"
      style={{
        borderLeftColor: muted ? 'var(--surface-border-strong)' : colourOf(issue),
        background: focused
          ? 'color-mix(in oklab, var(--color-accent-500) 14%, transparent)'
          : 'transparent',
        opacity: muted ? 0.7 : 1,
      }}
    >
      <button
        type="button"
        data-testid={`issue-${issue.id}`}
        aria-pressed={focused}
        onClick={onFocus}
        className="flex min-w-0 flex-1 flex-col gap-0.5 px-2 py-1.5 text-left"
      >
        <span className="text-[11px] font-medium" style={{ color: 'var(--text-primary)' }}>
          {issue.title}
        </span>
        <span className="text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}>
          {issue.detail}
        </span>
      </button>

      {onMute && (
        <SideButton label="Put this warning aside" testId={`mute-${issue.id}`} onClick={onMute}>
          Mute
        </SideButton>
      )}
      {onUnmute && (
        <SideButton
          label="Bring this warning back"
          testId={`unmute-${issue.id}`}
          onClick={onUnmute}
        >
          Unmute
        </SideButton>
      )}
    </div>
  );
}

/** The small action beside a row. Stops the click reaching the row itself. */
function SideButton({
  label,
  testId,
  onClick,
  children,
}: {
  label: string;
  testId: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testId}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="mt-1.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px]"
      style={{ borderColor: 'var(--surface-border-strong)', color: 'var(--text-secondary)' }}
    >
      {children}
    </button>
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
