import { expect, test, type Page } from '@playwright/test';

/**
 * Will it actually fit?
 *
 * The question the whole project exists to answer, and the one journey that has
 * to work end to end: furnish a room, get it wrong, be told, put it right, and
 * be told that too. The rules themselves are proved exhaustively in unit tests;
 * what only exists in a browser is whether the answer reaches you.
 */

async function issues(page: Page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    const { issuesOf } = await import('/src/core/rules/engine.ts');
    const floor = useEditorStore.getState().document.floors[0]!;
    return issuesOf(floor).map((issue) => ({
      id: issue.id,
      severity: issue.severity,
      title: issue.title,
    }));
  });
}

async function place(page: Page, kind: string, x: number, y: number, rotation = 0) {
  await page.evaluate(
    async ({ kind, x, y, rotation }) => {
      const { useEditorStore } = await import('/src/state/store.ts');
      useEditorStore.getState().addItem(kind, x, y, rotation);
    },
    { kind, x, y, rotation },
  );
}

async function moveTo(page: Page, id: string, y: number) {
  await page.evaluate(
    async ({ id, y }) => {
      const { useEditorStore } = await import('/src/state/store.ts');
      useEditorStore.getState().updateItem(id, { y });
    },
    { id, y },
  );
}

/** A 300 × 400 bedroom with 100mm walls: inner faces at 0…3000 and 0…4000. */
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
  await page.getByLabel('Wall').fill('10');
  await page.getByTestId('new-room-type').selectOption('bedroom');
  await page.getByTestId('create-room').click();
  await expect(page.getByTestId('room-count')).toHaveText('1 room');
});

test('a clean room says so', async ({ page }) => {
  // A bed with room either side and a wardrobe whose doors have somewhere to go.
  await place(page, 'bed-double', 1500, 1100);
  await place(page, 'wardrobe', 1500, 3700, 180);

  expect(await issues(page)).toEqual([]);

  await page.getByTestId('tab-issues').click();
  await expect(page.getByTestId('tab-issues')).not.toContainText(/\d/);
});

test('moving a wardrobe too close is caught, and putting it back clears it', async ({ page }) => {
  await place(page, 'bed-double', 1500, 1100);
  await place(page, 'wardrobe', 1500, 3700, 180);
  expect(await issues(page)).toEqual([]);

  // The bed reaches y = 2050. A wardrobe facing it from 2500 has its front face
  // at 2200 and needs 500mm of floor for each 500mm leaf — so the swing lands
  // on the bed.
  await moveTo(page, 'i2', 2500);

  const found = await issues(page);
  expect(found.map((issue) => issue.id)).toContain('clearance/i2/wardrobe-swing');
  expect(found.find((issue) => issue.id === 'clearance/i2/wardrobe-swing')!.severity).toBe('error');

  // The panel brings itself forward and says what is wrong, in words.
  await expect(page.getByTestId('tab-issues')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('issue-clearance/i2/wardrobe-swing')).toContainText('double bed');

  // Clicking the row selects both culprits and lights the zone up on the plan.
  await page.getByTestId('issue-clearance/i2/wardrobe-swing').click();
  await expect(page.locator('[data-testid="issues-layer"] path').first()).toBeVisible();

  const selected = await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    return useEditorStore.getState().selection.map((target) => target.id);
  });
  expect(selected).toEqual(expect.arrayContaining(['i1', 'i2']));

  // Put it back, and the complaint goes with it.
  await moveTo(page, 'i2', 3700);
  expect(await issues(page)).toEqual([]);
});

test('a door that cannot open is an error, not a suggestion', async ({ page }) => {
  await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    const store = useEditorStore.getState();
    const walls = Object.values(store.document.floors[0]!.graph.walls);
    store.setOpeningPreset('door-90');
    // The wall running down the left-hand side of the room.
    store.addOpening(walls[3]!.id, 800);
  });

  await place(page, 'wardrobe', 900, 3700, 180);

  const found = await issues(page);
  const swing = found.find((issue) => issue.id.endsWith('/swing'));
  expect(swing).toBeDefined();
  expect(swing!.severity).toBe('error');
  expect(swing!.title).toContain('cannot open');
});

test('the check survives a reload', async ({ page }) => {
  await place(page, 'bed-double', 1500, 1100);
  await place(page, 'wardrobe', 1500, 2500, 180);
  expect((await issues(page)).length).toBeGreaterThan(0);

  await expect(page.getByTestId('save-state')).toHaveText('Saved');
  await page.reload();

  await expect(page.getByTestId('item-count')).toHaveText('2 objects');
  expect((await issues(page)).length).toBeGreaterThan(0);
});
