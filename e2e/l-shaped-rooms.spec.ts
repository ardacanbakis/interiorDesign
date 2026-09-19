import { expect, test, type Page } from '@playwright/test';

/**
 * Rooms that are not rectangles.
 *
 * A chimney breast, a stair bulkhead, a bathroom cut into the corner — most
 * real houses are full of them, and a planner that only draws rectangles
 * cannot describe the room you are standing in. The promise is the same one
 * the rectangle makes: the numbers typed are the numbers a tape measure gives.
 */

async function floorArea(page: Page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    const { roomsOf } = await import('/src/core/model/derive.ts');
    const floor = useEditorStore.getState().document.floors[0]!;
    return roomsOf(floor).map((room) => room.geometry.area);
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createDocumentStore } = await import('/src/persistence/store.ts');
    await createDocumentStore().store.clear();
    const { useEditorStore } = await import('/src/state/store.ts');
    useEditorStore.getState().newDocument();
  });
});

test('an L-shaped room measures exactly what was typed', async ({ page }) => {
  await page.getByTestId('shape-l-shape').click();

  await page.getByLabel('Width', { exact: true }).fill('500');
  await page.getByLabel('Depth', { exact: true }).fill('400');
  await page.getByLabel('Wall thickness').fill('10');
  await page.getByLabel('Corner width').fill('200');
  await page.getByLabel('Corner depth').fill('150');
  await page.getByLabel('Corner depth').press('Enter');

  // 5m x 4m less a 2m x 1.5m corner is 17 m², and the readout says so before
  // anything is committed.
  await expect(page.getByTestId('new-room-preview')).toContainText('17.00');

  await page.getByTestId('create-room').click();

  await expect(page.getByTestId('room-count')).toHaveText('1 room');
  expect(await floorArea(page)).toEqual([5000 * 4000 - 2000 * 1500]);
});

test('the corner can be moved, and the plan follows', async ({ page }) => {
  await page.getByTestId('shape-l-shape').click();
  await page.getByLabel('Width', { exact: true }).fill('500');
  await page.getByLabel('Depth', { exact: true }).fill('400');
  await page.getByLabel('Wall thickness').fill('10');
  await page.getByLabel('Corner width').fill('200');
  await page.getByLabel('Corner depth').fill('150');
  await page.getByLabel('Corner depth').press('Enter');

  await page.getByTestId('corner-bottom-left').click();
  await page.getByTestId('create-room').click();

  // Same area whichever corner is missing; what changes is where the floor is.
  expect(await floorArea(page)).toEqual([5000 * 4000 - 2000 * 1500]);

  const outline = await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    const { roomsOf } = await import('/src/core/model/derive.ts');
    const { containsPoint } = await import('/src/core/geometry/polygon.ts');
    const room = roomsOf(useEditorStore.getState().document.floors[0]!)[0]!;
    const xs = room.geometry.outline.map((p) => p.x);
    const ys = room.geometry.outline.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return {
      bottomLeft: containsPoint(room.geometry.outline, { x: minX + 500, y: minY + 3500 }),
      topRight: containsPoint(room.geometry.outline, { x: minX + 4500, y: minY + 500 }),
    };
  });

  expect(outline.bottomLeft).toBe(false);
  expect(outline.topRight).toBe(true);
});

test('a corner field will not accept more than the room can spare', async ({ page }) => {
  await page.getByTestId('shape-l-shape').click();
  await page.getByLabel('Width', { exact: true }).fill('300');
  await page.getByLabel('Depth', { exact: true }).fill('300');
  await page.getByLabel('Corner width').fill('295');
  await page.getByLabel('Corner width').press('Enter');

  // Clamped to leave the minimum arm standing, rather than accepted and then
  // complained about.
  await expect(page.getByLabel('Corner width')).toHaveValue('280');
  await expect(page.getByTestId('create-room')).toBeEnabled();
});

test('shrinking the room under a corner that no longer fits says so', async ({ page }) => {
  await page.getByTestId('shape-l-shape').click();
  await page.getByLabel('Width', { exact: true }).fill('500');
  await page.getByLabel('Corner width').fill('400');
  await page.getByLabel('Corner width').press('Enter');

  // The corner was fine at 5m wide. At 4.1m it leaves 10cm beside it, which is
  // not a room — 20cm is the least the arithmetic will describe.
  await page.getByLabel('Width', { exact: true }).fill('410');
  await page.getByLabel('Width', { exact: true }).press('Enter');

  await expect(page.getByTestId('notch-problem')).toBeVisible();
  await expect(page.getByTestId('create-room')).toBeDisabled();
});

test('switching back to a rectangle drops the corner', async ({ page }) => {
  await page.getByTestId('shape-l-shape').click();
  await expect(page.getByLabel('Corner width')).toBeVisible();

  await page.getByTestId('shape-rectangle').click();

  await expect(page.getByLabel('Corner width')).toHaveCount(0);
  await expect(page.getByTestId('shape-preview')).toHaveCount(0);

  await page.getByLabel('Width', { exact: true }).fill('300');
  await page.getByLabel('Depth', { exact: true }).fill('400');
  await page.getByLabel('Wall thickness').fill('10');
  await page.getByTestId('create-room').click();

  expect(await floorArea(page)).toEqual([3000 * 4000]);
});

test('an L-shaped room survives a reload', async ({ page }) => {
  await page.getByTestId('shape-l-shape').click();
  await page.getByLabel('Width', { exact: true }).fill('500');
  await page.getByLabel('Depth', { exact: true }).fill('400');
  await page.getByLabel('Wall thickness').fill('10');
  await page.getByLabel('Corner width').fill('200');
  await page.getByLabel('Corner depth').fill('150');
  await page.getByLabel('Corner depth').press('Enter');
  await page.getByTestId('create-room').click();

  await expect(page.getByTestId('save-state')).toHaveText('Saved');
  await page.reload();

  await expect(page.getByTestId('room-count')).toHaveText('1 room');
  expect(await floorArea(page)).toEqual([5000 * 4000 - 2000 * 1500]);
});
