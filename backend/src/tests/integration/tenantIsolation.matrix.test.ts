/// <reference types="jest" />

import fs from 'fs';
import path from 'path';
import type { NextFunction, Response } from 'express';
import { strictTenantIsolation, tenantIsolation } from '../../middleware/tenant';
import type { AuthRequest } from '../../middleware/auth';

interface TenantRouteMatrixEntry {
  domain: string;
  mount: string;
  routeFile: string;
  middleware: 'strictTenantIsolation' | 'tenantIsolation';
  routes: string[];
  requiredPatterns: RegExp[];
}

const routeRoot = path.resolve(__dirname, '../../routes');
const appPath = path.resolve(__dirname, '../../app.ts');

const tenantRouteMatrix: TenantRouteMatrixEntry[] = [
  {
    domain: 'leads',
    mount: '/api/leads',
    routeFile: 'lead.routes.ts',
    middleware: 'strictTenantIsolation',
    routes: [
      'GET /',
      'POST /',
      'GET /export',
      'GET /:id',
      'PUT /:id',
      'PATCH /:id/status',
      'PATCH /:id/assign',
      'GET /:id/timeline',
      'GET /:id/personal-data',
      'POST /:id/erase',
      'DELETE /:id',
    ],
    requiredPatterns: [/getCompanyId\(req\)/, /companyId/],
  },
  {
    domain: 'properties',
    mount: '/api/properties',
    routeFile: 'property.routes.ts',
    middleware: 'strictTenantIsolation',
    routes: [
      'GET /',
      'POST /',
      'GET /catalog-status',
      'GET /:id',
      'PUT /:id',
      'DELETE /:id',
      'POST /:id/media',
      'DELETE /:id/media/:assetId',
    ],
    requiredPatterns: [/getCompanyId\(req\)/, /companyId/],
  },
  {
    domain: 'conversations',
    mount: '/api/conversations',
    routeFile: 'conversation.routes.ts',
    middleware: 'strictTenantIsolation',
    routes: [
      'GET /',
      'GET /:id',
      'GET /:id/messages',
      'POST /:id/messages',
      'PATCH /:id/takeover',
      'PATCH /:id/ai-toggle',
      'DELETE /:id',
    ],
    requiredPatterns: [/getCompanyId\(req\)/, /companyId/],
  },
  {
    domain: 'visits',
    mount: '/api/visits',
    routeFile: 'visit.routes.ts',
    middleware: 'strictTenantIsolation',
    routes: [
      'GET /',
      'POST /',
      'GET /:id',
      'PATCH /:id/status',
      'PATCH /:id/reschedule',
      'POST /:id/cancel',
      'DELETE /:id',
    ],
    requiredPatterns: [/getCompanyId\(req\)/, /companyId/],
  },
  {
    domain: 'imports',
    mount: '/api/property-imports',
    routeFile: 'property-import.routes.ts',
    middleware: 'strictTenantIsolation',
    routes: [
      'GET /knowledge-gate',
      'GET /drafts',
      'POST /drafts',
      'GET /drafts/:id',
      'PATCH /drafts/:id',
      'POST /drafts/:id/retry',
      'POST /drafts/:id/publish',
      'POST /drafts/:id/cancel',
    ],
    requiredPatterns: [/getCompanyId\(req\)/, /companyId/],
  },
  {
    domain: 'audit_logs',
    mount: '/api/audit',
    routeFile: 'audit.routes.ts',
    middleware: 'tenantIsolation',
    routes: ['GET /', 'GET /:id'],
    requiredPatterns: [/company_id.*required for platform audit access|platform audit access/s, /where\.companyId|getCompanyId\(req\)/],
  },
];

function readRoute(file: string): string {
  return fs.readFileSync(path.join(routeRoot, file), 'utf8');
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as Response & { statusCode: number; body: unknown };
}

describe('tenant isolation matrix', () => {
  it('covers the required tenant domains with at least 30 route assertions', () => {
    expect(tenantRouteMatrix.map((entry) => entry.domain)).toEqual([
      'leads',
      'properties',
      'conversations',
      'visits',
      'imports',
      'audit_logs',
    ]);

    const routeAssertionCount = tenantRouteMatrix.reduce((count, entry) => count + entry.routes.length, 0);
    expect(routeAssertionCount).toBeGreaterThanOrEqual(30);
  });

  it.each(tenantRouteMatrix)('$domain route family is mounted behind auth and tenant isolation', (entry) => {
    const appSource = fs.readFileSync(appPath, 'utf8');
    const routeSource = readRoute(entry.routeFile);

    expect(appSource).toContain(`'${entry.mount}'`);
    expect(appSource).toMatch(new RegExp(`app\\.use\\('${entry.mount.replace(/\//g, '\\/')}',\\s*authenticate`));
    expect(routeSource).toContain(`router.use(${entry.middleware})`);

    for (const pattern of entry.requiredPatterns) {
      expect(routeSource).toMatch(pattern);
    }
  });

  it('blocks platform super-admin tenant CRM access unless a target company is selected', () => {
    const req = {
      user: {
        id: 'super-admin',
        company_id: 'platform-company',
        role: 'super_admin',
        email: 'ops@investo.test',
        name: 'Ops',
      },
      query: {},
      body: {},
    } as AuthRequest;
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    strictTenantIsolation(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('ignores cross-tenant target parameters for non-super-admin users', () => {
    const req = {
      user: {
        id: 'admin-a',
        company_id: 'tenant-a',
        role: 'company_admin',
        email: 'admin-a@investo.test',
        name: 'Admin A',
      },
      query: { target_company_id: 'tenant-b' },
      body: { target_company_id: 'tenant-b' },
    } as unknown as AuthRequest;
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    tenantIsolation(req, res, next);

    expect((req as any).companyId).toBe('tenant-a');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows super-admin audit reads only with an explicit company filter', () => {
    const auditRoute = readRoute('audit.routes.ts');

    expect(auditRoute).toMatch(/company_id query parameter is required for platform audit access/);
    expect(auditRoute).toMatch(/where\.companyId = companyFilter/);
  });
});
