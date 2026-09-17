import { expect, test, type Page } from '@playwright/test';

/**
 * Drawing, driven through the pointer.
 *
 * The unit tests prove the geometry; these prove that pointing at the screen
 * reaches it. Everything here goes through real mouse events at real
 * coordinates, because the interesting failures in an editor — a snap that
 * fires at the wrong radius, a drag that never ends, a tool that keeps
 * selecting after it has been switched — only exist between the pointer and the
 * model.
 */

/** Pin the view so model coordinates map to predictable screen positions. */
async function setViewport(page: Page, centre: { x: number; y: number }, scale: number) {
  await page.evaluate(
    async ({ centre, scale }) => {
      const { useEditorStore } = await import('/src/state/store.ts');
      useEditorStore.getState().setViewport({ centre, scale });
    },
    { centre, scale },
  );
}

/** Where a model point currently sits on screen, in page coordinates. */
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

async function dragModel(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const start = await screenOf(page, from);
  const end = await screenOf(page, to);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // Several steps: a single jump can be taken for a click rather than a drag.
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2);
  await page.mouse.move(end.x, end.y);
  await page.mouse.up();
}

async function clickModel(page: Page, point: { x: number; y: number }) {
  const screen = await screenOf(page, point);
  await page.mouse.click(screen.x, screen.y);
}

async function graphSummary(page: Page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    const floor = useEditorStore.getState().document.floors[0]!;
    return {
      walls: Object.keys(floor.graph.walls).length,
      nodes: Object.keys(floor.graph.nodes).length,
      rooms: floor.rooms.map((room) => room.name),
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    // A clean slate per test, and clear storage so the previous test's plan is
    // not reopened on the next load.
    const { createDocumentStore } = await import('/src/persistence/store.ts');
    await createDocumentStore().store.clear();
    const { useEditorStore } = await import('/src/state/store.ts');
    useEditorStore.getState().newDocument();
  });
  await setViewport(page, { x: 3000, y: 2000 }, 0.08);
});

test('drawing a room makes a room appear', async ({ page }) => {
  await page.getByTestId('tool-draw-room').click();

  await dragModel(page, { x: 0, y: 0 }, { x: 6000, y: 4000 });

  await expect(page.getByTestId('room-count')).toHaveText('1 room');

  const summary = await graphSummary(page);
  expect(summary.walls).toBe(4);
  expect(summary.nodes).toBe(4);
  expect(summary.rooms).toEqual(['Room 1']);

  // 6m x 4m of centreline with 250mm exterior walls: 5.75 x 3.75 = 21.56 m².
  await expect(page.getByTestId('floor-area')).toHaveText('21.56 m²');
});

test('a wall drawn across a room splits it in two', async ({ page }) => {
  await page.getByTestId('tool-draw-room').click();
  await dragModel(page, { x: 0, y: 0 }, { x: 6000, y: 4000 });
  await expect(page.getByTestId('room-count')).toHaveText('1 room');

  // Name it, so it can be shown that the name survives the split.
  await page.getByText('Room 1').first().click();
  await page.getByTestId('room-name').fill('Salon');

  await page.getByTestId('tool-draw-wall').click();
  await clickModel(page, { x: 4000, y: 0 });
  await clickModel(page, { x: 4000, y: 4000 });
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('room-count')).toHaveText('2 rooms');

  const summary = await graphSummary(page);
  // Top and bottom walls each split, plus the divider: 4 - 2 + 4 + 1 = 7.
  expect(summary.walls).toBe(7);
  // The anchor was at the centre of the old room, which is in the left half.
  expect(summary.rooms).toContain('Salon');
});

test('typing a dimension moves the wall exactly there', async ({ page }) => {
  await page.getByTestId('tool-draw-room').click();
  await dragModel(page, { x: 0, y: 0 }, { x: 4000, y: 3000 });

  await page.getByTestId('tool-select').click();

  // Select the top wall by clicking on it.
  await clickModel(page, { x: 2000, y: 0 });

  const length = page.getByLabel('Length');
  await expect(length).toHaveValue('400');

  await length.fill('600');
  await length.press('Enter');

  const wallLength = await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    const { getWall, nodePoint } = await import('/src/core/graph/wallGraph.ts');
    const state = useEditorStore.getState();
    const wallId = state.selection.find((entry) => entry.kind === 'wall')!.id;
    const graph = state.document.floors[0]!.graph;
    const wall = getWall(graph, wallId);
    const a = nodePoint(graph, wall.a);
    const b = nodePoint(graph, wall.b);
    return Math.round(Math.hypot(b.x - a.x, b.y - a.y));
  });

  expect(wallLength).toBe(6000);
});

test('escape abandons a wall run without drawing anything', async ({ page }) => {
  await page.getByTestId('tool-draw-wall').click();

  await clickModel(page, { x: 0, y: 0 });
  await clickModel(page, { x: 3000, y: 0 });
  await page.keyboard.press('Escape');

  expect((await graphSummary(page)).walls).toBe(0);
});

test('undo and redo walk back through drawing', async ({ page }) => {
  await page.getByTestId('tool-draw-room').click();
  await dragModel(page, { x: 0, y: 0 }, { x: 6000, y: 4000 });
  await expect(page.getByTestId('room-count')).toHaveText('1 room');

  await page.getByTestId('tool-draw-wall').click();
  await clickModel(page, { x: 3000, y: 0 });
  await clickModel(page, { x: 3000, y: 4000 });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('room-count')).toHaveText('2 rooms');

  await page.getByTestId('undo').click();
  await expect(page.getByTestId('room-count')).toHaveText('1 room');

  await page.getByTestId('undo').click();
  await expect(page.getByTestId('room-count')).toHaveText('0 rooms');

  await page.getByTestId('redo').click();
  await page.getByTestId('redo').click();
  await expect(page.getByTestId('room-count')).toHaveText('2 rooms');
});

test('drawing two rooms side by side gives them one shared wall', async ({ page }) => {
  await page.getByTestId('tool-draw-room').click();
  await dragModel(page, { x: 0, y: 0 }, { x: 3000, y: 3000 });
  await dragModel(page, { x: 3000, y: 0 }, { x: 6000, y: 3000 });

  await expect(page.getByTestId('room-count')).toHaveText('2 rooms');

  const shared = await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    const { allWalls, nodePoint } = await import('/src/core/graph/wallGraph.ts');
    const graph = useEditorStore.getState().document.floors[0]!.graph;

    return allWalls(graph).filter((wall) => {
      const a = nodePoint(graph, wall.a);
      const b = nodePoint(graph, wall.b);
      return a.x === 3000 && b.x === 3000;
    }).length;
  });

  // One wall between them, not two back to back.
  expect(shared).toBe(1);
});

test('the keyboard switches tools', async ({ page }) => {
  await page.getByTestId('plan-canvas').click();

  await page.keyboard.press('r');
  await expect(page.getByTestId('tool-draw-room')).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('w');
  await expect(page.getByTestId('tool-draw-wall')).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('v');
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
});
