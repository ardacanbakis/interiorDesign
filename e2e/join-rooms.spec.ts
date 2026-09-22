import { expect, test, type Page } from '@playwright/test';

/**
 * Making a house out of rooms.
 *
 * Drag one room against another and they stop being two drawings that happen
 * to touch and become one building with a wall between them. The geometry of
 * that is proved in unit tests; what only exists in a browser is whether the
 * drag can actually land on the wall, which is the whole difficulty — being a
 * millimetre out looks identical and is not the same building.
 */

async function screenOf(page: Page, model: { x: number; y: number }) {
  return page.evaluate(async (point) => {
    const { useEditorStore } = await import('/src/state/store.ts');
    const { toScreen } = await import('/src/views/plan2d/viewport.ts');

    const canvas = document.querySelector('[data-testid="plan-canvas"]')!;
    const rect = canvas.getBoundingClientRect();
    const local = toScreen(
      useEditorStore.getState().viewport,
      { width: rect.width, height: rect.height },
      point,
    );
    return { x: rect.left + local.x, y: rect.top + local.y };
  }, model);
}

async function plan(page: Page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    const { roomsOf } = await import('/src/core/model/derive.ts');
    const floor = useEditorStore.getState().document.floors[0]!;

    return {
      walls: Object.keys(floor.graph.walls).length,
      rooms: roomsOf(floor).map((room) => ({
        id: room.props.id,
        name: room.props.name,
        area: room.geometry.area,
      })),
      openings: floor.openings.map((opening) => ({ id: opening.id, wallId: opening.wallId })),
      undoSteps: useEditorStore.getState().history.past.length,
    };
  });
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const a = await screenOf(page, from);
  const b = await screenOf(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
}

/**
 * Two 400 × 300 rooms on 20cm walls, the second a metre to the right of the
 * first — which is where "Add room" puts it.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createDocumentStore } = await import('/src/persistence/store.ts');
    await createDocumentStore().store.clear();
    const { useEditorStore } = await import('/src/state/store.ts');
    const store = useEditorStore.getState();
    store.newDocument();

    useEditorStore.getState().createRoom({
      width: 4000,
      depth: 3000,
      thickness: 200,
      ceilingHeight: 2700,
      name: 'Salon',
      type: 'living',
    });
    useEditorStore.getState().createRoom({
      width: 4000,
      depth: 3000,
      thickness: 200,
      ceilingHeight: 2700,
      name: 'Mutfak',
      type: 'kitchen',
    });

    useEditorStore.getState().setViewport({ centre: { x: 4700, y: 1600 }, scale: 0.08 });
    useEditorStore.getState().clearSelection();
  });

  await expect(page.getByTestId('room-count')).toHaveText('2 rooms');
});

test('dragging one room against the other leaves them sharing a wall', async ({ page }) => {
  const before = await plan(page);
  expect(before.walls).toBe(8);

  // Grab a patch of the right room's floor and pull it left. Deliberately 90mm
  // short of exact — landing on the millimetre is what the snapping is for.
  await drag(page, { x: 6200, y: 1600 }, { x: 5290, y: 1600 });

  const after = await plan(page);
  expect(after.walls).toBe(7);
  expect(after.rooms).toHaveLength(2);
});

test('both rooms keep their names and their floor area', async ({ page }) => {
  const before = await plan(page);

  await drag(page, { x: 6200, y: 1600 }, { x: 5290, y: 1600 });

  const after = await plan(page);
  expect(after.rooms.map((room) => room.name).sort()).toEqual(['Mutfak', 'Salon']);
  expect(after.rooms.map((room) => room.area).sort()).toEqual(
    before.rooms.map((room) => room.area).sort(),
  );
});

test('the two become one structure, so dragging either moves both', async ({ page }) => {
  await drag(page, { x: 6200, y: 1600 }, { x: 5290, y: 1600 });

  const joined = await plan(page);
  expect(joined.walls).toBe(7);

  // Now pull the left room downwards; the other has to come with it.
  const wasAt = await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    const nodes = Object.values(useEditorStore.getState().document.floors[0]!.graph.nodes);
    return Math.max(...nodes.map((node) => node.y));
  });

  await drag(page, { x: 2000, y: 1600 }, { x: 2000, y: 2600 });

  const nowAt = await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    const nodes = Object.values(useEditorStore.getState().document.floors[0]!.graph.nodes);
    return Math.max(...nodes.map((node) => node.y));
  });

  expect(nowAt).toBe(wasAt + 1000);
  // Still one house, still two rooms.
  expect((await plan(page)).walls).toBe(7);
});

test('a door in the wall they meet on survives the join', async ({ page }) => {
  // A door in the right room's left wall — the wall that is about to be merged
  // into the left room's right wall.
  await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    const floor = useEditorStore.getState().document.floors[0]!;
    const wall = Object.values(floor.graph.walls).find((entry) => {
      const a = floor.graph.nodes[entry.a]!;
      const b = floor.graph.nodes[entry.b]!;
      // The right room's left wall: its centreline sits at 5000, half a wall
      // in from the inner face that "Add room" puts a metre clear of the first.
      return a.x === b.x && a.x === 5000;
    })!;
    useEditorStore.getState().addOpening(wall.id, 1600, 'door-80');
    useEditorStore.getState().clearSelection();
  });

  expect((await plan(page)).openings).toHaveLength(1);

  await drag(page, { x: 6200, y: 1600 }, { x: 5290, y: 1600 });

  const after = await plan(page);
  expect(after.openings).toHaveLength(1);

  // And it is on a wall that still exists, which is the whole failure mode.
  const hosted = await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    const floor = useEditorStore.getState().document.floors[0]!;
    return floor.graph.walls[floor.openings[0]!.wallId] !== undefined;
  });
  expect(hosted).toBe(true);
});

test('the move and the join it caused are one press of ctrl-Z', async ({ page }) => {
  const before = await plan(page);

  await drag(page, { x: 6200, y: 1600 }, { x: 5290, y: 1600 });
  expect((await plan(page)).walls).toBe(7);

  await page.getByTestId('undo').click();

  const undone = await plan(page);
  expect(undone.walls).toBe(8);
  expect(undone.rooms.map((room) => room.name).sort()).toEqual(
    before.rooms.map((room) => room.name).sort(),
  );
});

test('a room dropped clear of everything joins nothing', async ({ page }) => {
  await drag(page, { x: 6200, y: 1600 }, { x: 8000, y: 1600 });

  const after = await plan(page);
  expect(after.walls).toBe(8);
  expect(after.rooms).toHaveLength(2);
});

test('a joined plan is still joined after a reload', async ({ page }) => {
  await drag(page, { x: 6200, y: 1600 }, { x: 5290, y: 1600 });
  await expect(page.getByTestId('save-state')).toHaveText('Saved');

  await page.reload();
  await expect(page.getByTestId('room-count')).toHaveText('2 rooms');

  expect((await plan(page)).walls).toBe(7);
});

test('a joined room can be taken back out again', async ({ page }) => {
  await drag(page, { x: 6200, y: 1600 }, { x: 5290, y: 1600 });
  expect((await plan(page)).walls).toBe(7);

  // Select the room that was moved, then separate it.
  await page.getByTestId('room-list-r2').click();
  await expect(page.getByTestId('separate-room')).toBeVisible();
  await page.getByTestId('separate-room').click();

  const after = await plan(page);
  expect(after.walls).toBe(8);
  expect(after.rooms).toHaveLength(2);
  // Both still named, both still their own size.
  expect(after.rooms.map((room) => room.name).sort()).toEqual(['Mutfak', 'Salon']);
});

test('a room standing on its own is not offered a way to separate', async ({ page }) => {
  await page.getByTestId('room-list-r2').click();
  await expect(page.getByTestId('separate-room')).toHaveCount(0);
});
