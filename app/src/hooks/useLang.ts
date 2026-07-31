import { createContext, useContext } from 'react';
import type { Lang } from '@/lib/i18n';

/* The language context lives here rather than beside the provider so that
 * providers/i18n.tsx exports a component and nothing else — the rule that
 * keeps fast refresh working. */

export interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
}

export const LangContext = createContext<LangCtx>({ lang: 'en', setLang: () => {} });

/** The language the site is in, and how to change it. */
export const useLang = (): LangCtx => useContext(LangContext);
