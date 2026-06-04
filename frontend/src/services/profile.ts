import api, { ApiResponse } from './api';
import { formatIndianPhoneForApi } from '../utils/indianPhone';
import type { AuthUser } from '../context/AuthContext';

export async function saveStaffProfile(input: {
  userId: string;
  name: string;
  phoneLocal: string;
}): Promise<AuthUser> {
  const phone = formatIndianPhoneForApi(input.phoneLocal);
  if (!phone) {
    throw new Error('Enter a valid Indian mobile number (10 digits).');
  }

  const body = { name: input.name.trim(), phone };

  try {
    const { data } = await api.put<ApiResponse<AuthUser>>('/auth/profile', body);
    return data.data;
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status !== 404) {
      throw err;
    }
    const { data } = await api.put<{ data: AuthUser }>(`/users/${input.userId}`, body);
    const row = data.data;
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role as AuthUser['role'],
      company_id: row.company_id ?? (row as { companyId?: string }).companyId ?? null,
      phone: row.phone,
      profile_complete: Boolean(row.phone),
      must_change_password: row.must_change_password,
    };
  }
}
