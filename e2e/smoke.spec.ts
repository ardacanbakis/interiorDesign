import { expect, test } from '@playwright/test';

test('the app shell renders', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/interiorDesign/);
  await expect(page.getByRole('toolbar', { name: 'Drawing tools' })).toBeVisible();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Rooms' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeVisible();
});

test('the app is usable without a mouse', async ({ page }) => {
  await page.goto('/');

  // Every control in the toolbar has to be reachable and named, because a
  // recruiter running an accessibility check is exactly the sort of visitor
  // this project expects.
  const tools = ['Select', 'Room', 'Wall', 'Door', 'Window'];

  const buttons = page.getByRole('toolbar', { name: 'Drawing tools' }).getByRole('button');
  await expect(buttons).toHaveCount(tools.length);

  for (const name of tools) {
    await expect(page.getByRole('button', { name, exact: false }).first()).toBeVisible();
  }

  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fit plan to view' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save to a file' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open a file' })).toBeVisible();

  // The catalogue is reached through the left panel's tabs rather than a tool
  // button, so those have to be named too.
  const tabs = page.getByRole('tablist', { name: 'Left panel' }).getByRole('tab');
  await expect(tabs).toHaveCount(2);
  await expect(page.getByRole('tab', { name: 'objects' })).toBeVisible();
});
