import { expect, test } from '@playwright/test';
import { openAs, resetDemo, toast } from './helpers';

test.beforeEach(async ({ request }) => resetDemo(request));

test('1. raise an HR ticket', async ({ page }) => {
  await openAs(page, 'u1');
  await page.locator('.mh-actions .btn.primary', { hasText: 'Raise ticket' }).click();
  await page.locator('.hdcard', { hasText: 'HR helpdesk' }).click();
  await page.selectOption('#d-cat', 'PAY');
  await page.selectOption('#d-sub', 'Salary credit');
  await page.fill('#d-title', 'October salary missing');
  await page.fill('#d-desc', 'My October salary has not been credited yet.');
  await page.fill('#d-payMonth', '2026-10');
  await page.locator('.dr-foot .btn.primary').click();
  await expect(page).toHaveURL(/\/tickets$/);
  await expect(toast(page)).toContainText(/HR-\d{6} raised/);
  await expect(page.locator('table.t tbody tr.hl')).toContainText('October salary missing');
});

test('1b. raise form shows the artifact validation messages', async ({ page }) => {
  await openAs(page, 'u1');
  await page.locator('.mh-actions .btn.primary', { hasText: 'Raise ticket' }).click();
  await page.locator('.hdcard', { hasText: 'HR helpdesk' }).click();
  await page.locator('.dr-foot .btn.primary').click();
  await expect(page.locator('.fld.bad .err').first()).toHaveText('Choose a category.');
  await expect(toast(page)).toContainText('to submit');
});

test('2. agent changes status and replies', async ({ page }) => {
  await openAs(page, 'u21', '/ticket/IT-000041');
  await page.selectOption('#st-sel', 'Waiting for user');
  await expect(toast(page)).toContainText('Status changed to Waiting for user');
  await expect(page.locator('.dhead .pill')).toContainText('Waiting for user');
  await page.fill('#draft', 'Could you share a screenshot of the error?');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.locator('.feed .msg').last()).toContainText('Could you share a screenshot');
});

test('3. requester reply resumes the SLA clock', async ({ page }) => {
  await openAs(page, 'u1', '/ticket/IT-000052');
  await expect(page.locator('.banner.warn')).toContainText('needs more information from you');
  await expect(page.locator('.dhead .sla')).toContainText('Paused');
  await page.fill('#draft', 'Screenshot attached, it happens after every restart.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.locator('.banner.warn')).toHaveCount(0);
  await expect(page.locator('.dhead .sla')).not.toContainText('Paused');
});

test('4. agent escalates a ticket', async ({ page }) => {
  await openAs(page, 'u21', '/ticket/IT-000050');
  await page.getByRole('button', { name: /Escalate/ }).click();
  await page.getByRole('button', { name: 'Escalate to L3' }).click();
  await expect(page.locator('.dlg .err')).toHaveText('Give a reason so the next level has context.');
  await page.fill('#m-reason', 'VPN gateway needs a network team change.');
  await page.getByRole('button', { name: 'Escalate to L3' }).click();
  await expect(page.locator('.dhead')).toContainText('Escalated · Level 3');
});

test('5. manager then L&D approval', async ({ page }) => {
  await openAs(page, 'u6');
  const row = page.locator('.apsec tr', { hasText: 'LND-000048' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Approve' }).click();
  await expect(page.locator('.apsec tr', { hasText: 'LND-000048' })).toHaveCount(0);
  await openAs(page, 'u4', '/ticket/LND-000048');
  await expect(page.locator('.approval .astep').first()).toContainText('Approved');
  await page.locator('.box', { hasText: 'Approval' }).getByRole('button', { name: 'Approve' }).click();
  await expect(page.locator('.dhead .pill')).not.toContainText('Pending approval');
});

test('6. requester reopens a closed ticket', async ({ page }) => {
  await openAs(page, 'u1', '/ticket/HR-000098');
  await page.getByRole('button', { name: 'Reopen ticket' }).click();
  await page.getByRole('button', { name: 'Reopen', exact: true }).click();
  await expect(page.locator('.dlg .err')).toHaveText('Add a note so the agent knows what is still wrong.');
  await page.fill('#m-note', 'The letter still has the old designation.');
  await page.getByRole('button', { name: 'Reopen', exact: true }).click();
  await expect(page.locator('.dlg')).toHaveCount(0);
  await expect(page.locator('.dhead .pill')).not.toContainText('Closed');
});

test('7. follow and unfollow', async ({ page }) => {
  await openAs(page, 'u23', '/ticket/IT-000035');
  await page.getByRole('button', { name: 'Follow', exact: true }).click();
  await expect(toast(page)).toContainText('Following IT-000035');
  await page.goto('/following');
  const row = page.locator('table.t tr', { hasText: 'IT-000035' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Unfollow' }).click();
  await page.locator('.dlg').getByRole('button', { name: 'Unfollow' }).click();
  await expect(page.locator('table.t tr', { hasText: 'IT-000035' })).toHaveCount(0);
});

test('8. FAQ "No, raise a ticket" opens the form for that helpdesk', async ({ page }) => {
  await openAs(page, 'u1', '/faqs');
  await page.locator('.acc button').first().click();
  await page.getByRole('button', { name: 'No, raise a ticket' }).click();
  await expect(page.locator('.drawer .dr-head')).toContainText('HR');
  await expect(page.locator('#d-cat')).toBeVisible();
});

test('9. Sales sees Salesforce; Engineering does not', async ({ page }) => {
  await openAs(page, 'u2', '/tickets');
  await expect(page.locator('.seg[aria-label="Domain type"]')).toContainText('Salesforce');
  await openAs(page, 'u1', '/tickets');
  await expect(page.locator('.seg[aria-label="Domain type"]')).not.toContainText('Salesforce');
  await page.locator('.mh-actions .btn.primary', { hasText: 'Raise ticket' }).click();
  await expect(page.locator('.hdcard', { hasText: 'Salesforce' })).toHaveCount(0);
});

test('10. a forbidden ticket returns 403', async ({ page }) => {
  await openAs(page, 'u1', '/ticket/SF-00330');
  await expect(page.locator('.denied .code')).toHaveText('403');
  await expect(page.locator('.denied')).toContainText('Salesforce helpdesk is available only to Sales, Presales and Solutions');
  await openAs(page, 'u1', '/ticket/HR-000126');
  await expect(page.locator('.denied .code')).toHaveText('403');
});

test('11. layout fits a 400 px screen without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 860 });
  for (const [user, path] of [['u1', '/dashboard'], ['u1', '/tickets'], ['u1', '/ticket/IT-000050'], ['u1', '/faqs'], ['u1', '/history'], ['u20', '/admin'], ['u21', '/assigned']]) {
    await openAs(page, user, path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
