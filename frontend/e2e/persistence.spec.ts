import { expect, test } from '@playwright/test';
import { openAs, resetDemo, toast } from './helpers';

test.beforeEach(async ({ request }) => resetDemo(request));

test('persistence · a raised ticket survives reload without ?as', async ({ page }) => {
  const title = `Persistent ticket ${Date.now()}`;
  await openAs(page, 'u1');
  await page.locator('.bigbtn.primary', { hasText: 'Raise ticket' }).click();
  await page.locator('.hdcard', { hasText: 'HR helpdesk' }).click();
  await page.selectOption('#d-cat', 'LEAVE');
  await page.selectOption('#d-sub', 'Leave balance');
  await page.fill('#d-title', title);
  await page.fill('#d-desc', 'This ticket must still be here after a browser refresh.');
  await page.locator('.dr-foot .btn.primary').click();
  await expect(toast(page)).toContainText(/HR-\d{6} raised/);
  const key = (await toast(page).innerText()).match(/HR-\d{6}/)?.[0];
  expect(key).toBeTruthy();

  await page.goto(`/ticket/${key}`);
  await expect(page.getByText(title).first()).toBeVisible();
  await expect(page.locator('.rolestrip')).toContainText('Arjun Kumar');

  await page.reload();
  await expect(page.locator('.rolestrip')).toContainText('Arjun Kumar');
  await expect(page.getByText(title).first()).toBeVisible();
});

test('persistence · FAQ feedback is restored after a browser refresh', async ({ page }) => {
  await openAs(page, 'u1', '/faqs');
  await page.locator('.acc > button').first().click();
  await page.locator('.helped .btn', { hasText: 'Yes' }).click();
  await expect(toast(page)).toContainText('Thanks for the feedback');

  await page.reload();
  await expect(page.locator('.rolestrip')).toContainText('Arjun Kumar');
  await page.locator('.acc > button').first().click();
  await expect(page.locator('.helped')).toContainText('Thanks. Marked as helpful.');
});
