import { expect, test } from '@playwright/test';
import { openAs, resetDemo, toast } from './helpers';

test.beforeEach(async ({ request }) => resetDemo(request));

// Fix 3: no priority control anywhere in the raise drawer.
test('Fix 3 · raise form has no priority field', async ({ page }) => {
  await openAs(page, 'u1');
  await page.locator('.bigbtn.primary', { hasText: 'Raise ticket' }).click();
  await page.locator('.hdcard', { hasText: 'HR helpdesk' }).click();
  await page.selectOption('#d-cat', 'PAY');
  await expect(page.locator('#d-pri')).toHaveCount(0);
  await expect(page.locator('.drawer label', { hasText: /^Priority/ })).toHaveCount(0);
});

// Fix 2: the SLA tab explains versioning and lists frozen versions.
test('Fix 2 · SLA tab shows the versioning note and version history', async ({ page }) => {
  await openAs(page, 'u20', '/admin');
  await page.getByRole('button', { name: 'SLA and escalation' }).click();
  await expect(page.getByText('Changes apply to tickets raised after you save')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Version history' })).toBeVisible();
  await expect(page.locator('.adm-sec', { hasText: 'Version history' }).locator('table.t')).toContainText('Initial SLA policy');
});

// Fix 2: saving an SLA target freezes a new version and says so.
test('Fix 2 · changing an SLA target creates a new version', async ({ page }) => {
  await openAs(page, 'u20', '/admin');
  await page.getByRole('button', { name: 'SLA and escalation' }).click();
  const input = page.locator('#sla-shared-Medium-1');
  await input.fill('81');
  await input.blur();
  await expect(toast(page)).toContainText(/SLA v\d+/);
});

// Fix 4: the assignee performance report renders with cards, a table and an export.
test('Fix 4 · assignee performance report', async ({ page }) => {
  await openAs(page, 'u20', '/admin');
  await page.getByRole('button', { name: 'Assignee performance' }).click();
  await expect(page.locator('.kpis .kpi').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();
  await expect(page.locator('table.t', { hasText: 'Unassigned (queues)' })).toBeVisible();
});

// Fix 1: the demo out-of-office panel toggles a person's leave state.
test('Fix 1 · out-of-office demo panel toggles a person', async ({ page }) => {
  await openAs(page, 'u1');
  await page.getByRole('button', { name: 'Out of office (demo)' }).click();
  const dlg = page.locator('.dlg', { hasText: 'Out of office (demo)' });
  await expect(dlg).toBeVisible();
  const sw = dlg.getByRole('switch', { name: 'Kavya Nair on leave today' });
  await expect(sw).not.toBeChecked();
  await sw.click();
  await expect(sw).toBeChecked();
});

// Fix 1: an HR leave ticket routes past the absent category lead to the next available person.
test('Fix 1 · absent lead is covered by the next available person', async ({ page }) => {
  await openAs(page, 'u1');
  await page.locator('.bigbtn.primary', { hasText: 'Raise ticket' }).click();
  await page.locator('.hdcard', { hasText: 'HR helpdesk' }).click();
  await page.selectOption('#d-cat', 'LEAVE');
  await page.selectOption('#d-sub', 'Leave balance');
  await page.fill('#d-title', 'Leave balance query');
  await page.fill('#d-desc', 'Please check my leave balance for October.');
  await page.locator('.dr-foot .btn.primary').click();
  await expect(toast(page)).toContainText(/HR-\d{6} raised/);
  await expect(toast(page)).toContainText('Anil Gupta');
  await expect(toast(page)).not.toContainText('Priya Rao');
});
