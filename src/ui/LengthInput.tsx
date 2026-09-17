import { useId, useState } from 'react';

import {
  formatLength,
  parseLength,
  unitSuffix,
  type LengthUnit,
  type Mm,
} from '../core/units/length.ts';

export interface LengthInputProps {
  readonly label: string;
  readonly value: Mm;
  readonly unit: LengthUnit;
  readonly onChange: (value: Mm) => void;
  readonly min?: Mm;
  readonly max?: Mm;
  readonly disabled?: boolean;
  /** Extra context under the field, e.g. "walls take 50mm from each side". */
  readonly hint?: string;
}

/**
 * The one place a measurement is typed.
 *
 * Every dimension in the app goes through this, which is what makes the unit
 * handling consistent: it displays in whatever unit is current, accepts a bare
 * number in that unit or an explicit one (`2.4m`, `240cm`), and accepts a
 * decimal comma because that is how the numbers are written where this is being
 * used.
 *
 * Editing is committed on Enter or blur, never on every keystroke. Committing
 * as you type means the intermediate state of "24" while typing "2400" briefly
 * shrinks the wall to 24mm and lands on the undo stack, which is both alarming
 * and wrong.
 */
export function LengthInput({
  label,
  value,
  unit,
  onChange,
  min = 0,
  max = 1_000_000,
  disabled = false,
  hint,
}: LengthInputProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [lastValue, setLastValue] = useState(value);

  // Follow the model while not being typed into — a wall dragged on the canvas
  // has to update the number in the panel. Adjusted during render rather than
  // in an effect: React handles a setState here without an extra commit, so the
  // field never paints one frame showing the old number.
  if (lastValue !== value) {
    setLastValue(value);
    setDraft(null);
  }

  const text = draft ?? formatLength(value, unit);
  const parsed = draft === null ? value : parseLength(draft, unit);
  const invalid = parsed === null;
  const outOfRange = parsed !== null && (parsed < min || parsed > max);

  const commit = () => {
    if (draft === null) return;

    const next = parseLength(draft, unit);
    setDraft(null);
    if (next === null) return;

    const clamped = Math.min(max, Math.max(min, next));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </label>

      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={text}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            // The canvas listens for Escape and Delete; a field being typed into
            // must not also be steering the plan.
            event.stopPropagation();
            if (event.key === 'Enter') {
              commit();
              event.currentTarget.blur();
            }
            if (event.key === 'Escape') {
              setDraft(null);
              event.currentTarget.blur();
            }
          }}
          className="tabular w-full rounded border py-1 pr-8 pl-2 text-xs"
          style={{
            background: 'var(--surface-raised)',
            color: 'var(--text-primary)',
            borderColor:
              invalid || outOfRange
                ? 'var(--color-severity-error)'
                : 'var(--surface-border-strong)',
            opacity: disabled ? 0.5 : 1,
          }}
          aria-invalid={invalid || outOfRange}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px]"
          style={{ color: 'var(--text-muted)' }}
        >
          {unitSuffix(unit)}
        </span>
      </div>

      {hint && (
        <p className="text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </p>
      )}
    </div>
  );
}
