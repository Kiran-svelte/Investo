/// <reference types="jest" />

import { strictTenantIsolation, tenantIsolation } from '../../middleware/tenant';
import type { AuthRequest } from '../../middleware/auth';
import type { Response, NextFunction } from 'express';

function mockReq(overrides: Partial<AuthRequest> & { query?: Record<string, unknown> } = {}): AuthRequest {
  return {
    user: { id: 'u1', role: 'company_admin', company_id: 'company-a' },
    query: {},
    ...overrides,
  } as AuthRequest;
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
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe('tenant middleware', () => {
  it('tenantIsolation uses user company_id for tenant staff', () => {
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    tenantIsolation(req, res, next);

    expect((req as any).companyId).toBe('company-a');
    expect(next).toHaveBeenCalled();
  });

  it('tenantIsolation honors target_company_id for super_admin', () => {
    const req = mockReq({
      user: { id: 'sa', role: 'super_admin', company_id: 'platform-co' } as any,
      query: { target_company_id: 'tenant-b' },
    });
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    tenantIsolation(req, res, next);

    expect((req as any).companyId).toBe('tenant-b');
    expect(next).toHaveBeenCalled();
  });

  it('strictTenantIsolation rejects super_admin without target_company_id', () => {
    const req = mockReq({
      user: { id: 'sa', role: 'super_admin', company_id: 'platform-co' } as any,
    });
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    strictTenantIsolation(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('strictTenantIsolation scopes super_admin to target_company_id', () => {
    const req = mockReq({
      user: { id: 'sa', role: 'super_admin', company_id: 'platform-co' } as any,
      query: { target_company_id: 'tenant-c' },
    });
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    strictTenantIsolation(req, res, next);

    expect((req as any).companyId).toBe('tenant-c');
    expect(next).toHaveBeenCalled();
  });
});
