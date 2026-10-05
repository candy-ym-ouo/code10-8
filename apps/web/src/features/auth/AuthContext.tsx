import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setAccessToken, setRefreshHandler } from '../../api/client';
import type { Membership, SessionResponse, User } from '../../api/types';

interface AuthState {
  user: User | null;
  memberships: Membership[];
  status: 'loading' | 'ready';
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  reloadMemberships: () => Promise<Membership[]>;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, memberships: [], status: 'loading' });

  const applySession = useCallback((session: SessionResponse) => {
    setAccessToken(session.accessToken);
    setState({ user: session.user, memberships: session.memberships, status: 'ready' });
  }, []);

  /** 用 httpOnly Cookie 换新的 access token；页面刷新后靠它恢复登录态。 */
  const refreshSession = useCallback(async (): Promise<boolean> => {
    try {
      const session = await api<SessionResponse>('/auth/refresh', { method: 'POST', skipRetry: true });
      applySession(session);
      return true;
    } catch {
      setAccessToken(null);
      setState({ user: null, memberships: [], status: 'ready' });
      return false;
    }
  }, [applySession]);

  useEffect(() => {
    setRefreshHandler(refreshSession);
    void refreshSession();
  }, [refreshSession]);

  const login = useCallback(
    async (email: string, password: string) => {
      const session = await api<SessionResponse>('/auth/login', { method: 'POST', body: { email, password } });
      applySession(session);
    },
    [applySession],
  );

  const register = useCallback(
    async (email: string, password: string, displayName: string) => {
      const session = await api<SessionResponse>('/auth/register', {
        method: 'POST',
        body: { email, password, displayName },
      });
      applySession(session);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
      setState({ user: null, memberships: [], status: 'ready' });
    }
  }, []);

  const reloadMemberships = useCallback(async () => {
    const data = await api<{ user: User; memberships: Membership[] }>('/auth/me');
    setState((prev) => ({ ...prev, user: data.user, memberships: data.memberships }));
    return data.memberships;
  }, []);

  const updateUser = useCallback((user: User) => {
    setState((prev) => ({ ...prev, user }));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, register, logout, reloadMemberships, updateUser }),
    [state, login, register, logout, reloadMemberships, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}

