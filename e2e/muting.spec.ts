import { expect, test, type Page } from '@playwright/test';

/**
 * Putting a warning aside.
 *
 * Some warnings are right about the geometry and wrong about the room. A
 * checker that cannot be told "I know" is one that gets switched off wholesale,
 * so the journey here is: be warned, say "I know", and have it stay said —
 * through a reload, and until you take it back.
 */

async function place(page: Page, kind: string, x: number, y: number, rotation = 0) {
  await page.evaluate(
    async ({ kind, x, y, rotation }) => {
      const { useEditorStore } = await import('/src/state/store.ts');
      useEditorStore.getState().addItem(kind, x, y, rotation);
    },
    { kind, x, y, rotation },
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createDocumentStore } = await import('/src/persistence/store.ts');
    await createDocumentStore().store.clear();
    const { useEditorStore } = await import('/src/state/store.ts');
    useEditorStore.getState().newDocument();
  });

  await page.getByLabel('Width').fill('300');
  await page.getByLabel('Depth').fill('400');
  await page.getByLabel('Wall thickness').fill('10');
  await page.getByTestId('create-room').click();
  await expect(page.getByTestId('room-count')).toHaveText('1 room');

  // A radiator with a bed pushed up against it: the checker's warning, not
  // an error, so it is the kind of thing that can be put aside.
  await place(page, 'radiator', 1500, 50);
  await place(page, 'bed-double', 1500, 1050);
});

test('a warning can be put aside, and comes back on request', async ({ page }) => {
  await page.getByTestId('tab-issues').click();

  const row = page.getByTestId('issue-clearance/i1/radiator-blocked');
  await expect(row).toBeVisible();
  await expect(page.getByTestId('issues-count')).toHaveText('1');

  await page.getByTestId('mute-clearance/i1/radiator-blocked').click();

  await expect(row).toHaveCount(0);
  await expect(page.getByTestId('issues-count')).toHaveCount(0);
  await expect(page.getByTestId('toggle-muted')).toContainText('1 warning put aside');

  await page.getByTestId('toggle-muted').click();
  await page.getByTestId('unmute-clearance/i1/radiator-blocked').click();

  await expect(row).toBeVisible();
  await expect(page.getByTestId('issues-count')).toHaveText('1');
});

test('a muted warning stays muted after a reload', async ({ page }) => {
  await page.getByTestId('tab-issues').click();
  await page.getByTestId('mute-clearance/i1/radiator-blocked').click();
  await expect(page.getByTestId('save-state')).toHaveText('Saved');

  await page.reload();
  await page.getByTestId('tab-issues').click();

  await expect(page.getByTestId('issue-clearance/i1/radiator-blocked')).toHaveCount(0);
  await expect(page.getByTestId('toggle-muted')).toContainText('put aside');
});

test('an error offers no way to be put aside', async ({ page }) => {
  // The bed now on top of the radiator entirely: an error, and it stays one.
  await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    useEditorStore.getState().updateItem('i2', { y: 300 });
  });

  await page.getByTestId('tab-issues').click();
  const collision = page.getByTestId('issue-overlap/i1/i2');
  await expect(collision).toBeVisible();
  await expect(page.getByTestId('mute-overlap/i1/i2')).toHaveCount(0);
});
