import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { LANGS, applyLang, getLang, type Lang } from '@/lib/i18n';
import { LangContext } from '@/hooks/useLang';

/* Which language the site is in.
 *
 * The language is applied during this component's render, before any child
 * renders, so `say()` — a plain function, callable from anywhere a string is
 * produced — is already correct by the time the tree below asks for a word.
 * The state exists to force that re-render; the module variable is what does
 * the work.
 */

const KEY = 'sketchlearn.lang';

const isLang = (v: unknown): v is Lang => LANGS.some((l) => l.id === v);

/**
 * What language to open in.
 *
 * A stored choice wins — it was made on purpose. Otherwise the browser's own
 * preference decides, because somebody arriving with a Spanish machine should
 * not have to find a menu to read the page.
 */
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
  const [lang, setLangState] = useState<Lang>(initialLang);
  // Before the children render, not in an effect after them.
  if (getLang() !== lang) applyLang(lang);

  useEffect(() => {
    document.documentElement.lang = lang;
    window.localStorage.setItem(KEY, lang);
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    applyLang(l);
    setLangState(l);
  }, []);

  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}
