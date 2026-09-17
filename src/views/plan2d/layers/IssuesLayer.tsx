import { memo } from 'react';

import { type Issue } from '../../../core/rules/types.ts';
import { polygonPath } from '../svgPath.ts';
import { screenPixels, type Viewport } from '../viewport.ts';

/**
 * Where the problem is.
 *
 * Only the issues you are looking at, never all of them. A furnished room can
 * easily carry a dozen warnings, and painting every clearance zone at once
 * turns the plan into a heat map of nothing in particular. Selecting a row in
 * the panel, or selecting the object itself, is what asks the question — so
 * that is when the answer is drawn.
 */
export const IssuesLayer = memo(function IssuesLayer({
  issues,
  viewport,
}: {
  issues: readonly Issue[];
  viewport: Viewport;
}) {
  if (issues.length === 0) return null;

  const stroke = screenPixels(viewport, 1.5);
  const dash = screenPixels(viewport, 6);

  return (
    <g pointerEvents="none" data-testid="issues-layer">
      {issues.map((issue) =>
        issue.highlight.map((shape, index) => {
          const colour =
            issue.severity === 'error'
              ? 'var(--color-severity-error)'
              : 'var(--color-severity-warning)';

          // A two-point highlight is a measurement between two things — the
          // viewing distance, a leg of the work triangle — not an area.
          if (shape.length < 3) {
            return (
              <path
                key={`${issue.id}-${index}`}
                d={polygonPath(shape)}
                fill="none"
                stroke={colour}
                strokeWidth={stroke}
                strokeDasharray={`${dash} ${dash}`}
              />
            );
          }

          return (
            <path
              key={`${issue.id}-${index}`}
              d={polygonPath(shape)}
              fill={colour}
              fillOpacity={0.16}
              stroke={colour}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${dash}`}
            />
          );
        }),
      )}
    </g>
  );
});
