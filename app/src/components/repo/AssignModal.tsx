import { useState } from 'react';
import { Check, Search, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import { SketchModal } from '@/components/admin/overlays';
import SketchButton from '@/components/sketch/SketchButton';
import Chip from '@/components/sketch/Chip';
import { VerifiedBadge } from '@/components/repo/shared';

/**
 * "Hand this to someone": pick a user, and the slide tool / repo appears on
 * THEIR shelf wearing an "assigned" tag. One modal for both kinds — the only
 * difference between assigning a presentation and assigning a notebook is
 * the word on the button.
 */
export default function AssignModal({
  open,
  onClose,
  targetType,
  slug,
  title,
}: {
  open: boolean;
  onClose: () => void;
  targetType: 'slideTool' | 'repo';
  slug: string;
  title: string;
}) {
  const [q, setQ] = useState('');
  const utils = trpc.useUtils();
  const directory = trpc.users.directory.useQuery({ q: q || undefined }, { enabled: open });
  // Who already holds this item — their row says so instead of offering to
  // assign a second time.
  const holders = trpc.assignments.listFor.useQuery({ targetType, slug }, { enabled: open });
  const held = new Set(holders.data ?? []);
  const assign = trpc.assignments.assign.useMutation({
    onSuccess: (r, vars) => {
      const who = directory.data?.find((u) => u.id === vars.userId)?.name ?? 'them';
      toast.success(
        r.alreadyAssigned
          ? `Already on ${who}'s shelf`
          : `Assigned ✓ — it now shows on ${who}'s shelf`,
      );
      void utils.assignments.listFor.invalidate({ targetType, slug });
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const unassign = trpc.assignments.unassign.useMutation({
    onSuccess: (_r, vars) => {
      const who = directory.data?.find((u) => u.id === vars.userId)?.name ?? 'them';
      toast.success(`Removed from ${who}'s shelf`);
      void utils.assignments.listFor.invalidate({ targetType, slug });
    },
    onError: (e) => toast.error(e.message),
  });
  const noun = targetType === 'repo' ? 'notebook' : 'presentation';
  return (
    <SketchModal open={open} onClose={onClose} title="Assign to someone" maxWidth="max-w-[440px]">
      <p className="text-sm text-ink-soft">
        Put <strong className="text-ink">{title}</strong> on another person's shelf. They'll see
        this {noun} on their own page, tagged as assigned.
      </p>
      <div className="mt-3 flex items-center gap-2 rounded-wobble-sm border-2 border-ink bg-paper px-2.5 py-1.5 shadow-offset">
        <Search className="h-4 w-4 shrink-0 text-ink-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a user…"
          aria-label="Find a user"
          className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
        />
      </div>
      <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto pr-1" data-lenis-prevent>
        {(directory.data ?? []).slice(0, 30).map((u) => (
          <div
            key={u.id}
            className="flex items-center justify-between gap-2 rounded-wobble-sm border-2 border-dashed border-pencil px-2.5 py-1.5"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-heading text-sm font-bold text-ink">{u.name}</span>
              {u.verified && <VerifiedBadge />}
              <Chip kind={u.role} className="text-[0.55rem]">
                {u.role}
              </Chip>
            </span>
            {held.has(u.id) ? (
              <span className="flex items-center gap-1">
                <span
                  title="Already on their shelf — an item can only be assigned to someone once"
                  className="micro flex items-center gap-1 rounded-wobble-sm border-2 border-green bg-green-soft px-2 py-1 text-[0.6rem] font-bold text-green"
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> Assigned
                </span>
                <button
                  type="button"
                  onClick={() => unassign.mutate({ targetType, slug, userId: u.id })}
                  disabled={unassign.isPending}
                  aria-label={`Remove from ${u.name}'s shelf`}
                  title="Take it back off their shelf"
                  className="rounded-wobble-sm p-1 text-ink-faint transition-colors hover:bg-red-soft hover:text-red"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                </button>
              </span>
            ) : (
              <SketchButton
                variant="secondary"
                size="sm"
                loading={assign.isPending && assign.variables?.userId === u.id}
                onClick={() => assign.mutate({ targetType, slug, userId: u.id })}
              >
                <UserPlus className="h-3.5 w-3.5" strokeWidth={2} /> Assign
              </SketchButton>
            )}
          </div>
        ))}
        {directory.isSuccess && (directory.data ?? []).length === 0 && (
          <p className="py-4 text-center text-sm text-ink-faint">Nobody matches that search.</p>
        )}
      </div>
    </SketchModal>
  );
}
