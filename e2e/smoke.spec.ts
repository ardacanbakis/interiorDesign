import { expect, test } from '@playwright/test';

test('the app shell renders', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/interiorDesign/);
  await expect(page.getByText('interiorDesign')).toBeVisible();
  await expect(page.getByTestId('plan-canvas-placeholder')).toBeVisible();
});
