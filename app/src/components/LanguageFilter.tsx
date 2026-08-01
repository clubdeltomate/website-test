import { cn } from '@/lib/utils';
import { say } from '@/lib/i18n';
import { endonym, shortCode, type LanguageFilter as Filter } from '@/lib/content-language';

/**
 * Which shelf you are reading: everything, or Spanish only.
 *
 * Two chips, not three. EN already means everything — English plus French
 * plus anything else that is not Spanish — so a separate "All" would be the
 * same button twice. ES is the exclusive one: Spanish work and nothing else.
 */
const CHOICES: { id: Filter; hint: string }[] = [
  { id: 'en', hint: 'English and every other language' },
  { id: 'es', hint: 'Spanish only' },
];

export default function LanguageFilter({
  value,
  onChange,
}: {
  value: Filter;
  onChange: (v: Filter) => void;
}) {
  return (
    <div
      className="flex w-fit overflow-hidden rounded-wobble-sm border-2 border-ink shadow-offset"
      role="group"
      aria-label={say('Filter by language')}
    >
      {CHOICES.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onChange(c.id)}
          aria-pressed={value === c.id}
          title={`${endonym(c.id)} — ${say(c.hint)}`}
          className={cn(
            'micro px-2 py-1 text-[0.6rem] font-bold transition-colors',
            value === c.id ? 'bg-yellow text-ink' : 'bg-paper-3 text-ink-soft hover:text-ink',
          )}
        >
          {shortCode(c.id)}
        </button>
      ))}
    </div>
  );
}
