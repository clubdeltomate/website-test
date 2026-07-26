import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type ChipKind =
  | 'A0'
  | 'A1'
  | 'A2'
  | 'B1'
  | 'B2'
  | 'C1'
  | 'C2'
  | 'user'
  | 'moderator'
  | 'admin'
  | 'guest'
  | 'repo-ref'
  | 'slide-tool'
  | 'neutral';

const KINDS: Record<ChipKind, string> = {
  // CEFR level chips — coloured by tier (A0-A2 green, B1-B2 yellow, C1-C2 red)
  A0: 'bg-green-soft text-ink border-dotted border-ink',
  A1: 'bg-green-soft text-ink border-dotted border-ink',
  A2: 'bg-green-soft text-ink border-dotted border-ink',
  B1: 'bg-yellow-soft text-ink border-dotted border-ink',
  B2: 'bg-yellow-soft text-ink border-dotted border-ink',
  C1: 'bg-red-soft text-ink border-dotted border-ink',
  C2: 'bg-red-soft text-ink border-dotted border-ink',
  // Role chips
  user: 'bg-blue-soft text-ink border-solid border-ink',
  moderator: 'bg-purple-soft text-ink border-solid border-ink',
  admin: 'bg-purple text-paper-3 border-solid border-ink',
  guest: 'bg-pencil text-ink border-solid border-ink',
  // Repo-ref chip: paper-2, mono 700
  'repo-ref': 'bg-paper-2 text-ink border-solid border-ink font-mono font-bold',
  'slide-tool': 'bg-blue-soft text-ink border-solid border-ink',
  neutral: 'bg-paper-2 text-ink border-solid border-pencil',
};

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  kind?: ChipKind;
  children: ReactNode;
}

export default function Chip({
  kind = 'neutral',
  className,
  children,
  ...rest
}: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-wobble-sm border-2 px-2 py-0.5 text-xs font-bold leading-5',
        KINDS[kind],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
