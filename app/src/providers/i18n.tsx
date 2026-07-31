import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { LANGS, applyLang, getLang, type Lang } from '@/lib/i18n';
import { LangContext } from '@/hooks/useLang';
import { useAuth } from '@/hooks/useAuth';
import { trpc } from '@/providers/trpc';

/* Which language the site is in.
 *
 * The language is applied during this component's render, before any child
 * renders, so `say()` — a plain function, callable from anywhere a string is
 * produced — is already correct by the time the tree below asks for a word.
 * The state exists to force that re-render; the module variable is what does
 * the work.
 *
 * Where the answer comes from, in order of who wins:
 *
 *   1. The signed-in account. Whatever you last read the site in follows you
 *      to another machine and to next week.
 *   2. A choice stored in this browser. Covers signed-out visitors, and is
 *      what a new account is seeded with at sign-up.
 *   3. The browser's own language, so somebody on a Spanish machine does not
 *      have to find an English menu to escape English.
 */

const KEY = 'sketchlearn.lang';

const isLang = (v: unknown): v is Lang => LANGS.some((l) => l.id === v);

/** What language to open in before we know who is reading. */
function initialLang(): Lang {
  if (typeof window === 'undefined') return 'en';
  const saved = window.localStorage.getItem(KEY);
  if (isLang(saved)) return saved;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.slice(0, 2).toLowerCase();
    if (isLang(base)) return base;
  }
  return 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const remember = trpc.auth.setLanguage.useMutation();
  /* `syncedFor` is the account the language has already been taken from. It
     goes back to null on sign-out, so the next sign-in adopts that account's
     language instead of leaving the previous reader's showing. */
  const [state, setState] = useState<{ lang: Lang; syncedFor: number | null }>(() => ({
    lang: initialLang(),
    syncedFor: null,
  }));

  /* Adopting the account's language during this component's own render is
     legal React, and it is the reason this provider sits inside the tRPC one
     rather than above it. In an effect it would paint one frame of the wrong
     language on every sign-in. */
  if (user && state.syncedFor !== user.id) {
    setState({ lang: isLang(user.language) ? user.language : state.lang, syncedFor: user.id });
  } else if (!user && state.syncedFor !== null) {
    setState({ lang: state.lang, syncedFor: null });
  }

  const { lang } = state;
  // Before the children render, not in an effect after them.
  if (getLang() !== lang) applyLang(lang);

  useEffect(() => {
    document.documentElement.lang = lang;
    window.localStorage.setItem(KEY, lang);
  }, [lang]);

  const setLang = useCallback(
    (l: Lang) => {
      applyLang(l);
      setState((s) => ({ ...s, lang: l }));
      /* Written to the account on the flip itself. The switch IS the setting;
         a preference that has to be confirmed on some other screen is one
         people lose. A failure here is not worth a toast — the browser copy
         already holds the choice and the next flip will try again. */
      if (user) remember.mutate({ language: l });
    },
    [user, remember],
  );

  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}
