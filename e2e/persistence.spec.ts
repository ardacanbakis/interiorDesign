import { expect, test } from '@playwright/test';

/**
 * The autosave round-trip, exercised against real IndexedDB.
 *
 * The unit tests cover the scheduling and the store interface against an
 * in-memory fake; only a real browser can prove that what is written actually
 * comes back after a reload, which is the part someone's evening of measuring
 * depends on.
 */
test('a plan survives a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('save-state')).toHaveText('Ready');

  // Draw a 6m x 3m shell divided into two rooms, through the store.
  await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    const { graphFromSegments, rectangleSegments, insertWall } =
      await import('/src/core/graph/wallGraph.ts');

    const store = useEditorStore.getState();
    store.commit('Draw shell', (draft) => {
      draft.name = 'Bizim Ev';
      draft.floors[0]!.graph = graphFromSegments(rectangleSegments(0, 0, 6000, 3000, 'exterior'));
    });
    store.commit('Divide', (draft) => {
      const floor = draft.floors[0]!;
      floor.graph = insertWall(floor.graph, { x: 4000, y: 0 }, { x: 4000, y: 3000 }).graph;
    });
    store.commit('Name the room', (draft) => {
      const rooms = draft.floors[0]!.rooms;
      rooms[0] = { ...rooms[0]!, name: 'Salon', type: 'living' };
    });
  });

  await expect(page.getByTestId('room-count')).toHaveText('2 rooms');
  await expect(page.getByTestId('save-state')).toHaveText('Saved', { timeout: 5000 });

  await page.reload();

  // Reopened from IndexedDB, with the rooms and the name intact.
  await expect(page.getByTestId('room-count')).toHaveText('2 rooms');

  const restored = await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    const document = useEditorStore.getState().document;
    return {
      name: document.name,
      rooms: document.floors[0]!.rooms.map((room) => room.name).sort(),
      walls: Object.keys(document.floors[0]!.graph.walls).length,
    };
  });

  expect(restored.name).toBe('Bizim Ev');
  expect(restored.rooms).toContain('Salon');
  expect(restored.walls).toBe(7);
});

test('floor area is reported from inside the walls', async ({ page }) => {
  await page.goto('/');

  await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    const { graphFromSegments, rectangleSegments } = await import('/src/core/graph/wallGraph.ts');

    useEditorStore.getState().commit('Draw shell', (draft) => {
      draft.floors[0]!.graph = graphFromSegments(rectangleSegments(0, 0, 4000, 3000, 'exterior'));
    });
  });

  // 4m x 3m along the wall centrelines, 250mm walls: 3.75m x 2.75m of floor.
  await expect(page.getByTestId('floor-area')).toHaveText('10.31 m²');
});
