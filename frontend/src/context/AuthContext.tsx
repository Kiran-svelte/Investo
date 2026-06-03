import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AxiosError } from 'axios';
import api, {
  ApiResponse,
  AuthTokens,
  clearTokens,
  getAccessToken,
  getRefreshToken,
  isTransientAuthError,
  refreshAuthTokens,
  setTokens,
} from '../services/api';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export type UserRole = 'super_admin' | 'company_admin' | 'sales_agent' | 'operations' | 'viewer';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  company_id: string | null;
  must_change_password?: boolean;
}

export interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  mustChangePassword: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => void;
  refreshToken: () => Promise<void>;
  clearPasswordChangeRequirement: () => void;
}

// ──────────────────────────────────────────────
// Context
// ──────────────────────────────────────────────

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ──────────────────────────────────────────────
// Provider
// ──────────────────────────────────────────────

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Derived flag
  const isAuthenticated = user !== null;
  const mustChangePassword = user?.must_change_password === true;

  // Clear password change requirement after successful change
  const clearPasswordChangeRequirement = useCallback(() => {
    if (user) {
      setUser({ ...user, must_change_password: false });
    }
  }, [user]);

  // ── Validate an existing token on mount ──────

  const loadUser = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      setIsLoading(false);
      return;
    }

    const fetchMe = async (): Promise<AuthUser> => {
      const { data } = await api.get<ApiResponse<AuthUser>>('/auth/me');
      return data.data;
    };

    try {
      setUser(await fetchMe());
    } catch (err) {
      const status = (err as AxiosError)?.response?.status;

      // Expired access token: try refresh once before logging out
      if (status === 401 && getRefreshToken()) {
        try {
          const { access_token, refresh_token } = await refreshAuthTokens();
          setTokens(access_token, refresh_token);
          setUser(await fetchMe());
          return;
        } catch {
          /* fall through to session clear */
        }
      }

      // Keep session on cold-start / network blips (Render spin-up, timeouts)
      if (isTransientAuthError(err)) {
        setUser(null);
        return;
      }

      if (status === 401 || status === 403) {
        clearTokens();
      }
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  // ── Login ────────────────────────────────────

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post<
      ApiResponse<{ user: AuthUser; tokens: AuthTokens }>
    >('/auth/login', { email, password });

    const { user: loggedInUser, tokens } = data.data;

    setTokens(tokens.access_token, tokens.refresh_token);
    setUser(loggedInUser);
    return loggedInUser;
  }, []);

  // ── Logout ───────────────────────────────────

  const logout = useCallback(() => {
    const refreshToken = getRefreshToken();
    // Revoke only this browser session when possible (keeps other tabs/devices signed in)
    api
      .post('/auth/logout', refreshToken ? { refresh_token: refreshToken, refreshToken } : {})
      .catch(() => {
        /* best-effort */
      });
    clearTokens();
    setUser(null);
  }, []);

  // ── Refresh token ────────────────────────────

  const refreshToken = useCallback(async () => {
    const refreshTokenValue = getRefreshToken();
    if (!refreshTokenValue) {
      clearTokens();
      throw new Error('Refresh token missing');
    }

    const { access_token, refresh_token } = await refreshAuthTokens();
    setTokens(access_token, refresh_token);
  }, []);

  // ── Memoised context value ───────────────────

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      isAuthenticated,
      isLoading,
      mustChangePassword,
      login,
      logout,
      refreshToken,
      clearPasswordChangeRequirement,
    }),
    [user, isAuthenticated, isLoading, mustChangePassword, login, logout, refreshToken, clearPasswordChangeRequirement],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// ──────────────────────────────────────────────
// Hook
// ──────────────────────────────────────────────

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;
