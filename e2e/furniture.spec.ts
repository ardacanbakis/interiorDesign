import { expect, test, type Page } from '@playwright/test';

/**
 * Furnishing a room.
 *
 * The catalogue's geometry is proved exhaustively in unit tests. What only
 * exists in a browser is the path from "I want a wardrobe" to a wardrobe
 * against the right wall, facing the right way, with its measurements editable
 * — so that is what this covers.
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

async function items(page: Page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    return useEditorStore.getState().document.floors[0]!.items;
  });
}

/** A 360 × 420 room with 100mm walls, created from typed measurements. */
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createDocumentStore } = await import('/src/persistence/store.ts');
    await createDocumentStore().store.clear();
    const { useEditorStore } = await import('/src/state/store.ts');
    useEditorStore.getState().newDocument();
  });

  await page.getByLabel('Width').fill('360');
  await page.getByLabel('Depth').fill('420');
  await page.getByLabel('Wall thickness').fill('10');
  await page.getByTestId('create-room').click();
  await expect(page.getByTestId('room-count')).toHaveText('1 room');

  // Pin the view so model coordinates map predictably.
  await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    useEditorStore.getState().setViewport({ centre: { x: 1800, y: 2100 }, scale: 0.12 });
  });
});

test('choosing an object from the catalogue and putting it against a wall', async ({ page }) => {
  await page.getByTestId('tab-objects').click();
  await page.getByTestId('catalogue-wardrobe').click();

  // Choosing is arming: the toolbar says what is in hand.
  await expect(page.getByTestId('armed-object')).toContainText('wardrobe');

  // The typed 360 × 420 is the usable floor, so the inner faces are at x = 0
  // and 3600, y = 0 and 4200. Aim just inside the top wall.
  const at = await screenOf(page, { x: 1800, y: 400 });
  await page.mouse.move(at.x, at.y);
  await expect(page.getByTestId('placing-ghost')).toBeVisible();
  await page.mouse.click(at.x, at.y);

  const placed = await items(page);
  expect(placed).toHaveLength(1);
  expect(placed[0]!.kind).toBe('wardrobe');

  // Back flat against the inner face, front turned into the room: a 600mm-deep
  // wardrobe therefore has its centre 300mm from the face, not on the pointer.
  expect(placed[0]!.y).toBe(300);
  expect(placed[0]!.rotation).toBe(0);

  await expect(page.getByTestId('item-count')).toHaveText('1 object');
});

test('every measurement of a placed object can be edited', async ({ page }) => {
  await page.getByTestId('tab-objects').click();
  await page.getByTestId('catalogue-wardrobe').click();

  const at = await screenOf(page, { x: 1800, y: 400 });
  await page.mouse.click(at.x, at.y);

  // Placing selects it, so the inspector is already showing it.
  await expect(page.getByText('Wardrobe', { exact: true }).first()).toBeVisible();

  await page.getByLabel('Width').fill('200');
  await page.getByLabel('Width').press('Enter');
  await page.getByLabel('Height').fill('240');
  await page.getByLabel('Height').press('Enter');
  await page.getByTestId('item-param-doors').fill('4');

  const edited = (await items(page))[0]!;
  expect(edited.width).toBe(2000);
  expect(edited.height).toBe(2400);
  expect(edited.params.doors).toBe(4);

  // A standard size sets three numbers at once.
  await page.getByTestId('item-preset').selectOption('Sliding — 180 cm');
  const preset = (await items(page))[0]!;
  expect(preset).toMatchObject({ width: 1800, depth: 650, height: 2200 });
});

test('an object can be deleted, and undo brings it back', async ({ page }) => {
  await page.getByTestId('tab-objects').click();
  await page.getByTestId('catalogue-bed-double').click();

  const at = await screenOf(page, { x: 1800, y: 2100 });
  await page.mouse.click(at.x, at.y);
  expect(await items(page)).toHaveLength(1);

  await page.getByTestId('delete-item').click();
  expect(await items(page)).toHaveLength(0);

  await page.getByTestId('undo').click();
  const restored = await items(page);
  expect(restored).toHaveLength(1);
  expect(restored[0]!.kind).toBe('bed-double');
});

test('furniture is still there after a reload', async ({ page }) => {
  await page.getByTestId('tab-objects').click();
  await page.getByTestId('catalogue-sofa-3').click();

  const at = await screenOf(page, { x: 1800, y: 3800 });
  await page.mouse.click(at.x, at.y);

  const before = (await items(page))[0]!;
  await expect(page.getByTestId('save-state')).toHaveText('Saved');

  await page.reload();
  await expect(page.getByTestId('item-count')).toHaveText('1 object');

  const after = (await items(page))[0]!;
  expect(after).toMatchObject({ kind: 'sofa-3', x: before.x, y: before.y });
});
