import { useCallback, useSyncExternalStore } from 'react';
import { trpc } from '@/providers/trpc';
import { authToken } from '@/lib/auth';
import { getLang } from '@/lib/i18n';
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
  // Shared token store — every useAuth() instance sees the same value, so the
  // header/sidebar flip to "signed in" the moment login() succeeds anywhere.
  const token = useSyncExternalStore(authToken.subscribe, authToken.get);

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
      await utils.invalidate();
      return res.user;
    },
    [utils],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      /* The new account starts in whatever language the sign-up form was
         being read in — nobody should have to find the switch twice. */
      const res = await utils.client.auth.register.mutate({
        name,
        email,
        password,
        language: getLang(),
      });
      authToken.set(res.token);
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
