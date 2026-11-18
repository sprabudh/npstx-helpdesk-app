import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** Restores the sample data through the demo reset endpoint (DEMO_MODE only). */
export async function resetDemo(request: APIRequestContext) {
  const login = await request.post('/api/auth/demo-login', { data: { userId: 'u20' } });
  expect(login.ok()).toBeTruthy();
  const { accessToken } = await login.json();
  const res = await request.post('/api/demo/reset', { headers: { Authorization: `Bearer ${accessToken}` } });
  expect(res.ok()).toBeTruthy();
}

/** Opens a page as a demo persona (the app signs in with ?as=<userId>). */
export async function openAs(page: Page, userId: string, path = '/dashboard') {
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}as=${userId}`);
  await expect(page.locator('.rolestrip')).toBeVisible();
}

export const toast = (page: Page) => page.locator('#toasts .toast').last();
