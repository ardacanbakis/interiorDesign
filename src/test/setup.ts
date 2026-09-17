/**
 * Global test setup.
 *
 * Guarded because most suites run in the `node` environment — the domain core
 * has no DOM — and Testing Library's cleanup would throw there.
 */
import { afterEach } from 'vitest';

if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => {
    cleanup();
  });

  // jsdom implements no layout, so it has no ResizeObserver. A stub that never
  // fires is the honest stand-in: component tests then see the zero size the
  // canvas starts at, which is a state it has to handle anyway. Anything that
  // depends on a real measured size belongs in the Playwright suite.
  if (!('ResizeObserver' in globalThis)) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
}
