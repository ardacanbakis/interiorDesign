// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FormEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { LengthInput } from './LengthInput.tsx';

/**
 * The one place a measurement is typed.
 *
 * Its parsing is covered by the unit tests behind it; what is tested here is
 * the behaviour around the keyboard, which only exists in a DOM.
 */
describe('LengthInput — inside a form', () => {
  function Host({ onSubmit }: { onSubmit: (event: FormEvent) => void }) {
    const [value, setValue] = useState(3600);
    return (
      <form onSubmit={onSubmit}>
        <LengthInput label="Width" value={value} unit="cm" onChange={setValue} />
        <button type="submit">Create</button>
        <output>{value}</output>
      </form>
    );
  }

  it('does not submit the form when a number is finished with Enter', async () => {
    // Enter means "I have finished this number". Left to the browser it would
    // also submit the form, and that submit would run before React had
    // re-rendered with the committed value — creating a room the size the
    // field used to say rather than the size it now says.
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());

    const user = userEvent.setup();
    render(<Host onSubmit={onSubmit} />);

    const field = screen.getByLabelText('Width');
    await user.clear(field);
    await user.type(field, '500{Enter}');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('5000');
  });

  it('still commits the number Enter finished', async () => {
    const user = userEvent.setup();
    render(<Host onSubmit={(event) => event.preventDefault()} />);

    const field = screen.getByLabelText('Width');
    await user.clear(field);
    await user.type(field, '240{Enter}');

    expect(screen.getByRole('status')).toHaveTextContent('2400');
    // And the field shows the committed value rather than the draft.
    expect(field).toHaveValue('240');
  });

  it('commits on blur too, for anyone who tabs away', async () => {
    const user = userEvent.setup();
    render(<Host onSubmit={(event) => event.preventDefault()} />);

    const field = screen.getByLabelText('Width');
    await user.clear(field);
    await user.type(field, '180');
    await user.tab();

    expect(screen.getByRole('status')).toHaveTextContent('1800');
  });

  it('abandons the draft on Escape, leaving the number as it was', async () => {
    const user = userEvent.setup();
    render(<Host onSubmit={(event) => event.preventDefault()} />);

    const field = screen.getByLabelText('Width');
    await user.clear(field);
    await user.type(field, '999{Escape}');

    expect(screen.getByRole('status')).toHaveTextContent('3600');
    expect(field).toHaveValue('360');
  });
});
