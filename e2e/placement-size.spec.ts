import { expect, test, type Page } from '@playwright/test';

/**
 * Deciding how big it is before it goes down.
 *
 * Sizing an object after placing it means placing it twice. The journey here
 * is: arm a wardrobe, say it is 2m wide, watch the ghost agree, and have that
 * be the wardrobe that lands.
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

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createDocumentStore } = await import('/src/persistence/store.ts');
    await createDocumentStore().store.clear();
    const { useEditorStore } = await import('/src/state/store.ts');
    useEditorStore.getState().newDocument();
  });

  await page.getByLabel('Width').fill('400');
  await page.getByLabel('Depth').fill('500');
  await page.getByLabel('Wall thickness').fill('10');
  await page.getByTestId('create-room').click();
  await expect(page.getByTestId('room-count')).toHaveText('1 room');

  await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    useEditorStore.getState().setViewport({ centre: { x: 2000, y: 2500 }, scale: 0.1 });
  });
});

test('the size panel appears with the object, at its default size', async ({ page }) => {
  await page.getByTestId('tab-objects').click();
  await expect(page.getByTestId('placement-size')).toHaveCount(0);

  await page.getByTestId('catalogue-wardrobe').click();

  await expect(page.getByTestId('placement-size')).toBeVisible();
  await expect(page.getByTestId('placement-size')).toContainText('Wardrobe');
  await expect(page.getByTestId('placement-size').getByLabel('Width')).toHaveValue('150');
  await expect(page.getByTestId('placement-size').getByLabel('Depth')).toHaveValue('60');
});

test('a size typed before placing is the size that lands', async ({ page }) => {
  await page.getByTestId('tab-objects').click();
  await page.getByTestId('catalogue-wardrobe').click();

  const width = page.getByTestId('placement-size').getByLabel('Width');
  await width.fill('200');
  await width.press('Enter');

  const at = await screenOf(page, { x: 2000, y: 400 });
  await page.mouse.click(at.x, at.y);

  const placed = await items(page);
  expect(placed).toHaveLength(1);
  expect(placed[0]).toMatchObject({ kind: 'wardrobe', width: 2000, depth: 600 });
});

test('a standard size sets all three at once', async ({ page }) => {
  await page.getByTestId('tab-objects').click();
  await page.getByTestId('catalogue-wardrobe').click();

  await page.getByTestId('placement-preset').selectOption('Sliding — 180 cm');

  await expect(page.getByTestId('placement-size').getByLabel('Width')).toHaveValue('180');
  await expect(page.getByTestId('placement-size').getByLabel('Depth')).toHaveValue('65');

  const at = await screenOf(page, { x: 2000, y: 400 });
  await page.mouse.click(at.x, at.y);

  expect((await items(page))[0]).toMatchObject({ width: 1800, depth: 650, height: 2200 });
});

test('the ghost on the plan follows the size being typed', async ({ page }) => {
  await page.getByTestId('tab-objects').click();
  await page.getByTestId('catalogue-wardrobe').click();

  const at = await screenOf(page, { x: 2000, y: 400 });
  await page.mouse.move(at.x, at.y);
  await expect(page.getByTestId('placing-ghost')).toBeVisible();

  const width = page.getByTestId('placement-size').getByLabel('Width');
  await width.fill('240');
  await width.press('Enter');

  // What is being pointed at has to be what will be placed, so the ghost is
  // wider than it was — measured on the plan, not taken on trust.
  const ghostWidth = await page.evaluate(() => {
    const ghost = document.querySelector('[data-testid="placing-ghost"] path')!;
    return (ghost as SVGGraphicsElement).getBBox().width;
  });
  expect(ghostWidth).toBeCloseTo(2400, 0);
});

test('choosing a different object starts from its own default', async ({ page }) => {
  await page.getByTestId('tab-objects').click();
  await page.getByTestId('catalogue-wardrobe').click();

  const width = page.getByTestId('placement-size').getByLabel('Width');
  await width.fill('240');
  await width.press('Enter');

  await page.getByTestId('catalogue-bed-double').click();

  await expect(page.getByTestId('placement-size').getByLabel('Width')).toHaveValue('140');
});
