import { expect, test, type Page } from '@playwright/test';

/**
 * Dragging a room across the plan.
 *
 * What travels with it is proved exhaustively in unit tests. What only exists
 * in a browser is the handle: that pressing on a room's floor picks it up, that
 * it follows the pointer, that a click which does not move still just selects,
 * and that the whole drag is one press of ctrl-Z.
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
    const floor = useEditorStore.getState().document.floors[0]!;
    const xs = Object.values(floor.graph.nodes).map((node) => node.x);
    const ys = Object.values(floor.graph.nodes).map((node) => node.y);
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      rooms: floor.rooms.map((room) => ({ id: room.id, name: room.name })),
      items: floor.items.map((item) => ({ id: item.id, x: item.x, y: item.y })),
      selection: useEditorStore.getState().selection,
      undoSteps: useEditorStore.getState().history.past.length,
    };
  });
}

/** A 360 × 420 room with a bed in it, and the view pinned. */
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createDocumentStore } = await import('/src/persistence/store.ts');
    await createDocumentStore().store.clear();
    const { useEditorStore } = await import('/src/state/store.ts');
    useEditorStore.getState().newDocument();
  });

  await page.getByLabel('Width', { exact: true }).fill('360');
  await page.getByLabel('Depth', { exact: true }).fill('420');
  await page.getByLabel('Wall thickness').fill('10');
  await page.getByTestId('create-room').click();
  await expect(page.getByTestId('room-count')).toHaveText('1 room');

  await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    useEditorStore.getState().setViewport({ centre: { x: 1800, y: 2100 }, scale: 0.12 });
    useEditorStore.getState().addItem('bed-double', 1800, 2100);
    useEditorStore.getState().clearSelection();
  });
});

test('pressing on a room and dragging moves it, with the furniture in it', async ({ page }) => {
  const before = await plan(page);

  // Grab an empty patch of floor, clear of the bed in the middle.
  const from = await screenOf(page, { x: 600, y: 600 });
  const to = await screenOf(page, { x: 600 + 1000, y: 600 + 500 });

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();

  const after = await plan(page);

  expect(after.minX - before.minX).toBe(1000);
  expect(after.minY - before.minY).toBe(500);

  // The bed came too, by exactly the same distance.
  expect(after.items[0]!.x - before.items[0]!.x).toBe(1000);
  expect(after.items[0]!.y - before.items[0]!.y).toBe(500);
});

test('the room keeps its name and its identity', async ({ page }) => {
  await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    const store = useEditorStore.getState();
    const floorId = store.activeFloorId;
    store.commit('Rename', (draft) => {
      const floor = draft.floors.find((entry) => entry.id === floorId)!;
      floor.rooms[0]!.name = 'Yatak Odası';
    });
  });

  const before = await plan(page);

  const from = await screenOf(page, { x: 600, y: 600 });
  const to = await screenOf(page, { x: 3000, y: 3000 });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();

  const after = await plan(page);
  expect(after.rooms).toEqual(before.rooms);
  await expect(page.getByTestId('room-count')).toHaveText('1 room');
});

test('the whole drag is one press of ctrl-Z', async ({ page }) => {
  const before = await plan(page);

  const from = await screenOf(page, { x: 600, y: 600 });
  const to = await screenOf(page, { x: 2600, y: 2600 });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Plenty of steps: each one is a separate move, and all of them have to fold
  // into a single entry or undo walks the room home a nudge at a time.
  await page.mouse.move(to.x, to.y, { steps: 20 });
  await page.mouse.up();

  const moved = await plan(page);
  expect(moved.minX).not.toBe(before.minX);
  expect(moved.undoSteps).toBe(before.undoSteps + 1);

  await page.getByTestId('undo').click();

  const undone = await plan(page);
  expect(undone.minX).toBe(before.minX);
  expect(undone.minY).toBe(before.minY);
  expect(undone.items).toEqual(before.items);
});

test('a click that does not move still just selects the room', async ({ page }) => {
  const before = await plan(page);

  const at = await screenOf(page, { x: 600, y: 600 });
  await page.mouse.click(at.x, at.y);

  const after = await plan(page);
  expect(after.minX).toBe(before.minX);
  expect(after.selection).toEqual([{ kind: 'room', id: before.rooms[0]!.id }]);
  expect(after.undoSteps).toBe(before.undoSteps);
});

test('dragging the furniture still drags the furniture, not the room', async ({ page }) => {
  // The bed sits over the floor, so the two handles overlap. Whichever is on
  // top has to win, and that is the thing you can see.
  const before = await plan(page);

  const from = await screenOf(page, { x: 1800, y: 2100 });
  const to = await screenOf(page, { x: 1800, y: 1400 });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();

  const after = await plan(page);
  expect(after.minX).toBe(before.minX);
  expect(after.items[0]!.y).toBeLessThan(before.items[0]!.y);
});

test('a moved room is still there after a reload', async ({ page }) => {
  const from = await screenOf(page, { x: 600, y: 600 });
  const to = await screenOf(page, { x: 2100, y: 1600 });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();

  const moved = await plan(page);
  await expect(page.getByTestId('save-state')).toHaveText('Saved');

  await page.reload();
  await expect(page.getByTestId('room-count')).toHaveText('1 room');

  const after = await plan(page);
  expect(after.minX).toBe(moved.minX);
  expect(after.items).toEqual(moved.items);
});
