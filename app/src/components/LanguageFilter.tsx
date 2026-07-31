import { cn } from '@/lib/utils';
import { say } from '@/lib/i18n';
import { chipsFor, endonym, shortCode, type LanguageFilter as Filter } from '@/lib/content-language';

/**
 * Narrow a shelf to one language.
 *
 * "All" is offered even when the site is in Spanish, because the default
 * being Spanish-only is a helpful starting point, not a wall — somebody who
 * reads both should be one click from seeing both.
 */
export default function LanguageFilter({
  value,
  onChange,
  present,
}: {
  value: Filter;
  onChange: (v: Filter) => void;
  /** the codes actually on this shelf, so dead chips are never offered */
  present: string[];
}) {
  const codes = chipsFor(present);
  return (
    <div
      className="flex w-fit overflow-hidden rounded-wobble-sm border-2 border-ink shadow-offset"
      role="group"
      aria-label={say('Filter by language')}
    >
      {(['all', ...codes] as Filter[]).map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-pressed={value === c}
          title={c === 'all' ? say('Every language') : endonym(c)}
          className={cn(
            'micro px-2 py-1 text-[0.6rem] font-bold transition-colors',
            value === c ? 'bg-yellow text-ink' : 'bg-paper-3 text-ink-soft hover:text-ink',
          )}
        >
          {c === 'all' ? say('All') : shortCode(c)}
        </button>
      ))}
    </div>
  );
}
