// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { graphFromSegments, rectangleSegments } from '../core/graph/wallGraph.ts';
import { useEditorStore } from '../state/store.ts';
import { AppShell } from './AppShell.tsx';

/**
 * Put a 6m x 3m shell on the active floor.
 *
 * Wrapped in `act` because the store is driven directly rather than through the
 * UI; without it React has not re-rendered by the time the assertions run.
 */
function drawShell() {
  act(() => {
    useEditorStore.getState().commit('Draw shell', (draft) => {
      draft.floors[0]!.graph = graphFromSegments(rectangleSegments(0, 0, 6000, 3000, 'exterior'));
    });
  });
}

/** Select something directly, for cases where clicking the SVG is not the point. */
function selectTarget(target: Parameters<ReturnType<typeof useEditorStore.getState>['select']>[0]) {
  act(() => {
    useEditorStore.getState().select(target);
  });
}

beforeEach(() => {
  useEditorStore.getState().newDocument();
});

describe('AppShell', () => {
  it('renders the three-column frame', () => {
    render(<AppShell />);

    expect(screen.getByRole('complementary', { name: 'Rooms' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeInTheDocument();
    expect(screen.getByTestId('plan-canvas')).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Drawing tools' })).toBeInTheDocument();
  });

  it('opens straight onto the new-room form when the plan is empty', () => {
    // Typing the measurements is the point, so an empty plan should not greet
    // you with an instruction to go and draw something.
    render(<AppShell />);

    expect(screen.getByTestId('new-room-panel')).toBeInTheDocument();
    expect(screen.getByTestId('room-count')).toHaveTextContent('0 rooms');
  });

  it('lists rooms as soon as walls enclose one', () => {
    drawShell();
    render(<AppShell />);

    expect(screen.getByText('Room 1')).toBeInTheDocument();
    expect(screen.getByTestId('room-count')).toHaveTextContent('1 room');
    // 6m x 3m centrelines with 250mm exterior walls: 5.75 x 2.75 = 15.81 m².
    expect(screen.getByTestId('floor-area')).toHaveTextContent('15.81 m²');
  });

  it('reports the same area in the room list, on the plan, and in the status bar', () => {
    // Three numbers for one room is three chances to disagree. The list used to
    // show `lastArea`, which caches the centreline area and is a different —
    // larger — number than the floor inside the walls.
    drawShell();
    render(<AppShell />);

    const list = within(screen.getByRole('complementary', { name: 'Rooms' }));
    expect(list.getByText('15.81 m²')).toBeInTheDocument();
    expect(screen.getByTestId('floor-area')).toHaveTextContent('15.81 m²');
  });

  it('reports the save state', () => {
    render(<AppShell saveState="saving" />);
    expect(screen.getByTestId('save-state')).toHaveTextContent('Saving…');

    render(<AppShell saveState="error" />);
    expect(screen.getAllByTestId('save-state').at(-1)).toHaveTextContent('Could not save');
  });

  it('warns plainly when nothing can be stored', () => {
    render(<AppShell persistent={false} />);

    expect(screen.getByRole('status')).toHaveTextContent(/will be lost when you close the tab/i);
  });

  it('does not warn when storage is working', () => {
    render(<AppShell />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('AppShell — tools', () => {
  it('switches the active tool', async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    expect(screen.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByTestId('tool-draw-room'));

    expect(useEditorStore.getState().tool).toBe('draw-room');
    expect(screen.getByTestId('tool-draw-room')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'false');
  });

  it('disables undo until there is something to undo', async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    expect(screen.getByTestId('undo')).toBeDisabled();

    drawShell();
    expect(screen.getByTestId('undo')).toBeEnabled();

    await user.click(screen.getByTestId('undo'));

    expect(screen.getByTestId('room-count')).toHaveTextContent('0 rooms');
    expect(screen.getByTestId('redo')).toBeEnabled();
  });

  it('names what undo would undo, so the button is not a guess', () => {
    drawShell();
    render(<AppShell />);

    expect(screen.getByTestId('undo')).toHaveAttribute('aria-label', 'Undo draw shell');
  });
});

describe('AppShell — creating a room from measurements', () => {
  it('builds a room whose floor is exactly the size typed', async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    await user.clear(screen.getByLabelText('Width'));
    await user.type(screen.getByLabelText('Width'), '360');
    await user.clear(screen.getByLabelText('Depth'));
    await user.type(screen.getByLabelText('Depth'), '420');
    await user.clear(screen.getByLabelText('Wall'));
    await user.type(screen.getByLabelText('Wall'), '10');

    // 3.6m x 4.2m = 15.12 m², and the form says so before committing.
    expect(screen.getByTestId('new-room-preview')).toHaveTextContent('15.12 m²');

    await user.type(screen.getByTestId('new-room-name'), 'Yatak Odası');
    await user.click(screen.getByTestId('create-room'));

    expect(screen.getByTestId('room-count')).toHaveTextContent('1 room');
    // The promise the form makes: the floor measures what was typed, not that
    // minus a wall.
    expect(screen.getByTestId('floor-area')).toHaveTextContent('15.12 m²');
    expect(screen.getByText('Yatak Odası')).toBeInTheDocument();
  });

  it('falls back to the room type for a name left blank', async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    await user.selectOptions(screen.getByTestId('new-room-type'), 'kitchen');
    await user.click(screen.getByTestId('create-room'));

    expect(screen.getByText('Kitchen')).toBeInTheDocument();
    expect(useEditorStore.getState().document.floors[0]!.rooms[0]!.type).toBe('kitchen');
  });

  it('sets the floor’s ceiling height', async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    await user.clear(screen.getByLabelText('Ceiling'));
    await user.type(screen.getByLabelText('Ceiling'), '290');
    await user.click(screen.getByTestId('create-room'));

    expect(useEditorStore.getState().document.floors[0]!.ceilingHeight).toBe(2900);
  });

  it('is a single undo step, name included', async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    await user.type(screen.getByTestId('new-room-name'), 'Salon');
    await user.click(screen.getByTestId('create-room'));
    expect(screen.getByTestId('room-count')).toHaveTextContent('1 room');

    // Adding a room and naming it is one action to whoever did it.
    await user.click(screen.getByTestId('undo'));
    expect(screen.getByTestId('room-count')).toHaveTextContent('0 rooms');
    expect(useEditorStore.getState().canUndo()).toBe(false);
  });

  it('selects the new room so the inspector is already on it', async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    await user.type(screen.getByTestId('new-room-name'), 'Salon');
    await user.click(screen.getByTestId('create-room'));

    const selection = useEditorStore.getState().selection;
    expect(selection).toHaveLength(1);
    expect(selection[0]!.kind).toBe('room');
    expect(screen.getByTestId('room-name')).toHaveValue('Salon');
  });

  it('adds a second room clear of the first rather than on top of it', async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    await user.type(screen.getByTestId('new-room-name'), 'Salon');
    await user.click(screen.getByTestId('create-room'));

    await user.click(screen.getByTestId('add-room'));
    await user.type(screen.getByTestId('new-room-name'), 'Mutfak');
    await user.click(screen.getByTestId('create-room'));

    expect(screen.getByTestId('room-count')).toHaveTextContent('2 rooms');
    // Two separate rooms, each still measuring what was asked for — the same
    // document simply grew, which is what makes the house case free.
    expect(screen.getByText('Salon')).toBeInTheDocument();
    expect(screen.getByText('Mutfak')).toBeInTheDocument();
  });
});

describe('AppShell — inspector', () => {
  it('prompts when nothing is selected', () => {
    drawShell();
    useEditorStore.getState().select([]);
    render(<AppShell />);

    expect(screen.getByText(/Nothing selected/)).toBeInTheDocument();
  });

  it('edits a room’s name and type', async () => {
    const user = userEvent.setup();
    drawShell();
    render(<AppShell />);

    await user.click(screen.getByText('Room 1'));

    const name = screen.getByTestId('room-name');
    await user.clear(name);
    await user.type(name, 'Salon');

    expect(useEditorStore.getState().document.floors[0]!.rooms[0]!.name).toBe('Salon');

    await user.selectOptions(screen.getByTestId('room-type'), 'living');
    expect(useEditorStore.getState().document.floors[0]!.rooms[0]!.type).toBe('living');
  });

  it('shows a room’s measurements taken inside the walls', async () => {
    const user = userEvent.setup();
    drawShell();
    render(<AppShell />);

    await user.click(screen.getByText('Room 1'));

    // Scoped to the panel: the same area is also in the status bar.
    const inspector = within(screen.getByRole('complementary', { name: 'Inspector' }));
    expect(inspector.getByText('15.81 m²')).toBeInTheDocument();
    // 5750 x 2750 of floor, shown in centimetres.
    expect(inspector.getByText('575 cm')).toBeInTheDocument();
    expect(inspector.getByText('275 cm')).toBeInTheDocument();
  });

  it('edits a wall’s thickness, and the rooms either side shrink', async () => {
    const user = userEvent.setup();
    drawShell();
    render(<AppShell />);

    const wallId = Object.keys(useEditorStore.getState().document.floors[0]!.graph.walls)[0]!;
    selectTarget([{ kind: 'wall', id: wallId }]);

    const thickness = await screen.findByLabelText('Thickness');
    expect(thickness).toHaveValue('25');

    await user.clear(thickness);
    await user.type(thickness, '40{Enter}');

    expect(useEditorStore.getState().document.floors[0]!.graph.walls[wallId]!.thickness).toBe(400);
    // A thicker wall eats into the floor it encloses.
    expect(screen.getByTestId('floor-area')).not.toHaveTextContent('15.81 m²');
  });

  it('deletes a wall, and the room stops being a room', async () => {
    const user = userEvent.setup();
    drawShell();
    render(<AppShell />);

    const wallId = Object.keys(useEditorStore.getState().document.floors[0]!.graph.walls)[0]!;
    selectTarget([{ kind: 'wall', id: wallId }]);

    await user.click(await screen.findByTestId('delete-wall'));

    expect(screen.getByTestId('room-count')).toHaveTextContent('0 rooms');
  });
});
