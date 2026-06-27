import { expect, test, type Page, type Route } from '@playwright/test';
import { assertNoFatalUi } from './helpers/inviteUi';

const SUPER_ADMIN = {
  id: 'platform-admin-e2e',
  name: 'Platform Admin',
  email: 'platform-admin@investo.test',
  role: 'super_admin',
  company_id: 'platform-company',
  phone: '+919900000000',
  profile_complete: true,
  must_change_password: false,
  org_branches_enabled: false,
};

const TENANT = {
  id: 'tenant-company-1',
  name: 'Tenant Alpha',
  slug: 'tenant-alpha',
  status: 'active',
  whatsappPhone: '+919911111111',
  planId: null,
  plan_name: null,
  max_agents: null,
  price_monthly: null,
  agent_count: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function getApiPath(url: string): string {
  const marker = '/api/';
  const idx = url.indexOf(marker);
  if (idx === -1) return '';
  return `/api/${url.slice(idx + marker.length).split('?')[0]}`;
}

function getQuery(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

async function json(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function installPlatformAdminMocks(page: Page): Promise<{
  governanceUrls: string[];
  notificationUrls: string[];
  onboardingSetupUrls: string[];
}> {
  const calls = {
    governanceUrls: [] as string[],
    notificationUrls: [] as string[],
    onboardingSetupUrls: [] as string[],
  };

  await page.route('**/socket.io/**', (route) => route.abort());
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const apiPath = getApiPath(url);
    const method = route.request().method();
    const query = getQuery(url);

    if (apiPath === '/api/auth/me' && method === 'GET') {
      await json(route, 200, { success: true, data: SUPER_ADMIN });
      return;
    }

    if (apiPath === '/api/auth/refresh' && method === 'POST') {
      await json(route, 200, {
        success: true,
        data: { access_token: 'e2e-access-token', refresh_token: 'e2e-refresh-token' },
      });
      return;
    }

    if (apiPath === '/api/features' && method === 'GET') {
      await json(route, 200, { success: true, data: [] });
      return;
    }

    if (apiPath === '/api/companies' && method === 'GET') {
      await json(route, 200, {
        success: true,
        data: [TENANT],
        pagination: { page: 1, limit: 25, total: 1, pages: 1 },
      });
      return;
    }

    if (apiPath.startsWith('/api/governance') && method === 'GET') {
      calls.governanceUrls.push(url);
      expect(query.get('target_company_id')).toBe(TENANT.id);
      if (apiPath === '/api/governance/prompts') {
        await json(route, 200, { versions: [], enabled: true });
        return;
      }
      await json(route, 200, { items: [], enabled: true, threshold: 70 });
      return;
    }

    if (apiPath === '/api/notifications' && method === 'GET') {
      calls.notificationUrls.push(url);
      expect(query.get('target_company_id')).toBe(TENANT.id);
      await json(route, 200, {
        success: true,
        data: { notifications: [], unreadCount: 0 },
      });
      return;
    }

    if (apiPath === '/api/onboarding/setup' && method === 'GET') {
      calls.onboardingSetupUrls.push(url);
      await json(route, 500, { error: 'settings should not call tenant setup for platform admin' });
      return;
    }

    if (apiPath === '/api/billing-admin/overview' && method === 'GET') {
      await json(route, 200, { data: [] });
      return;
    }

    if (apiPath === '/api/agency-invites' && method === 'GET') {
      await json(route, 200, { data: [] });
      return;
    }

    await json(route, 200, { success: true, data: [] });
  });

  return calls;
}

async function seedSession(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('investo_access_token', 'e2e-access-token');
    localStorage.setItem('investo_refresh_token', 'e2e-refresh-token');
  });
}

test.describe('platform admin tenant context', () => {
  test('gates tenant APIs until an agency is selected, then scopes calls to that agency', async ({ page }) => {
    const calls = await installPlatformAdminMocks(page);
    await seedSession(page);

    await page.goto('/dashboard/ai-governance');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /select an agency before opening ai governance/i })).toBeVisible();
    expect(calls.governanceUrls).toEqual([]);
    expect(calls.notificationUrls).toEqual([]);
    await assertNoFatalUi(page);

    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/Platform admin: manage agencies under/i)).toBeVisible();
    expect(calls.onboardingSetupUrls).toEqual([]);
    await assertNoFatalUi(page);

    await page.goto('/dashboard/companies');
    await page.waitForLoadState('networkidle');
    await page.locator('select').first().selectOption(TENANT.id);
    await expect(page.getByText(/Active tenant:/i)).toBeVisible();

    await page.goto('/dashboard/ai-governance');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /AI Governance/i })).toBeVisible();
    expect(calls.governanceUrls.length).toBeGreaterThanOrEqual(2);
    expect(calls.governanceUrls.every((url) => getQuery(url).get('target_company_id') === TENANT.id)).toBe(true);
    expect(calls.notificationUrls.every((url) => getQuery(url).get('target_company_id') === TENANT.id)).toBe(true);
    await assertNoFatalUi(page);
  });

  test('mobile shell exposes tenant selector for platform admin', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installPlatformAdminMocks(page);
    await seedSession(page);

    await page.goto('/dashboard/companies');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /open menu/i }).click();
    const mobileSidebar = page.getByRole('complementary');
    await expect(mobileSidebar.getByText(/Tenant context/i)).toBeVisible();
    await expect(mobileSidebar.locator('select')).toBeVisible();
  });
});
