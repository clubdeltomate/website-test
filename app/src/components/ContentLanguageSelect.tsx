import { LANGUAGES } from '@contracts/languages';
import { cn } from '@/lib/utils';
import { say } from '@/lib/i18n';
import { shortCode } from '@/lib/content-language';

/**
 * What language this thing is written in.
 *
 * Offered where work is made and where it is edited, because the site
 * language is only a guess at what somebody is about to write — an admin
 * reading in Spanish may well be building an English course, and until they
 * can say so their work lands on the wrong shelf and stays there.
 *
 * Every language the generator can write in, not just the two the interface
 * speaks: a French deck is a real thing to make here, it just shares the
 * English shelf.
 */
export default function ContentLanguageSelect({
  value,
  onChange,
  label = 'Language of the content',
  className,
  disabled,
}: {
  value: string;
  onChange: (code: string) => void;
  label?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="micro text-[0.6rem] font-semibold text-ink-soft">{say(label)}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-label={say(label)}
        className="rounded-wobble-sm border-2 border-ink bg-paper-3 px-2.5 py-2 text-sm text-ink shadow-offset outline-none focus:border-blue disabled:opacity-50"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {shortCode(l.code)} · {l.endonym}
          </option>
        ))}
      </select>
    </label>
  );
}
