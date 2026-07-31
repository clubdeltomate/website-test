import { useEffect, useRef, useState } from 'react';
import { Check, Globe, Lock, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import { POST_VISIBILITY, VISIBILITY_BRIEF, VISIBILITY_LABEL } from '@contracts/post';
import type { PostSummary, PostVisibility } from '@contracts/post';
import { say } from '@/lib/i18n';

/* Who a post is for, changed where the post is.
 *
 * The audience is set when you publish, but that is not when you always know
 * it: a post to the whole feed turns out to be for one customer, a draft
 * turns out to be worth showing everyone. So the same two controls the
 * marketing tool has — on the feed, on a profile, on the gallery — wherever
 * you are looking at the post you want to change.
 *
 * Sending is admins and verified moderators on their own posts, the same
 * rule assigned notebooks and slide decks already use. Somebody who may not
 * send simply does not see that half. */

export default function PostAudience({
  post,
  compact = false,
}: {
  post: PostSummary;
  /** an icon button rather than a labelled one, for a card's footer */
  compact?: boolean;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const [q, setQ] = useState('');
  const [sendTo, setSendTo] = useState<number[] | null>(null);
  const utils = trpc.useUtils();

  const mine = post.mine || user?.role === 'admin';
  const maySend =
    user != null &&
    (user.role === 'admin' || (post.mine && user.role === 'moderator' && user.verified));

  const recipients = trpc.posts.recipients.useQuery(
    { slug: post.slug },
    { enabled: open && maySend },
  );
  const directory = trpc.users.directory.useQuery(
    { q: q.trim() || undefined },
    { enabled: open && maySend },
  );
  // What is on the server until something is picked; after that, the draft.
  const chosen = sendTo ?? recipients.data ?? [];

  const refresh = () => {
    void utils.posts.list.invalidate();
    void utils.posts.bySlug.invalidate({ slug: post.slug });
    void utils.posts.recipients.invalidate({ slug: post.slug });
  };

  const setVisibility = trpc.posts.setVisibility.useMutation({
    onSuccess: (_r, vars) => {
      refresh();
      toast.success(
        vars.visibility === 'public' ? 'On the feed for everyone' : 'Off the feed — yours',
      );
    },
    onError: (e) => toast.error(say(e.message)),
  });

  const setRecipients = trpc.posts.setRecipients.useMutation({
    onSuccess: (r) => {
      refresh();
      setSendTo(null);
      toast.success(r.sent === 0 ? 'Not sent to anyone now' : `Sent to ${r.sent}`);
    },
    onError: (e) => toast.error(say(e.message)),
  });

  /* Click away to put it back. A panel that can only be closed by the button
     that opened it is a panel people leave open. */
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  if (!mine) return null;

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Who sees ${post.slug}`}
        title={say("Who sees this")}
        className={cn(
          'micro flex items-center gap-1 rounded-wobble-sm border-2 border-dashed border-pencil font-bold text-ink-soft transition-colors hover:border-ink hover:text-ink',
          compact ? 'px-1 py-0.5 text-[0.5rem]' : 'px-2 py-1 text-[0.58rem]',
        )}
      >
        {post.who === 'private' ? (
          <Lock className="h-3 w-3" strokeWidth={2} />
        ) : (
          <Globe className="h-3 w-3" strokeWidth={2} />
        )}
        {compact ? '' : VISIBILITY_LABEL[post.who]}
      </button>

      {open && (
        <div className="absolute bottom-full right-0 z-30 mb-1 w-[280px] rounded-wobble-sm border-2 border-ink bg-paper-3 p-3 shadow-offset">
          <div className="mb-2 flex items-center justify-between">
            <span className="micro text-[0.58rem] font-semibold text-ink-soft">{say("Who sees it")}</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={say("Close")}
              className="text-ink-faint hover:text-ink"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {POST_VISIBILITY.map((v) => (
              <button
                key={v}
                type="button"
                disabled={setVisibility.isPending}
                onClick={() => setVisibility.mutate({ slug: post.slug, visibility: v })}
                aria-pressed={post.who === v}
                aria-label={`Who sees it: ${VISIBILITY_LABEL[v]}`}
                title={VISIBILITY_BRIEF[v]}
                className={cn(
                  'micro rounded-wobble-sm border-2 px-2 py-1 text-[0.58rem] font-bold transition-colors disabled:opacity-50',
                  post.who === v
                    ? 'border-ink bg-yellow text-ink shadow-offset'
                    : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                )}
              >
                {VISIBILITY_LABEL[v]}
              </button>
            ))}
          </div>
          <p className="micro mt-1 text-[0.52rem] text-ink-faint">
            {VISIBILITY_BRIEF[post.who as PostVisibility]}
          </p>

          {maySend && (
            <div className="mt-2 border-t-2 border-dashed border-pencil pt-2">
              <span className="micro text-[0.58rem] font-semibold text-ink-soft">
                
                {say("Sent to")} {chosen.length > 0 ? chosen.length : 'nobody'}
              </span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label={say("Find a user")}
                placeholder={say("Find someone by name")}
                className="mt-1 w-full rounded-wobble-sm border-2 border-ink bg-paper-3 px-2 py-1 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-blue"
              />
              <div className="mt-1.5 flex max-h-36 flex-wrap gap-1 overflow-y-auto">
                {(directory.data ?? [])
                  .filter((u) => u.id !== post.ownerId)
                  .map((u) => {
                    const on = chosen.includes(u.id);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() =>
                          setSendTo(on ? chosen.filter((x) => x !== u.id) : [...chosen, u.id])
                        }
                        aria-pressed={on}
                        aria-label={`${u.name} — ${on ? 'sent' : 'not sent'}`}
                        className={cn(
                          'micro flex items-center gap-1 rounded-wobble-sm border-2 px-1.5 py-0.5 text-[0.55rem] font-bold transition-colors',
                          on
                            ? 'border-ink bg-yellow text-ink shadow-offset'
                            : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                        )}
                      >
                        {u.name}
                        {on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                      </button>
                    );
                  })}
              </div>
              <button
                type="button"
                disabled={setRecipients.isPending || sendTo === null}
                onClick={() => setRecipients.mutate({ slug: post.slug, userIds: chosen })}
                className="micro mt-2 flex items-center gap-1 rounded-wobble-sm border-2 border-ink bg-yellow px-2 py-1 text-[0.58rem] font-bold text-ink shadow-offset disabled:opacity-40"
              >
                <Send className="h-3 w-3" strokeWidth={2.5} />
                {sendTo === null ? 'Pick who it goes to' : `Save — ${chosen.length}`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
