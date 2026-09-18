import { expect, test, type Page } from '@playwright/test';

/**
 * Doors and windows, placed by pointing at a wall.
 *
 * The unit tests prove the swing geometry and the re-homing; these prove the
 * pointer reaches the right wall at the right distance along it, which is the
 * part that only exists in a browser.
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

async function openings(page: Page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    return useEditorStore.getState().document.floors[0]!.openings;
  });
}

/** A 360 x 420 room with 100mm walls, created from typed measurements. */
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createDocumentStore } = await import('/src/persistence/store.ts');
    await createDocumentStore().store.clear();
    const { useEditorStore } = await import('/src/state/store.ts');
    useEditorStore.getState().newDocument();
    useEditorStore.getState().setOpeningPreset('door-80');
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

test('pointing at a wall places a door on it', async ({ page }) => {
  await page.getByTestId('tool-place-opening').click();

  // The top wall's centreline runs along y = -50, from x = -50 to x = 3650.
  const target = await screenOf(page, { x: 800, y: -50 });
  await page.mouse.move(target.x, target.y);
  await expect(page.getByTestId('opening-preview')).toBeVisible();

  await page.mouse.click(target.x, target.y);

  const placed = await openings(page);
  expect(placed).toHaveLength(1);
  expect(placed[0]!.kind).toBe('door');
  expect(placed[0]!.width).toBe(800);
  // Measured from the wall's start at x = -50, so 800 along it.
  expect(placed[0]!.offset).toBeCloseTo(850, -1);
});

test('the preset picker decides what gets placed', async ({ page }) => {
  // A window has its own tool now, rather than hiding in the door tool's list.
  await page.getByTestId('tool-place-window').click();
  await page.getByTestId('opening-preset').selectOption('window-120');

  const target = await screenOf(page, { x: 1800, y: -50 });
  await page.mouse.click(target.x, target.y);

  const placed = await openings(page);
  expect(placed[0]).toMatchObject({ kind: 'window', width: 1200, sillHeight: 900 });
});

test('an opening near the end of a wall is pulled back so it fits', async ({ page }) => {
  await page.getByTestId('tool-place-opening').click();

  // Right at the corner: an 800 door cannot be centred there.
  const target = await screenOf(page, { x: 3600, y: -50 });
  await page.mouse.click(target.x, target.y);

  const placed = await openings(page);
  expect(placed).toHaveLength(1);
  // The wall is 3700 long, so the furthest an 800 door can sit is 3300.
  expect(placed[0]!.offset).toBe(3300);
});

test('clicking away from any wall places nothing', async ({ page }) => {
  await page.getByTestId('tool-place-opening').click();

  const middle = await screenOf(page, { x: 1800, y: 2100 });
  await page.mouse.click(middle.x, middle.y);

  expect(await openings(page)).toHaveLength(0);
});

test('a door survives its wall being split by a new partition', async ({ page }) => {
  await page.getByTestId('tool-place-opening').click();
  const target = await screenOf(page, { x: 800, y: -50 });
  await page.mouse.click(target.x, target.y);

  const before = (await openings(page))[0]!;
  expect(before).toBeDefined();

  // Draw a partition across the middle, which cuts the top and bottom walls.
  await page.getByTestId('tool-draw-wall').click();
  const top = await screenOf(page, { x: 2000, y: -50 });
  const bottom = await screenOf(page, { x: 2000, y: 4250 });
  await page.mouse.click(top.x, top.y);
  await page.mouse.click(bottom.x, bottom.y);
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('room-count')).toHaveText('2 rooms');

  const after = (await openings(page))[0]!;
  expect(after).toBeDefined();

  // It has moved onto a wall that exists, and has not moved in the world.
  const hostExists = await page.evaluate(async (wallId) => {
    const { useEditorStore } = await import('/src/state/store.ts');
    return Boolean(useEditorStore.getState().document.floors[0]!.graph.walls[wallId]);
  }, after.wallId);

  expect(hostExists).toBe(true);
  expect(after.wallId).not.toBe(before.wallId);
  expect(after.offset).toBe(before.offset);
});

test('deleting a door removes it', async ({ page }) => {
  await page.getByTestId('tool-place-opening').click();
  const target = await screenOf(page, { x: 800, y: -50 });
  await page.mouse.click(target.x, target.y);
  expect(await openings(page)).toHaveLength(1);

  await page.getByTestId('delete-opening').click();
  expect(await openings(page)).toHaveLength(0);
});

test('the door opens and closes', async ({ page }) => {
  await page.getByTestId('tool-place-opening').click();
  const target = await screenOf(page, { x: 800, y: -50 });
  await page.mouse.click(target.x, target.y);

  const slider = page.getByTestId('opening-amount');
  await expect(slider).toHaveValue('0');

  await slider.fill('100');
  expect((await openings(page))[0]!.openAmount).toBe(1);
});

test('the window tool remembers its own size, separately from the door tool', async ({ page }) => {
  await page.getByTestId('tool-place-window').click();
  await page.getByTestId('opening-preset').selectOption('window-180');

  // Over to doors and back: the window size must still be what was chosen.
  await page.keyboard.press('d');
  await expect(page.getByTestId('opening-preset')).toHaveValue('door-80');
  await page.keyboard.press('Shift+W');
  await expect(page.getByTestId('opening-preset')).toHaveValue('window-180');

  // And the door list never offers a window, nor the other way round.
  const options = await page.getByTestId('opening-preset').locator('option').allTextContents();
  expect(options.every((label) => /window/i.test(label))).toBe(true);
});
