export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export function parsePagination(
  query: Record<string, unknown>,
  defaults: { page?: number; limit?: number; maxLimit?: number } = {},
): PaginationParams {
  const defaultPage = defaults.page ?? 1;
  const defaultLimit = defaults.limit ?? 25;
  const maxLimit = defaults.maxLimit ?? 100;

  const rawPage = parseInt(String(query.page ?? defaultPage), 10);
  const rawLimit = parseInt(String(query.limit ?? defaultLimit), 10);

  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : defaultPage;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, maxLimit)
    : defaultLimit;

  return {
    page,
    limit,
    offset: (page - 1) * limit,
  };
}

export function buildPaginationMeta(
  page: number,
  limit: number,
  total: number,
): PaginationMeta {
  return {
    page,
    limit,
    total,
    pages: total === 0 ? 1 : Math.ceil(total / limit),
  };
}

export function parseAgentListPagination(
  args: Record<string, unknown>,
  defaultLimit: number,
  maxLimit: number,
): { page: number; limit: number; offset: number } {
  const pageRaw = args.page ?? args.page_number;
  const limitRaw = args.limit ?? args.page_size ?? defaultLimit;
  const page = typeof pageRaw === 'number' && pageRaw > 0
    ? Math.floor(pageRaw)
    : parseInt(String(pageRaw ?? 1), 10) || 1;
  const limit = typeof limitRaw === 'number' && limitRaw > 0
    ? Math.min(Math.floor(limitRaw), maxLimit)
    : Math.min(parseInt(String(limitRaw), 10) || defaultLimit, maxLimit);

  return {
    page,
    limit,
    offset: (page - 1) * limit,
  };
}
