import { expect, test } from '@playwright/test';

/**
 * Shortcuts, where you will actually find them.
 *
 * A keystroke nobody discovers is a keystroke nobody uses, and a tooltip is
 * where people look. Hover and focus both have to work: the person tabbing
 * through the toolbar is the one most likely to want the keyboard in the first
 * place.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Wait for the toolbar to exist before touching the keyboard. Shortcuts are
  // bound when the shell mounts, and under a parallel run the page is reachable
  // a beat before that — which makes a keypress sent immediately vanish.
  await expect(page.getByTestId('tool-select')).toBeVisible();
});

test('hovering a tool shows what it does and the key that does it', async ({ page }) => {
  await expect(page.getByTestId('tooltip')).toHaveCount(0);

  await page.getByTestId('tool-draw-room').hover();

  const tip = page.getByTestId('tooltip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Room');
  await expect(tip.locator('kbd')).toHaveText(['R']);
});

test('a combination is shown as separate keys', async ({ page }) => {
  await page.getByTestId('undo').hover();

  await expect(page.getByTestId('tooltip').locator('kbd')).toHaveText(['Ctrl', 'Z']);
});

test('the file buttons carry shortcuts too', async ({ page }) => {
  await page.getByTestId('save-file').hover();
  await expect(page.getByTestId('tooltip').locator('kbd')).toHaveText(['Ctrl', 'S']);
});

test('moving away puts the tooltip away', async ({ page }) => {
  await page.getByTestId('tool-draw-wall').hover();
  await expect(page.getByTestId('tooltip')).toBeVisible();

  await page.getByTestId('plan-canvas').hover();
  await expect(page.getByTestId('tooltip')).toHaveCount(0);
});

test('keyboard focus shows it as well as the pointer', async ({ page }) => {
  await page.getByTestId('tool-select').focus();

  await expect(page.getByTestId('tooltip')).toContainText('Select');
});

test('ctrl+S saves the plan', async ({ page }) => {
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.keyboard.press('Control+s'),
  ]).then(([event]) => event);

  expect(download.suggestedFilename()).toMatch(/\.house\.json$/);
});
