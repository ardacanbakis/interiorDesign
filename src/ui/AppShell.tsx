import type { ReactNode } from 'react';

/**
 * The application frame.
 *
 * Layout is a fixed toolbar, a three-column body (catalogue / plan / inspector)
 * and a status bar. The plan column is the only one that grows; the side panels
 * are fixed-width and collapsible so the drawing area is never squeezed.
 *
 * At this milestone the panels are placeholders — M2 fills the plan column,
 * M4 fills the catalogue and inspector, M5 fills the issues list.
 */
export function AppShell() {
  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--surface-app)' }}>
      <Toolbar />

      <div className="flex min-h-0 flex-1">
        <SidePanel side="left" title="Catalogue">
          <PlaceholderNote>
            Furniture, fixtures and openings will be listed here, grouped by category.
          </PlaceholderNote>
        </SidePanel>

        <main className="relative min-w-0 flex-1">
          <PlanPlaceholder />
        </main>

        <SidePanel side="right" title="Inspector">
          <PlaceholderNote>
            Every measurement of the selected object will be editable here.
          </PlaceholderNote>
        </SidePanel>
      </div>

      <StatusBar />
    </div>
  );
}

function Toolbar() {
  return (
    <header
      className="flex h-12 shrink-0 items-center gap-3 border-b px-3"
      style={{ background: 'var(--surface-panel)', borderColor: 'var(--surface-border)' }}
    >
      <div className="flex items-center gap-2">
        <Logo />
        <span className="text-sm font-semibold tracking-tight">interiorDesign</span>
      </div>

      <div className="h-5 w-px" style={{ background: 'var(--surface-border-strong)' }} />

      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Whole-house layout planner
      </span>
    </header>
  );
}

function SidePanel({
  side,
  title,
  children,
}: {
  side: 'left' | 'right';
  title: string;
  children: ReactNode;
}) {
  return (
    <aside
      className={`hidden w-64 shrink-0 flex-col overflow-y-auto md:flex ${
        side === 'left' ? 'border-r' : 'border-l'
      }`}
      style={{ background: 'var(--surface-panel)', borderColor: 'var(--surface-border)' }}
      aria-label={title}
    >
      <h2
        className="sticky top-0 border-b px-3 py-2 text-[11px] font-semibold tracking-wider uppercase"
        style={{
          background: 'var(--surface-panel)',
          borderColor: 'var(--surface-border)',
          color: 'var(--text-muted)',
        }}
      >
        {title}
      </h2>
      <div className="p-3">{children}</div>
    </aside>
  );
}

function PlaceholderNote({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
      {children}
    </p>
  );
}

function PlanPlaceholder() {
  return (
    <div
      className="grid h-full place-items-center"
      style={{ background: 'var(--plan-bg)' }}
      data-testid="plan-canvas-placeholder"
    >
      <div className="max-w-sm px-6 text-center">
        <p className="text-sm font-medium">Plan canvas</p>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Draw the building outline, then subdivide it into rooms. Walls between rooms are shared,
          so a door in one is a door in both.
        </p>
      </div>
    </div>
  );
}

function StatusBar() {
  return (
    <footer
      className="tabular flex h-7 shrink-0 items-center gap-4 border-t px-3 text-[11px]"
      style={{
        background: 'var(--surface-panel)',
        borderColor: 'var(--surface-border)',
        color: 'var(--text-muted)',
      }}
    >
      <span>Ready</span>
    </footer>
  );
}

function Logo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
      <rect
        x="1.5"
        y="1.5"
        width="15"
        height="15"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M1.5 10.5h7m0-9v15" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M11 6.5h3"
        stroke="var(--color-accent-500)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
