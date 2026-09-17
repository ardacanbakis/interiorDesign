// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppShell } from './AppShell.tsx';

describe('AppShell', () => {
  it('renders the three-column frame', () => {
    render(<AppShell />);

    expect(screen.getByRole('complementary', { name: 'Catalogue' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeInTheDocument();
    expect(screen.getByTestId('plan-canvas-placeholder')).toBeInTheDocument();
  });
});
