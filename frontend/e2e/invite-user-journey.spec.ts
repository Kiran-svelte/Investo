import { expect, test } from '@playwright/test';
import { loginIfConfigured } from './helpers';
import {
  E2E_COMPANY_ADMIN,
  E2E_VIEWER,
  installInviteApiMocks,
  seedBrowserSession,
} from './helpers/inviteFixtures';
import {
  assertNoFatalUi,
  attachConsoleErrorGuard,
  fillInviteForm,
  logoutFromShell,
  openAddTeamMemberModal,
  submitInviteForm,
} from './helpers/inviteUi';

test.describe('Invite User - Sunny Day (happy path)', () => {
  test('login to invite to list updates to dashboard to logout', async ({ page }) => {
    test.setTimeout(60_000);
    const guard = attachConsoleErrorGuard(page);
    const controller = await installInviteApiMocks(page);
    await seedBrowserSession(page);

    await page.goto('/dashboard/agents');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /add team member/i })).toBeVisible();

    await page.getByRole('button', { name: /add team member/i }).click();
    await fillInviteForm(page, {
      name: 'Sunny Day Agent',
      email: 'sunny.agent@investo.test',
      password: 'Password123!',
      phone: '+919822222222',
    });
    await submitInviteForm(page);

    await expect(page.getByRole('heading', { name: /add team member/i })).toHaveCount(0);
    await expect(page.getByText('sunny.agent@investo.test')).toBeVisible();
    expect(controller.postRequestCount).toBe(1);

    const totalAgentsBeforeNav = await page.getByText('Total Agents').locator('..').locator('p.text-2xl').textContent();

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await assertNoFatalUi(page);

    await page.goto('/dashboard/agents');
    await expect(page.getByText('sunny.agent@investo.test')).toBeVisible();

    const totalAgentsAfterReturn = await page.getByText('Total Agents').locator('..').locator('p.text-2xl').textContent();
    expect(Number(totalAgentsAfterReturn)).toBeGreaterThanOrEqual(Number(totalAgentsBeforeNav));

    await logoutFromShell(page);

    expect(guard.errors).toEqual([]);
  });
});

test.describe('Invite User - Rainy Day (expected errors)', () => {
  test('empty email blocks submit with browser validation', async ({ page }) => {
    const controller = await installInviteApiMocks(page);
    await seedBrowserSession(page);
    await openAddTeamMemberModal(page);

    await page.getByPlaceholder('Asha Mehta').fill('No Email User');
    await page.getByPlaceholder('asha@company.com').fill('');
    await page.getByPlaceholder('Min 8 characters').fill('Password123!');
    await submitInviteForm(page);

    const validationMessage = await page.getByPlaceholder('asha@company.com').evaluate(
      (el) => (el as HTMLInputElement).validationMessage,
    );
    expect(validationMessage.length).toBeGreaterThan(0);
    expect(controller.postRequestCount).toBe(0);
  });

  test('invalid email format is rejected by the browser', async ({ page }) => {
    const controller = await installInviteApiMocks(page);
    await seedBrowserSession(page);
    await openAddTeamMemberModal(page);

    await fillInviteForm(page, {
      name: 'Bad Email User',
      email: 'not-an-email',
      password: 'Password123!',
      phone: '+919833333333',
    });
    await submitInviteForm(page);

    const validationMessage = await page.getByPlaceholder('asha@company.com').evaluate(
      (el) => (el as HTMLInputElement).validationMessage,
    );
    expect(validationMessage.length).toBeGreaterThan(0);
    expect(controller.postRequestCount).toBe(0);
  });

  test('duplicate email shows server rejection message', async ({ page }) => {
    await installInviteApiMocks(page, {
      duplicateEmails: new Set(['existing.agent@investo.test']),
    });
    await seedBrowserSession(page);
    await openAddTeamMemberModal(page);

    await fillInviteForm(page, {
      name: 'Duplicate Agent',
      email: 'existing.agent@investo.test',
      password: 'Password123!',
      phone: '+919844444444',
    });
    await submitInviteForm(page);

    await expect(page.getByText(/email already registered/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: /add team member/i })).toBeVisible();
  });

  test('sales agent without phone shows staff phone validation error', async ({ page }) => {
    await installInviteApiMocks(page);
    await seedBrowserSession(page);
    await openAddTeamMemberModal(page);

    await fillInviteForm(page, {
      name: 'No Phone Agent',
      email: 'nophone@investo.test',
      password: 'Password123!',
      phone: '',
    });
    await submitInviteForm(page);

    await expect(page.getByText(/phone number is required for staff/i)).toBeVisible();
  });
});

test.describe('Invite User - Hurricane Day (chaos & failure)', () => {
  test('Scenario A - mid-action exit does not crash the app', async ({ page }) => {
    const guard = attachConsoleErrorGuard(page);
    await installInviteApiMocks(page);
    await seedBrowserSession(page);
    await openAddTeamMemberModal(page);

    await page.getByPlaceholder('Asha Mehta').fill('Partial Invite');
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await assertNoFatalUi(page);
    await expect(page.getByRole('heading', { name: /add team member/i })).toHaveCount(0);
    expect(guard.errors).toEqual([]);
  });

  test('Scenario B - spam clicking Create sends only one invite', async ({ page }) => {
    const controller = await installInviteApiMocks(page, { postDelayMs: 1500 });
    await seedBrowserSession(page);
    await openAddTeamMemberModal(page);

    await fillInviteForm(page, {
      name: 'Spam Test Agent',
      email: 'spam.test@investo.test',
      password: 'Password123!',
      phone: '+919855555555',
    });

    await page.evaluate(() => {
      const button = document.querySelector('.investo-modal-panel button[type="submit"]');
      for (let i = 0; i < 10; i += 1) {
        (button as HTMLButtonElement | null)?.click();
      }
    });

    await expect(page.getByText('spam.test@investo.test')).toBeVisible({ timeout: 20_000 });
    expect(controller.postRequestCount).toBe(1);
  });

  test('Scenario C - network failure shows error, not infinite spinner', async ({ page }) => {
    await installInviteApiMocks(page, { postAbort: true });
    await seedBrowserSession(page);
    await openAddTeamMemberModal(page);

    await fillInviteForm(page, {
      name: 'Offline Agent',
      email: 'offline.agent@investo.test',
      password: 'Password123!',
      phone: '+919866666666',
    });

    const createButton = page.getByRole('button', { name: /^create$/i });
    await submitInviteForm(page);

    await expect(page.getByText(/network error|failed to create user|request failed/i)).toBeVisible({ timeout: 15_000 });
    await expect(createButton).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /add team member/i })).toBeVisible();
  });

  test('Scenario D - server 500 shows friendly error in the modal', async ({ page }) => {
    await installInviteApiMocks(page, {
      postFailStatus: 500,
      postFailBody: { error: 'Failed to create user' },
    });
    await seedBrowserSession(page);
    await openAddTeamMemberModal(page);

    await fillInviteForm(page, {
      name: 'Server Error Agent',
      email: 'server.error@investo.test',
      password: 'Password123!',
      phone: '+919877777777',
    });
    await submitInviteForm(page);

    await expect(page.getByText(/failed to create user/i)).toBeVisible();
    await assertNoFatalUi(page);
  });

  test('Scenario E - invited user appears immediately without manual refresh', async ({ page }) => {
    const controller = await installInviteApiMocks(page);
    await seedBrowserSession(page);
    await openAddTeamMemberModal(page);

    const invitesBefore = controller.users.length;

    await fillInviteForm(page, {
      name: 'Immediate Sync Agent',
      email: 'immediate.sync@investo.test',
      password: 'Password123!',
      phone: '+919888888888',
    });
    await submitInviteForm(page);

    await expect(page.getByText('immediate.sync@investo.test')).toBeVisible();
    expect(controller.users.length).toBe(invitesBefore + 1);
    await expect(page.getByRole('heading', { name: /add team member/i })).toHaveCount(0);
  });

  test('navigating away while invite is processing does not crash', async ({ page }) => {
    const guard = attachConsoleErrorGuard(page);
    await installInviteApiMocks(page, { postDelayMs: 1200 });
    await seedBrowserSession(page);
    await openAddTeamMemberModal(page);

    await fillInviteForm(page, {
      name: 'Mid Flight Agent',
      email: 'midflight@investo.test',
      password: 'Password123!',
      phone: '+919899999999',
    });
    await submitInviteForm(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await assertNoFatalUi(page);
    expect(guard.errors).toEqual([]);
  });

  test('viewer role cannot access invite UI - permission denied', async ({ page }) => {
    await installInviteApiMocks(page, { authUser: E2E_VIEWER });
    await seedBrowserSession(page, E2E_VIEWER.company_id);
    await page.goto('/dashboard/agents');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/not available for your role/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /add team member/i })).toHaveCount(0);
  });
});

test.describe('Invite User - Live API journey', () => {
  test('company admin can complete invite journey against real backend', async ({ page }) => {
    await loginIfConfigured(page);

    const uniqueEmail = `e2e.invite.${Date.now()}@investo.test`;
    await page.goto('/dashboard/agents');
    await page.waitForLoadState('networkidle');

    const addButton = page.getByRole('button', { name: /add team member/i });
    const hasInviteAccess = await addButton.isVisible().catch(() => false);
    test.skip(!hasInviteAccess, 'Current E2E user cannot access team invite');

    await addButton.click();
    await fillInviteForm(page, {
      name: 'Live E2E Agent',
      email: uniqueEmail,
      password: 'Password123!',
      phone: '+919800000001',
    });
    await submitInviteForm(page);

    await expect(page.getByText(uniqueEmail)).toBeVisible({ timeout: 20_000 });
    await assertNoFatalUi(page);
  });
});
