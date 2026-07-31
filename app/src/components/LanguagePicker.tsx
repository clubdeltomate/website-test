import { Languages } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LANGS, say } from '@/lib/i18n';
import { useLang } from '@/hooks/useLang';

/**
 * Which language the site is in.
 *
 * A segmented switch rather than a dropdown: with two or three languages the
 * whole choice fits on screen, and a person who cannot read the current
 * language should not have to open a menu labelled in it to escape. The
 * codes are the words themselves — EN, ES — so the control is legible
 * whichever language you arrived speaking.
 *
 * It appears twice, in the top bar and in the rail, because the feed, the
 * card page and the marketing workbench drop the top bar on a wide screen.
 * A setting you can only reach from some pages is a setting people cannot
 * find.
 */
export default function LanguagePicker({ full = false }: { full?: boolean }) {
  const { lang, setLang } = useLang();

  return (
    <div
      className={cn(
        'flex items-center gap-1.5',
        full && 'rounded-wobble-sm border-2 border-dashed border-pencil px-2.5 py-1.5',
      )}
    >
      <Languages
        className={cn('shrink-0 text-ink-soft', full ? 'h-4 w-4' : 'h-3.5 w-3.5')}
        strokeWidth={2}
        aria-hidden
      />
      {full && (
        <span className="micro mr-auto text-[0.6rem] font-bold text-ink-soft">
          {say('Language')}
        </span>
      )}
      <div
        className="flex overflow-hidden rounded-wobble-sm border-2 border-ink shadow-offset"
        role="group"
        aria-label={say('Site language')}
      >
        {LANGS.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setLang(l.id)}
            aria-pressed={lang === l.id}
            /* The label names the language in that language — "Español", not
               "Spanish" — so it reads the same to everyone. */
            title={l.label}
            className={cn(
              'micro px-2 py-1 text-[0.6rem] font-bold transition-colors',
              lang === l.id ? 'bg-yellow text-ink' : 'bg-paper-3 text-ink-soft hover:text-ink',
            )}
          >
            {l.short}
          </button>
        ))}
      </div>
    </div>
  );
}
