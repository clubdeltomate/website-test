/**
 * Auth token storage — the tRPC provider reads this on every request
 * (see src/providers/trpc.tsx headers option).
 *
 * The token is a single module-level value with subscribe/notify so every
 * `useAuth()` instance shares it (via useSyncExternalStore). Keeping it in
 * per-hook useState caused the classic stale-header bug: signing in updated
 * only the Auth page's copy, and the rest of the UI stayed "signed out"
 * until a full page reload.
 */
const TOKEN_KEY = 'sketchlearn.auth.token';

function readStorage(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

let current: string | null = readStorage();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

// Another tab signing in/out updates this tab's UI too.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === TOKEN_KEY && e.newValue !== current) {
      current = e.newValue;
      emit();
    }
  });
}

export const authToken = {
  get(): string | null {
    return current;
  },
  set(token: string) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* storage unavailable — keep the in-memory value for this session */
    }
    current = token;
    emit();
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable */
    }
    current = null;
    emit();
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export function getAuthHeaders(): Record<string, string> {
  const token = authToken.get();
  return token ? { authorization: `Bearer ${token}` } : {};
}
