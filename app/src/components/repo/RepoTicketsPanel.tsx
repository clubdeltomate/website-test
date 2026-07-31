import { useState } from 'react';
import { Check, ChevronDown, Send, Ticket, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import SketchButton from '@/components/sketch/SketchButton';
import { say } from '@/lib/i18n';

/**
 * Owner-only panel (education repos): hand out customization tickets to a
 * student. One ticket = one paid custom generation of this repo for that user.
 * The owner draws from their ticket pool, which they buy from the admin.
 */
export default function RepoTicketsPanel({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const { user, refetch } = useAuth();
  const [email, setEmail] = useState('');
  const [count, setCount] = useState(1);

  const grant = trpc.tickets.grantToUser.useMutation({
    onSuccess: (r) => {
      toast.success(
        `Gave ${count} ticket${count === 1 ? '' : 's'} to ${r.userName} — ${r.remaining} left in your pool`,
      );
      setEmail('');
      setCount(1);
      refetch();
    },
    onError: (e) => toast.error(say(e.message)),
  });

  const incoming = trpc.tickets.incoming.useQuery();
  const requestsForRepo = (incoming.data ?? []).filter((r) => r.repoSlug === slug);
  const resolve = trpc.tickets.resolveRequest.useMutation({
    onSuccess: () => {
      void incoming.refetch();
      refetch();
    },
    onError: (e) => toast.error(say(e.message)),
  });

  const pool = user?.ticketBalance ?? 0;

  return (
    <section className="rounded-wobble-sm border-2 border-ink bg-paper-3 shadow-offset">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <Ticket className="h-4 w-4 text-ink" />
        <span className="font-heading font-bold text-ink">{say("Customization tickets")}</span>
        <span className="micro rounded-full border-2 border-ink bg-green-soft px-2 text-[0.6rem] font-bold text-green">
          {pool}  {say("in pool")}
        </span>
        <ChevronDown
          className={cn('ml-auto h-4 w-4 text-ink-soft transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="border-t-2 border-dashed border-pencil p-4">
          <p className="mb-3 text-sm text-ink-soft">
            
            {say("Give a student tickets so they can generate their own custom version of this repo. One ticket covers one customization. Buy more tickets from the admin when your pool runs low.")}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1">
              <span className="micro text-[0.6rem] text-ink-faint">{say("Student's account email")}</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={say("student@example.com")}
                className="rounded-wobble-sm border-2 border-ink bg-paper px-2.5 py-1.5 text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="micro text-[0.6rem] text-ink-faint">{say("Tickets")}</span>
              <input
                type="number"
                min={1}
                max={Math.max(1, pool)}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                className="w-20 rounded-wobble-sm border-2 border-ink bg-paper px-2.5 py-1.5 text-sm text-ink shadow-offset outline-none focus:border-blue"
              />
            </label>
            <SketchButton
              variant="accent"
              size="sm"
              loading={grant.isPending}
              disabled={!email.trim() || count > pool}
              onClick={() => grant.mutate({ repoSlug: slug, userEmail: email.trim(), count })}
            >
              <Send className="h-4 w-4" />  {say("Give")}
            </SketchButton>
          </div>
          {count > pool && (
            <p className="mt-2 text-xs text-red">
              
              {say("Your pool only has")} {pool}  {say("ticket")}{pool === 1 ? '' : 's'}  {say("— buy more from the admin first.")}
            </p>
          )}

          {/* incoming requests from students */}
          {requestsForRepo.length > 0 && (
            <div className="mt-4 border-t-2 border-dashed border-pencil pt-3">
              <p className="micro mb-2 text-[0.6rem] uppercase tracking-wider text-ink-faint">
                
                {say("Requests (")}{requestsForRepo.length})
              </p>
              <ul className="flex flex-col gap-2">
                {requestsForRepo.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center gap-2 rounded-wobble-sm border-2 border-ink bg-yellow-soft px-3 py-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="font-heading text-sm font-bold text-ink">{r.requesterName}</span>
                      <span className="text-sm text-ink-soft">
                        {' '}
                        
                        {say("wants")} {r.count}  {say("ticket")}{r.count === 1 ? '' : 's'}
                      </span>
                      <span className="micro block truncate text-[0.6rem] text-ink-faint">
                        {r.requesterEmail}
                        {r.note ? ` · “${r.note}”` : ''}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => resolve.mutate({ requestId: r.id, approve: true })}
                      disabled={resolve.isPending || r.count > pool}
                      title={r.count > pool ? 'Not enough tickets in your pool' : 'Grant'}
                      className="rounded-wobble-sm border-2 border-green bg-green-soft p-1.5 text-green transition-colors hover:bg-green/20 disabled:opacity-40"
                      aria-label={say("Grant")}
                    >
                      <Check className="h-4 w-4" strokeWidth={2.5} />
                    </button>
                    <button
                      type="button"
                      onClick={() => resolve.mutate({ requestId: r.id, approve: false })}
                      disabled={resolve.isPending}
                      title={say("Decline")}
                      className="rounded-wobble-sm border-2 border-pencil p-1.5 text-ink-faint transition-colors hover:border-red hover:text-red"
                      aria-label={say("Decline")}
                    >
                      <X className="h-4 w-4" strokeWidth={2.5} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
