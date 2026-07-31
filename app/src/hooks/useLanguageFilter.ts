import { useState } from 'react';
import { useLang } from '@/hooks/useLang';
import { defaultFilterFor, filterToQuery, type LanguageFilter } from '@/lib/content-language';

/**
 * The language a shelf is currently showing, and how to change it.
 *
 * The default follows the site's language — Spanish narrows to Spanish,
 * English shows everything — and it MOVES when the site's language moves.
 * That is the behaviour worth being deliberate about: switching the site to
 * Spanish has to hide the English posts straight away, not on the next
 * reload, or the setting looks like it did not take.
 *
 * Derived during render rather than in an effect, so the shelf never paints
 * one frame of the old language's results.
 */
export function useLanguageFilter() {
  const { lang } = useLang();
  const [state, setState] = useState<{ lang: string; filter: LanguageFilter }>(() => ({
    lang,
    filter: defaultFilterFor(lang),
  }));
  if (state.lang !== lang) setState({ lang, filter: defaultFilterFor(lang) });

  return {
    filter: state.filter,
    setFilter: (filter: LanguageFilter) => setState({ lang, filter }),
    /** what to send the server: undefined means "do not narrow" */
    query: filterToQuery(state.filter),
  };
}
