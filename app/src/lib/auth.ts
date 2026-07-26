/**
 * Auth token storage — the tRPC provider reads this on every request
 * (see src/providers/trpc.tsx headers option).
 */
const TOKEN_KEY = 'sketchlearn.auth.token';

export const authToken = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* storage unavailable */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable */
    }
  },
};

export function getAuthHeaders(): Record<string, string> {
  const token = authToken.get();
  return token ? { authorization: `Bearer ${token}` } : {};
}
