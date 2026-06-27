export type MockTeamUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  role: string;
  company_id: string;
  created_at: string;
  branch_id?: string | null;
  branch_name?: string | null;
};

export type MockAuthUser = {
  id: string;
  name: string;
  email: string;
  role: 'company_admin' | 'sales_agent' | 'operations' | 'viewer' | 'super_admin';
  company_id: string;
  phone?: string | null;
  profile_complete?: boolean;
  must_change_password?: boolean;
  org_branches_enabled?: boolean;
};

export const E2E_COMPANY_ID = 'e2e-company-001';

export const E2E_COMPANY_ADMIN: MockAuthUser = {
  id: 'e2e-admin-001',
  name: 'E2E Company Admin',
  email: 'e2e-admin@investo.test',
  role: 'company_admin',
  company_id: E2E_COMPANY_ID,
  phone: '+919876543210',
  profile_complete: true,
  must_change_password: false,
  org_branches_enabled: false,
};

export const E2E_VIEWER: MockAuthUser = {
  id: 'e2e-viewer-001',
  name: 'E2E Viewer',
  email: 'e2e-viewer@investo.test',
  role: 'viewer',
  company_id: E2E_COMPANY_ID,
  profile_complete: true,
  must_change_password: false,
  org_branches_enabled: false,
};

export const DEFAULT_TEAM_USERS: MockTeamUser[] = [
  {
    id: 'e2e-agent-existing',
    name: 'Existing Agent',
    email: 'existing.agent@investo.test',
    phone: '+919811111111',
    status: 'active',
    role: 'sales_agent',
    company_id: E2E_COMPANY_ID,
    created_at: '2026-01-01T00:00:00.000Z',
  },
];

export const ALL_FEATURES_ENABLED = [
  { key: 'ai_bot', enabled: true },
  { key: 'lead_automation', enabled: true },
  { key: 'visit_scheduling', enabled: true },
  { key: 'notifications', enabled: true },
  { key: 'agent_management', enabled: true },
  { key: 'conversation_center', enabled: true },
  { key: 'property_management', enabled: true },
  { key: 'analytics', enabled: true },
  { key: 'audit_logs', enabled: false },
  { key: 'csv_export', enabled: false },
];

export type InviteMockOptions = {
  authUser?: MockAuthUser;
  initialUsers?: MockTeamUser[];
  postDelayMs?: number;
  postFailStatus?: number;
  postFailBody?: Record<string, unknown>;
  postAbort?: boolean;
  duplicateEmails?: Set<string>;
};

export type InviteMockController = {
  users: MockTeamUser[];
  postRequestCount: number;
  resetPostCount: () => void;
};

function getApiPath(url: string): string {
  const marker = '/api/';
  const idx = url.indexOf(marker);
  if (idx === -1) {
    return '';
  }
  const tail = url.slice(idx + marker.length);
  const pathOnly = tail.split('?')[0];
  return `/api/${pathOnly}`;
}

function json(route: import('@playwright/test').Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

export async function installInviteApiMocks(
  page: import('@playwright/test').Page,
  options: InviteMockOptions = {},
): Promise<InviteMockController> {
  const authUser = options.authUser ?? E2E_COMPANY_ADMIN;
  const controller: InviteMockController = {
    users: [...(options.initialUsers ?? DEFAULT_TEAM_USERS)],
    postRequestCount: 0,
    resetPostCount: () => {
      controller.postRequestCount = 0;
    },
  };

  const duplicateEmails = options.duplicateEmails ?? new Set<string>();

  await page.route('**/socket.io/**', (route) => route.abort());
  await page.route('**/api/**', async (route) => {
    const apiPath = getApiPath(route.request().url());
    const method = route.request().method();

    if (apiPath === '/api/auth/me' && method === 'GET') {
      await json(route, 200, { success: true, data: authUser });
      return;
    }

    if (apiPath === '/api/features' && method === 'GET') {
      await json(route, 200, { success: true, data: ALL_FEATURES_ENABLED });
      return;
    }

    if (apiPath === '/api/onboarding/status' && method === 'GET') {
      await json(route, 200, {
        success: true,
        data: { completedSteps: [1, 2, 3, 4, 5, 6], stepCompleted: 6 },
      });
      return;
    }

    if (apiPath === '/api/users' && method === 'GET') {
      const teamMembers = controller.users.filter((user) =>
        ['sales_agent', 'operations'].includes(user.role),
      );
      await json(route, 200, {
        success: true,
        data: controller.users,
        pagination: {
          page: 1,
          limit: 25,
          total: controller.users.length,
          pages: 1,
        },
      });
      return;
    }

    if (apiPath === '/api/users' && method === 'POST') {
      controller.postRequestCount += 1;

      if (options.postAbort) {
        await route.abort('failed');
        return;
      }

      if (options.postDelayMs && options.postDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.postDelayMs));
      }

      if (options.postFailStatus) {
        await json(route, options.postFailStatus, options.postFailBody ?? { error: 'Failed to create user' });
        return;
      }

      let payload: Record<string, unknown> = {};
      try {
        payload = route.request().postDataJSON() as Record<string, unknown>;
      } catch {
        await json(route, 400, { error: 'Invalid request body' });
        return;
      }

      const email = String(payload.email ?? '').toLowerCase();
      const alreadyExists =
        duplicateEmails.has(email) ||
        controller.users.some((user) => user.email.toLowerCase() === email);

      if (alreadyExists) {
        await json(route, 409, { error: 'Email already registered' });
        return;
      }

      const created: MockTeamUser = {
        id: `e2e-user-${controller.postRequestCount}`,
        name: String(payload.name ?? 'New User'),
        email,
        phone: (payload.phone as string | null) ?? null,
        status: 'active',
        role: String(payload.role ?? 'sales_agent'),
        company_id: authUser.company_id,
        created_at: new Date().toISOString(),
        branch_id: (payload.branch_id as string | null) ?? null,
      };

      controller.users.push(created);
      duplicateEmails.add(email);

      await json(route, 201, {
        success: true,
        data: { id: created.id, email: created.email, role: created.role },
        id: created.id,
        warnings: [],
      });
      return;
    }

    if (apiPath === '/api/analytics/agents' && method === 'GET') {
      await json(route, 200, { success: true, data: [] });
      return;
    }

    if (apiPath.startsWith('/api/analytics/') && method === 'GET') {
      await json(route, 200, {
        success: true,
        data:
          apiPath === '/api/analytics/dashboard'
            ? {
                leads_today: 0,
                leads_total: 0,
                visits_scheduled: 0,
                visits_completed: 0,
                deals_closed: 0,
                conversion_rate: 0,
                ai_conversations: 0,
                revenue: 0,
              }
            : [],
      });
      return;
    }

    if (apiPath === '/api/notifications' && method === 'GET') {
      await json(route, 200, {
        success: true,
        data: { notifications: [], unreadCount: 0 },
      });
      return;
    }

    if (apiPath === '/api/auth/login' && method === 'POST') {
      await json(route, 200, {
        success: true,
        data: {
          user: authUser,
          tokens: {
            access_token: 'e2e-access-token',
            refresh_token: 'e2e-refresh-token',
          },
        },
      });
      return;
    }

    if (apiPath === '/api/auth/logout' && method === 'POST') {
      await json(route, 200, { success: true });
      return;
    }

    if (apiPath === '/api/auth/refresh' && method === 'POST') {
      await json(route, 200, {
        success: true,
        data: {
          access_token: 'e2e-access-token',
          refresh_token: 'e2e-refresh-token',
        },
      });
      return;
    }

    await json(route, 200, { success: true, data: [] });
  });

  return controller;
}

export async function seedBrowserSession(
  page: import('@playwright/test').Page,
  companyId: string = E2E_COMPANY_ID,
): Promise<void> {
  await page.goto('/');
  await page.evaluate((cid) => {
    localStorage.setItem('investo_access_token', 'e2e-access-token');
    localStorage.setItem('investo_refresh_token', 'e2e-refresh-token');
    localStorage.setItem(`investo:onboardingCompleted:${cid}`, '1');
  }, companyId);
}
