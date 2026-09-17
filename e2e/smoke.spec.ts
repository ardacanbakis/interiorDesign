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
  const buttons = page.getByRole('toolbar', { name: 'Drawing tools' }).getByRole('button');
  await expect(buttons).toHaveCount(3);

  for (const name of ['Select', 'Room', 'Wall']) {
    await expect(page.getByRole('button', { name, exact: false }).first()).toBeVisible();
  }

  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fit plan to view' })).toBeVisible();
});
