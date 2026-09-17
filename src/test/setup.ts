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
}
