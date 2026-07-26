import { useCallback, useState } from 'react';
import { trpc } from '@/providers/trpc';
import { authToken } from '@/lib/auth';
import type { Role, SessionUser } from '@contracts/types';

export interface UseAuth {
  user: SessionUser | null;
  isLoading: boolean;
  isGuest: boolean;
  role: Role | null;
  token: string | null;
  login: (email: string, password: string) => Promise<SessionUser>;
  register: (name: string, email: string, password: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
  refetch: () => void;
}

/**
 * Central auth hook. Token lives in localStorage (src/lib/auth) and is
 * attached to every tRPC call by the provider's headers option.
 */
export function useAuth(): UseAuth {
  const utils = trpc.useUtils();
  const [token, setToken] = useState<string | null>(() => authToken.get());

  const me = trpc.auth.me.useQuery(undefined, {
    enabled: !!token,
    retry: false,
    staleTime: 30_000,
  });

  const user = token ? (me.data ?? null) : null;

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await utils.client.auth.login.mutate({ email, password });
      authToken.set(res.token);
      setToken(res.token);
      await utils.invalidate();
      return res.user;
    },
    [utils],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const res = await utils.client.auth.register.mutate({ name, email, password });
      authToken.set(res.token);
      setToken(res.token);
      await utils.invalidate();
      return res.user;
    },
    [utils],
  );

  const logout = useCallback(async () => {
    try {
      await utils.client.auth.logout.mutate();
    } catch {
      /* stateless JWT — client-side clear is authoritative */
    }
    authToken.clear();
    setToken(null);
    await utils.invalidate();
  }, [utils]);

  return {
    user,
    isLoading: !!token && me.isLoading,
    isGuest: !user,
    role: user?.role ?? null,
    token,
    login,
    register,
    logout,
    refetch: () => void me.refetch(),
  };
}
