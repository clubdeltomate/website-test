import { Link } from 'react-router';
import { cn } from '@/lib/utils';
import { say } from '@/lib/i18n';

export interface TokenMeterProps {
  tokens?: number;
  /** Below this the meter pulses gently (design.md §7.8) */
  lowThreshold?: number;
  /** Max shown on the pencil bar */
  max?: number;
  className?: string;
}

/**
 * Pencil-shaped token meter — orange fill, eraser end depletes (design.md §7.8).
 * Placeholder balance for the scaffold: AUTH-SLOT — wired to real balance in the backend pass.
 */
export default function TokenMeter({
  tokens = 142,
  lowThreshold = 20,
  max = 200,
  className,
}: TokenMeterProps) {
  const pct = Math.max(0, Math.min(1, tokens / max));
  const low = tokens < lowThreshold;
  return (
    <Link
      to="/settings?tab=tokens"
      className={cn(
        'group flex items-center gap-2 no-underline',
        low && 'animate-low-pulse',
        className,
      )}
      title={say("Tokens — click to recharge")}
    >
      {/* pencil body */}
      <span className="relative block h-3.5 w-24 overflow-hidden rounded-r-full rounded-l-sm border-2 border-ink bg-paper-2">
        <span
          className="block h-full bg-orange transition-[width] duration-500"
          style={{ width: `${pct * 100}%` }}
        />
        {/* eraser end */}
        <span className="absolute right-0 top-0 h-full w-2 bg-red/70 border-l-2 border-ink" />
      </span>
      <span className="font-mono text-xs text-ink-soft group-hover:text-ink">
        {tokens}  {say("tokens")}
      </span>
    </Link>
  );
}
