import { useMemo, useState } from 'react';
import { ChevronDown, Inbox, ShoppingBag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { say } from '@/lib/i18n';

function timeAgo(d: Date): string {
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * Owner-only panel: interest/order leads left on a commercial (menu/service/
 * shop) repo's presentations. Shows who's interested and their note — no
 * payment, just a way to follow up.
 */
export default function RepoLeadsPanel({ slug }: { slug: string }) {
  const [open, setOpen] = useState(true);
  const utils = trpc.useUtils();
  const query = trpc.orders.listMine.useQuery({ limit: 100 });
  const markSeen = trpc.orders.markAllSeen.useMutation({
    onSuccess: () => {
      void utils.orders.listMine.invalidate();
      void utils.orders.unseenCount.invalidate();
    },
  });

  const leads = useMemo(
    () => (query.data ?? []).filter((o) => o.repoSlug === slug),
    [query.data, slug],
  );
  const unseen = leads.filter((l) => !l.seen).length;

  if (query.isLoading || leads.length === 0) return null;

  return (
    <section className="rounded-wobble-sm border-2 border-ink bg-paper-3 shadow-offset">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <Inbox className="h-4 w-4 text-ink" />
        <span className="font-heading font-bold text-ink">{say("Leads")}</span>
        <span className="micro rounded-full border-2 border-ink bg-yellow-soft px-2 text-[0.6rem] font-bold text-ink">
          {leads.length}
        </span>
        {unseen > 0 && (
          <span className="micro rounded-full border-2 border-red bg-red-soft px-2 text-[0.6rem] font-bold text-red">
            {unseen}  {say("new")}
          </span>
        )}
        <ChevronDown
          className={cn('ml-auto h-4 w-4 text-ink-soft transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="border-t-2 border-dashed border-pencil p-4">
          {unseen > 0 && (
            <button
              type="button"
              onClick={() => markSeen.mutate()}
              className="micro mb-3 rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1 text-ink-soft hover:border-ink hover:text-ink"
            >
              
              {say("Mark all as read")}
            </button>
          )}
          <ul className="flex flex-col gap-2">
            {leads.map((l) => (
              <li
                key={l.id}
                className={cn(
                  'rounded-wobble-sm border-2 px-3 py-2',
                  l.seen ? 'border-pencil bg-paper-2/50' : 'border-ink bg-yellow-soft',
                )}
              >
                <div className="flex items-center gap-2">
                  <ShoppingBag className="h-3.5 w-3.5 shrink-0 text-ink-soft" />
                  <span className="font-heading text-sm font-bold text-ink">{l.buyerName}</span>
                  {l.itemTitle && (
                    <span className="text-sm text-ink-soft">· {l.itemTitle}</span>
                  )}
                  <span className="micro ml-auto text-[0.6rem] text-ink-faint">
                    {timeAgo(l.createdAt)}
                  </span>
                </div>
                {l.note && <p className="mt-1 text-sm text-ink-soft">“{l.note}”</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
