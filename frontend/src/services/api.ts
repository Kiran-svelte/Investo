import axios, {
  AxiosError,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';

// ──────────────────────────────────────────────
// Shared response / error types
// ──────────────────────────────────────────────

/** Standard envelope returned by every API endpoint. */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  message?: string;
}

/** Shape of a validation / server error payload. */
export interface ApiError {
  success: false;
  message: string;
  errors?: Record<string, string[]>;
}

/** Tokens returned by the auth endpoints. */
export interface AuthTokens {
  access_token: string;
  refresh_token: string;
}

// ──────────────────────────────────────────────
// Local-storage helpers
// ──────────────────────────────────────────────

const TOKEN_KEY = 'investo_access_token';
const REFRESH_KEY = 'investo_refresh_token';

export const getAccessToken = (): string | null =>
  localStorage.getItem(TOKEN_KEY);

export const getRefreshToken = (): string | null =>
  localStorage.getItem(REFRESH_KEY);

export const setTokens = (access: string, refresh: string): void => {
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
};

export const clearTokens = (): void => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
};

export const refreshAuthTokens = async (): Promise<AuthTokens> => {
  const refreshToken = getRefreshToken();

  if (!refreshToken) {
    throw new Error('Refresh token missing');
  }

  const { data } = await api.post<ApiResponse<AuthTokens>>('/auth/refresh', {
    refresh_token: refreshToken,
    refreshToken,
  });

  return data.data;
};

// ──────────────────────────────────────────────
// Axios instance
// ──────────────────────────────────────────────

const getApiBaseUrl = (): string => {
  const envApiUrl = (import.meta as any).env?.VITE_API_URL as string | undefined;

  if (envApiUrl && envApiUrl.trim()) {
    return envApiUrl.replace(/\/$/, '').replace(/\/api$/, '/api');
  }

  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return '/api';
    }
  }

  return 'https://investo-backend-v2.onrender.com/api';
};

const api: AxiosInstance = axios.create({
  baseURL: getApiBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15_000,
});

// ──────────────────────────────────────────────
// Request interceptor – attach JWT
// ──────────────────────────────────────────────

api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = getAccessToken();
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error: AxiosError) => Promise.reject(error),
);

// ──────────────────────────────────────────────
// Response interceptor – handle 401 & auto-refresh
// ──────────────────────────────────────────────

let isRefreshing = false;
let failedQueue: {
  resolve: (token: string) => void;
  reject: (err: AxiosError) => void;
}[] = [];

const processQueue = (error: AxiosError | null, token: string | null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token!);
    }
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    // Only attempt refresh for 401 responses on non-auth endpoints
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/login') &&
      !originalRequest.url?.includes('/auth/refresh')
    ) {
      if (isRefreshing) {
        // Queue this request until the refresh completes
        return new Promise<AxiosResponse>((resolve, reject) => {
          failedQueue.push({
            resolve: (token: string) => {
              if (originalRequest.headers) {
                originalRequest.headers.Authorization = `Bearer ${token}`;
              }
              resolve(api(originalRequest));
            },
            reject: (err: AxiosError) => {
              reject(err);
            },
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const { access_token, refresh_token } = await refreshAuthTokens();
        setTokens(access_token, refresh_token);

        processQueue(null, access_token);

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${access_token}`;
        }
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError as AxiosError, null);
        clearTokens();
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

export default api;
