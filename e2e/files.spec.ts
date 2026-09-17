import { expect, test } from '@playwright/test';

/**
 * Plans as files.
 *
 * A plan lives in this browser's storage, so a file is the only way one travels
 * between a laptop and a phone. That makes the round trip — save, start again,
 * open — a journey worth proving rather than assuming.
 */

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
  await page.getByLabel('Wall').fill('10');
  await page.getByTestId('create-room').click();
  await expect(page.getByTestId('room-count')).toHaveText('1 room');
});

test('a plan saves to a file and opens again', async ({ page }) => {
  await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    useEditorStore.getState().addItem('bed-double', 1800, 1000);
  });

  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('save-file').click(),
  ]).then(([event]) => event);

  expect(download.suggestedFilename()).toMatch(/\.house\.json$/);
  const path = await download.path();

  // Start from nothing, so anything that comes back came out of the file.
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByTestId('new-file').click();
  await expect(page.getByTestId('room-count')).toHaveText('0 rooms');

  await page.getByTestId('file-input').setInputFiles(path);

  await expect(page.getByTestId('room-count')).toHaveText('1 room');
  await expect(page.getByTestId('item-count')).toHaveText('1 object');
  await expect(page.getByTestId('floor-area')).toHaveText('15.12 m²');
});

test('a file that is not a plan is refused, not swallowed', async ({ page }) => {
  await page.getByTestId('file-input').setInputFiles({
    name: 'holiday.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"not":"a plan"}'),
  });

  await expect(page.getByTestId('file-error')).toBeVisible();
  // And the plan that was open is still open.
  await expect(page.getByTestId('room-count')).toHaveText('1 room');
});
