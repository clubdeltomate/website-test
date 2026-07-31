import { cn } from '@/lib/utils';
import { endonym, shortCode } from '@/lib/content-language';

/**
 * The two letters on a card saying what language the work is in.
 *
 * Always shown, English included. A sticker that only appears on the unusual
 * case teaches people that its absence means nothing in particular, and then
 * they stop reading it — the point is to be able to tell at a glance across a
 * grid, which needs every tile to answer.
 */
export default function LanguageTag({ code, className }: { code: string; className?: string }) {
  return (
    <span
      title={endonym(code)}
      className={cn(
        'micro inline-flex items-center rounded-wobble-sm border-2 border-ink bg-paper-3 px-1.5 py-0.5 text-[0.55rem] font-bold leading-none text-ink',
        className,
      )}
    >
      {shortCode(code)}
    </span>
  );
}
