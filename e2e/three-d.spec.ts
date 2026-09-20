import { expect, test, type Page } from '@playwright/test';

/**
 * The room, in three dimensions.
 *
 * The geometry is proved exhaustively in unit tests — where the walls are once
 * the doors have been cut out of them, where a wardrobe's boxes land once it
 * has been rotated. What only exists in a browser is the rest of it: that the
 * switch works, that dragging turns the room, that clicking a wardrobe in 3D
 * selects the same wardrobe the plan has, and that the two views never disagree
 * about what is in the document.
 */

/** A 360 × 420 room with 10cm walls, a door, a window and a wardrobe. */
async function furnishedRoom(page: Page) {
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
}

/** How many faces the renderer is currently drawing. */
async function faceCount(page: Page) {
  return page.getByTestId('scene-canvas').locator('svg path').count();
}

async function camera(page: Page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    return useEditorStore.getState().camera;
  });
}

test.beforeEach(async ({ page }) => {
  await furnishedRoom(page);
});

test('switching to 3D shows the room that was drawn', async ({ page }) => {
  await expect(page.getByTestId('plan-canvas')).toBeVisible();

  await page.getByTestId('view-scene').click();

  await expect(page.getByTestId('scene-canvas')).toBeVisible();
  await expect(page.getByTestId('plan-canvas')).toHaveCount(0);

  // A floor, a ground plane and the walls that are not in the way.
  expect(await faceCount(page)).toBeGreaterThan(5);

  await page.getByTestId('view-plan').click();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
});

test('the keyboard switches views too', async ({ page }) => {
  await page.keyboard.press('3');
  await expect(page.getByTestId('scene-canvas')).toBeVisible();

  await page.keyboard.press('2');
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
});

test('dragging turns the room', async ({ page }) => {
  await page.getByTestId('view-scene').click();
  await expect(page.getByTestId('scene-canvas')).toBeVisible();

  const before = await camera(page);

  const box = (await page.getByTestId('scene-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 40, { steps: 8 });
  await page.mouse.up();

  const after = await camera(page);
  expect(after.yaw).not.toBeCloseTo(before.yaw, 3);
  expect(after.pitch).not.toBeCloseTo(before.pitch, 3);
  // Turning the room does not move it.
  expect(after.target).toEqual(before.target);
});

test('the wheel zooms, within limits', async ({ page }) => {
  await page.getByTestId('view-scene').click();
  await expect(page.getByTestId('scene-canvas')).toBeVisible();

  const before = (await camera(page)).distance;

  await page.getByTestId('scene-canvas').hover();
  await page.mouse.wheel(0, -120);

  // Polled rather than read once: a wheel event goes through the compositor,
  // so dispatching it returns before the page has handled it. Every other
  // pointer event here lands synchronously.
  await expect.poll(async () => (await camera(page)).distance).toBeLessThan(before);
});

test('a door is a hole in the wall, and it opens', async ({ page }) => {
  // Put a door in the top wall, then look at it from outside.
  await page.getByTestId('tool-place-opening').click();

  const at = await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    const { toScreen } = await import('/src/views/plan2d/viewport.ts');
    const canvas = document.querySelector('[data-testid="plan-canvas"]')!;
    const rect = canvas.getBoundingClientRect();
    const state = useEditorStore.getState();
    const local = toScreen(
      state.viewport,
      { width: rect.width, height: rect.height },
      { x: 1800, y: -50 },
    );
    return { x: rect.left + local.x, y: rect.top + local.y };
  });

  await page.mouse.click(at.x, at.y);

  const openings = await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    return useEditorStore.getState().document.floors[0]!.openings.length;
  });
  expect(openings).toBe(1);

  await page.getByTestId('view-scene').click();
  await expect(page.getByTestId('scene-canvas')).toBeVisible();

  // The wall the door is in is now three pieces rather than one, and there is
  // a leaf hanging in it.
  const built = await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    const { buildScene } = await import('/src/core/scene/build.ts');
    const scene = buildScene(useEditorStore.getState().document.floors[0]!);
    return {
      leaves: scene.filter((solid) => solid.material === 'door-leaf').length,
      pieces: scene.filter((solid) => solid.id.startsWith('wall:')).length,
    };
  });

  expect(built.leaves).toBe(1);
  // Three walls whole, plus two piers and a lintel on the fourth.
  expect(built.pieces).toBe(6);
});

test('clicking an object in 3D selects the same object the plan has', async ({ page }) => {
  await page.getByTestId('tab-objects').click();
  await page.getByTestId('catalogue-wardrobe').click();

  const at = await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    const { toScreen } = await import('/src/views/plan2d/viewport.ts');
    const canvas = document.querySelector('[data-testid="plan-canvas"]')!;
    const rect = canvas.getBoundingClientRect();
    const local = toScreen(
      useEditorStore.getState().viewport,
      { width: rect.width, height: rect.height },
      { x: 1800, y: 3800 },
    );
    return { x: rect.left + local.x, y: rect.top + local.y };
  });

  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('item-count')).toHaveText('1 object');

  await page.getByTestId('view-scene').click();
  await expect(page.getByTestId('scene-canvas')).toBeVisible();

  // Clear the selection placing left behind, then find the wardrobe on screen
  // and click it.
  await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    useEditorStore.getState().clearSelection();
  });

  const target = await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    const { buildScene, hiddenWallIds, withoutWalls } = await import('/src/core/scene/build.ts');
    const { renderScene } = await import('/src/core/scene/render.ts');

    const state = useEditorStore.getState();
    const floor = state.document.floors[0]!;
    const element = document.querySelector('[data-testid="scene-canvas"]')!;
    const rect = element.getBoundingClientRect();
    const size = { width: rect.width, height: rect.height };

    const visible = withoutWalls(buildScene(floor), hiddenWallIds(floor, state.camera));
    const faces = renderScene(visible, state.camera, size);

    // The last wardrobe face painted is the one in front.
    const face = faces.filter((entry) => entry.source.kind === 'item').at(-1);
    if (!face) return null;

    const x = face.points.reduce((total, point) => total + point.x, 0) / face.points.length;
    const y = face.points.reduce((total, point) => total + point.y, 0) / face.points.length;
    return { x: rect.left + x, y: rect.top + y };
  });

  expect(target).not.toBeNull();
  await page.mouse.click(target!.x, target!.y);

  const selection = await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    return useEditorStore.getState().selection;
  });

  expect(selection).toEqual([{ kind: 'item', id: 'i1' }]);

  // And the inspector on the right is showing it, exactly as it would in plan.
  await expect(
    page
      .getByRole('complementary', { name: 'Inspector' })
      .getByText('Wardrobe', { exact: true })
      .first(),
  ).toBeVisible();
});

test('the cutaway can be switched off to see the shell whole', async ({ page }) => {
  await page.getByTestId('view-scene').click();
  await expect(page.getByTestId('scene-canvas')).toBeVisible();

  const cut = await faceCount(page);

  await page.getByTestId('scene-cutaway').click();
  await expect(page.getByTestId('scene-cutaway')).toHaveAttribute('aria-pressed', 'false');

  // Putting the near walls back can only add faces.
  expect(await faceCount(page)).toBeGreaterThan(cut);
});

test('reaching for a drawing tool brings the plan back', async ({ page }) => {
  await page.getByTestId('view-scene').click();
  await expect(page.getByTestId('scene-canvas')).toBeVisible();

  await page.getByTestId('tool-draw-wall').click();

  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  await expect(page.getByTestId('tool-draw-wall')).toHaveAttribute('aria-pressed', 'true');
});

test('an empty plan says so rather than showing an empty void', async ({ page }) => {
  await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/store.ts');
    useEditorStore.getState().newDocument();
  });

  await page.getByTestId('view-scene').click();
  await expect(page.getByTestId('scene-empty')).toBeVisible();
});

test('the camera is still where it was left after a trip to the plan', async ({ page }) => {
  await page.getByTestId('view-scene').click();
  await expect(page.getByTestId('scene-canvas')).toBeVisible();

  const box = (await page.getByTestId('scene-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();

  const turned = await camera(page);

  await page.getByTestId('view-plan').click();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  await page.getByTestId('view-scene').click();
  await expect(page.getByTestId('scene-canvas')).toBeVisible();

  expect(await camera(page)).toEqual(turned);
});
