import { useId, useRef, useState, type ReactNode } from 'react';

/**
 * What a toolbar button does, and the key that does it faster.
 *
 * The browser's own `title` attribute technically shows the same text, but it
 * waits about a second, renders in the operating system's styling rather than
 * the app's, and cannot show a keystroke as a keystroke. Shortcuts learned from
 * a tooltip are the main way anyone picks them up, so it is worth the fifty
 * lines to make them legible.
 *
 * Shown on focus as well as hover: someone tabbing through the toolbar is
 * exactly the person most likely to want the keyboard shortcut.
 */
export function Tooltip({
  label,
  shortcut,
  children,
}: {
  label: string;
  /** A key, or a combination like `Ctrl+Shift+Z`. */
  readonly shortcut?: string | undefined;
  children: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A short delay, so sweeping the pointer across the toolbar does not leave a
  // trail of tooltips flashing on and off behind it.
  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), 350);
  };

  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  };

  return (
    <span
      className="relative inline-flex"
      onPointerEnter={show}
      onPointerLeave={hide}
      // Clicking has answered the question; a tooltip left hanging over the
      // thing you just pressed is only in the way.
      onPointerDown={hide}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={hide}
    >
      <span aria-describedby={open ? id : undefined} className="inline-flex">
        {children}
      </span>

      {open && (
        <span
          role="tooltip"
          id={id}
          data-testid="tooltip"
          className="pointer-events-none absolute top-full left-1/2 z-50 mt-1.5 flex -translate-x-1/2 items-center gap-1.5 rounded border px-2 py-1 text-[11px] whitespace-nowrap shadow-sm"
          style={{
            background: 'var(--surface-raised)',
            borderColor: 'var(--surface-border-strong)',
            color: 'var(--text-primary)',
          }}
        >
          {label}
          {shortcut && <Keys combination={shortcut} />}
        </span>
      )}
    </span>
  );
}

/** A shortcut, drawn as the keys you actually press. */
function Keys({ combination }: { combination: string }) {
  return (
    <span className="flex items-center gap-0.5">
      {combination.split('+').map((key, index) => (
        <kbd
          key={index}
          className="tabular rounded border px-1 text-[10px] leading-4"
          style={{
            background: 'var(--surface-panel)',
            borderColor: 'var(--surface-border-strong)',
            color: 'var(--text-secondary)',
          }}
        >
          {displayKey(key)}
        </kbd>
      ))}
    </span>
  );
}

/**
 * The key as it is printed on the keyboard in front of you.
 *
 * The shortcut handler accepts either modifier — `event.metaKey || ctrlKey` —
 * so a Mac really is ⌘ and showing "Ctrl" there would be telling someone to
 * press a key that does nothing on their machine.
 */
function displayKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.toLowerCase() === 'ctrl') return isApple() ? '⌘' : 'Ctrl';
  if (trimmed.toLowerCase() === 'shift') return isApple() ? '⇧' : 'Shift';
  return trimmed;
}

function isApple(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad/.test(navigator.userAgent);
}
