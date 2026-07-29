import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Coins,
  Instagram,
  MessageCircle,
  Play,
  Presentation,
  Pencil,
  Search,
  Ticket,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import Chip from '@/components/sketch/Chip';
import SketchButton from '@/components/sketch/SketchButton';
import { SketchInput, SketchSelect } from '@/components/admin/controls';
import SketchToaster from '@/components/admin/SketchToaster';
import RepoCard from '@/components/repo/RepoCard';
import { TemplateIcon } from '@/components/repo/shared';
import { normalizeUsername, USERNAME_MAX_LENGTH } from '@contracts/types';
import type {
  ContentSource,
  RepoSummary,
  RepoTemplate,
  SlideToolSummary,
  UserProfile as Profile,
} from '@contracts/types';

const CATEGORIES = ['all', 'course', 'restaurant', 'service', 'shop', 'walkthrough', 'news'] as const;

/** Authorship filter options — the two halves the cards already badge, plus all. */
const MADE_BY: { id: ContentSource | 'all'; label: string }[] = [
  { id: 'all', label: 'Anyone' },
  { id: 'ai', label: 'AI' },
  { id: 'human', label: 'Hand' },
];
const PAGE = 6;

/** A user's public profile: repos + slide tools, filters, contact + requests. */
export default function UserProfile() {
  const { id } = useParams();
  const userId = Number(id);
  const { user, isGuest, role } = useAuth();
  const utils = trpc.useUtils();

  const [tab, setTab] = useState<'repos' | 'slides'>('repos');
  const [category, setCategory] = useState<RepoTemplate | 'all'>('all');
  const [search, setSearch] = useState('');
  /**
   * Which authorship to show. This used to be a lone "Made with AI" toggle
   * sitting beside the search box, wearing the same label and sparkle icon as
   * the badge on a card — which read as "search using AI" and implied a cost.
   * Nothing here calls AI: it is a filter over the repos already on screen.
   * Naming both halves makes it unmistakably a filter, and lets someone find
   * hand-built work too, which the badges advertised but the filter couldn't
   * reach.
   */
  const [madeBy, setMadeBy] = useState<ContentSource | 'all'>('all');
  const [page, setPage] = useState(0);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [coinOpen, setCoinOpen] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  const profile = trpc.users.profile.useQuery({ userId }, { enabled: Number.isFinite(userId) });

  const toggleFollow = trpc.users.toggleFollow.useMutation({
    onMutate: async () => {
      await utils.users.profile.cancel({ userId });
      const prev = utils.users.profile.getData({ userId });
      utils.users.profile.setData({ userId }, (old) => (old ? { ...old, following: !old.following } : old));
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) utils.users.profile.setData({ userId }, ctx.prev);
      toast.error(e.message);
    },
    onSettled: () => void utils.users.profile.invalidate({ userId }),
  });
  const toggleRepoFav = trpc.repos.toggleFavorite.useMutation({
    onError: (e) => toast.error(e.message),
    onSettled: () => void utils.users.profile.invalidate({ userId }),
  });

  const q = search.trim().toLowerCase();
  const repos = profile.data?.repos ?? [];
  const tools = profile.data?.slideTools ?? [];
  const filteredRepos = useMemo(
    () =>
      repos
        .filter((r) => category === 'all' || r.template === category)
        .filter((r) => !q || r.title.toLowerCase().includes(q))
        .filter((r) => madeBy === 'all' || r.source === madeBy),
    [repos, category, q, madeBy],
  );
  const filteredTools = useMemo(
    () =>
      tools
        .filter((t) => !q || t.name.toLowerCase().includes(q))
        .filter((t) => madeBy === 'all' || t.source === madeBy),
    [tools, q, madeBy],
  );

  const items: (RepoSummary | SlideToolSummary)[] = tab === 'repos' ? filteredRepos : filteredTools;
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = items.slice(safePage * PAGE, safePage * PAGE + PAGE);
  useEffect(() => setPage(0), [tab, category, q, madeBy]);

  if (profile.isLoading) {
    return <div className="mx-auto w-full max-w-content px-4 py-10 text-center text-ink-faint">Opening their shelf…</div>;
  }
  if (profile.isError || !profile.data) {
    return (
      <div className="mx-auto w-full max-w-content px-4 py-10 text-center">
        <p className="text-ink-soft">Couldn't find that user.</p>
        <Link to="/users" className="mt-3 inline-block font-heading font-bold text-blue underline">
          Back to users
        </Link>
      </div>
    );
  }

  const p = profile.data;
  const isSelf = user?.id === p.id;
  const waHref = p.whatsapp ? `https://wa.me/${p.whatsapp.replace(/[^0-9]/g, '')}` : null;
  // Ticket sellers are moderators (admins inherit the right); users can't sell.
  const sellsTickets = p.role === 'moderator' || p.role === 'admin';
  const isAdmin = p.role === 'admin';
  const viewerIsStaff = role === 'moderator' || role === 'admin';
  const canRequestTickets = !isGuest && !isSelf && sellsTickets;
  const canRequestCoins = !isGuest && !isSelf && isAdmin && viewerIsStaff;
  /**
   * What this page offers depends on who is reading it, not only on whose it
   * is. An admin can hand tickets over and move coins; a moderator can pass
   * tickets to another holder; everyone else can only ask. Before this the
   * page showed one button — "Request tickets" — to all three, so an admin
   * looking at a moderator had no way to do the thing they were there to do.
   */
  const viewerIsAdmin = role === 'admin';
  // Only ticket holders can be handed tickets — a plain user has to be credited
  // into a moderator first, so an admin on their profile gets "Adjust credits"
  // rather than a "Give tickets" button that could only ever fail.
  const canGrantTickets = viewerIsAdmin && !isSelf && sellsTickets;
  const canAdjustCoins = viewerIsAdmin && !isSelf;
  const canSendTickets = role === 'moderator' && !isSelf && sellsTickets;
  // Your own name, or anyone's if you're the admin.
  const canRename = isSelf || viewerIsAdmin;

  const onFollow = () => {
    if (isGuest) return toast.error('Sign in to follow');
    toggleFollow.mutate({ userId });
  };
  const onRepoFav = (repo: RepoSummary) => {
    if (isGuest) return toast.error('Sign in to favorite');
    toggleRepoFav.mutate({ slug: repo.slug });
  };

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-6 px-4 py-8 lg:px-8">
      <Link
        to="/users"
        className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft no-underline hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> Users
      </Link>

      {/* header */}
      <section className="flex flex-wrap items-start gap-4 rounded-wobble-2 border-2 border-ink bg-paper-3 p-5 shadow-offset">
        <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-blue-soft font-display text-4xl text-ink shadow-offset">
          {p.name.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-3xl font-bold text-ink">{p.name}</h2>
            <Chip kind={p.role}>{p.role}</Chip>
            {isSelf && <Chip kind="neutral">you</Chip>}
            {/* Rename from the page you are already looking at. An admin fixing
                someone else's typo had to go find them in the admin table, and
                your own name was only editable in Settings. */}
            {canRename && (
              <button
                type="button"
                onClick={() => setRenameOpen(true)}
                aria-label={isSelf ? 'Edit your username' : `Edit ${p.name}'s username`}
                title="Edit username"
                className="rounded-wobble-sm border-2 border-dashed border-pencil p-1 text-ink-soft hover:border-ink hover:text-ink"
              >
                <Pencil className="h-4 w-4" strokeWidth={2} />
              </button>
            )}
          </div>
          <p className="micro mt-1 text-ink-faint">
            {p.repos.length} published repo{p.repos.length === 1 ? '' : 's'} · member since{' '}
            {new Date(p.createdAt).toLocaleDateString()}
          </p>
          {p.contactNote && <p className="mt-2 text-sm text-ink-soft">{p.contactNote}</p>}

          {/* social row */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {waHref ? (
              <a
                href={waHref}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-wobble-sm border-2 border-green bg-green-soft px-3 py-1.5 text-sm font-bold text-ink no-underline shadow-offset hover:bg-green/20"
              >
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </a>
            ) : (
              <span
                title="No WhatsApp number set on this profile"
                className="flex cursor-not-allowed items-center gap-1.5 rounded-wobble-sm border-2 border-dashed border-pencil px-3 py-1.5 text-sm font-bold text-ink-faint"
              >
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </span>
            )}
            <button
              type="button"
              title="Instagram — coming soon"
              className="flex cursor-default items-center gap-1.5 rounded-wobble-sm border-2 border-dashed border-pencil px-3 py-1.5 text-sm font-bold text-ink-soft"
            >
              <Instagram className="h-4 w-4" /> Instagram
            </button>
          </div>
        </div>

        {/* actions */}
        <div className="flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={onFollow}
            aria-pressed={p.following}
            className={cn(
              'flex items-center gap-1.5 rounded-wobble-sm border-2 px-3 py-2 text-sm font-bold transition-colors',
              p.following
                ? 'border-ink bg-yellow text-ink shadow-offset'
                : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
            )}
          >
            {p.following ? (
              <>
                <UserCheck className="h-4 w-4" strokeWidth={2} /> Following
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4" strokeWidth={2} /> Follow
              </>
            )}
          </button>
          {canGrantTickets && (
            <SketchButton variant="accent" size="sm" onClick={() => setGrantOpen(true)}>
              <Ticket className="h-4 w-4" /> Give tickets
            </SketchButton>
          )}
          {canAdjustCoins && (
            <SketchButton variant="secondary" size="sm" onClick={() => setAdjustOpen(true)}>
              <Coins className="h-4 w-4" /> Adjust credits
            </SketchButton>
          )}
          {canSendTickets && (
            <SketchButton variant="accent" size="sm" onClick={() => setSendOpen(true)}>
              <Ticket className="h-4 w-4" /> Send tickets
            </SketchButton>
          )}
          {canRequestTickets && !canGrantTickets && (
            <SketchButton
              variant={canSendTickets ? 'secondary' : 'accent'}
              size="sm"
              onClick={() => setTicketOpen(true)}
            >
              <Ticket className="h-4 w-4" /> Request tickets
            </SketchButton>
          )}
          {canRequestCoins && !canAdjustCoins && (
            <SketchButton variant="secondary" size="sm" onClick={() => setCoinOpen(true)}>
              <Coins className="h-4 w-4" /> Request coins
            </SketchButton>
          )}
        </div>
      </section>

      {/* tabs */}
      <div className="flex items-center gap-2">
        {(['repos', 'slides'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'flex items-center gap-1.5 rounded-wobble-sm border-2 px-4 py-1.5 font-heading text-sm font-bold transition-colors',
              tab === t
                ? 'border-ink bg-yellow text-ink shadow-offset'
                : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
            )}
          >
            {t === 'repos' ? <TemplateIcon template="course" className="h-4 w-4" /> : <Presentation className="h-4 w-4" />}
            {t === 'repos' ? `Repos (${filteredRepos.length})` : `Slides (${filteredTools.length})`}
          </button>
        ))}
      </div>

      {/* filters */}
      <div className="flex flex-col gap-2 rounded-wobble-2 border-2 border-ink bg-paper-3 p-3 shadow-offset">
        {/* The search box gets its own row and says what it does. It is a plain
            name match over what is already on the page — no request, no AI, no
            credits — and it used to share a line with an AI-badged button,
            which made it look like the search itself was the AI feature. */}
        <label className="relative flex items-center">
          <Search className="pointer-events-none absolute left-3 h-4 w-4 text-ink-faint" strokeWidth={2} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === 'repos' ? 'Search repos by name…' : 'Search slides by name…'}
            className="w-full rounded-wobble-sm border-2 border-ink bg-paper py-2 pl-9 pr-3 text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2 border-t-2 border-dashed border-pencil pt-2.5">
          {tab === 'repos' &&
            CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={cn(
                  'flex items-center gap-1.5 rounded-wobble-sm border-2 px-3 py-1 text-xs font-bold uppercase tracking-wider transition-colors',
                  category === c
                    ? 'border-ink bg-yellow text-ink shadow-offset'
                    : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                )}
              >
                {c !== 'all' && <TemplateIcon template={c} className="h-3.5 w-3.5" />}
                {c}
              </button>
            ))}

          {/* Authorship filter. "Made by:" in front is what turns it from a
              button you press into a property you filter on. */}
          <span className="micro ml-auto flex items-center gap-2 text-ink-faint">
            Made by:
            {MADE_BY.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMadeBy(m.id)}
                className={cn(
                  'rounded-wobble-sm border-2 px-2.5 py-1 text-xs font-bold transition-colors',
                  madeBy === m.id
                    ? 'border-ink bg-yellow text-ink shadow-offset'
                    : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                )}
              >
                {m.label}
              </button>
            ))}
          </span>
        </div>
      </div>

      {/* grid */}
      {pageItems.length === 0 ? (
        <div className="rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-2/50 p-10 text-center text-ink-faint">
          {tab === 'repos' ? 'No repos match these filters.' : 'No slides match these filters.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {tab === 'repos'
            ? (pageItems as RepoSummary[]).map((repo, i) => (
                <RepoCard key={repo.slug} repo={repo} index={i} onToggleFavorite={onRepoFav} />
              ))
            : (pageItems as SlideToolSummary[]).map((tool) => <ToolMini key={tool.slug} tool={tool} />)}
        </div>
      )}

      {/* pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3">
          <SketchButton variant="ghost" size="sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
            <ChevronLeft className="h-4 w-4" /> Prev
          </SketchButton>
          <span className="micro text-ink-soft">
            Page {safePage + 1} of {pageCount}
          </span>
          <SketchButton
            variant="ghost"
            size="sm"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage(safePage + 1)}
          >
            Next <ChevronRight className="h-4 w-4" />
          </SketchButton>
        </div>
      )}

      {ticketOpen && <TicketRequestModal profile={p} onClose={() => setTicketOpen(false)} />}
      {coinOpen && <CoinRequestModal onClose={() => setCoinOpen(false)} />}
      {grantOpen && <GiveTicketsModal profile={p} onClose={() => setGrantOpen(false)} />}
      {sendOpen && <SendTicketsModal profile={p} onClose={() => setSendOpen(false)} />}
      {adjustOpen && <AdjustCoinsModal profile={p} onClose={() => setAdjustOpen(false)} />}
      {renameOpen && (
        <RenameModal profile={p} isSelf={isSelf} onClose={() => setRenameOpen(false)} />
      )}
      {/* No global toast mount exists in the shell, so a page that calls toast()
          has to carry its own — without this every confirmation and every
          rejection here (not enough tickets, not a moderator) went nowhere. */}
      <SketchToaster />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ToolMini({ tool }: { tool: SlideToolSummary }) {
  const human = tool.source === 'human';
  const href = human ? `/slides/show/${tool.slug}` : `/slides/${tool.slug}`;
  return (
    <Link
      to={href}
      className="flex flex-col gap-3 rounded-wobble-2 border-2 border-ink bg-paper-3 p-5 no-underline shadow-offset transition-transform hover:-translate-y-0.5"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink bg-blue-soft text-ink">
          <Presentation className="h-5 w-5" />
        </span>
        {human ? (
          <span className="micro rounded-full border-2 border-ink bg-green-soft px-2 py-0.5 text-[0.58rem] font-bold text-green">
            Human
          </span>
        ) : (
          <span className="micro rounded-full border-2 border-ink bg-purple-soft px-2 py-0.5 text-[0.58rem] font-bold text-purple">
            Made with AI
          </span>
        )}
      </div>
      <h3 className="line-clamp-2 font-heading text-lg font-semibold text-ink">{tool.name}</h3>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip kind={tool.defaultLevel}>{tool.defaultLevel}</Chip>
        <span className="micro text-ink-faint">
          {tool.runCount} {tool.runCount === 1 ? 'play' : 'plays'}
        </span>
      </div>
      <span className="mt-auto flex items-center gap-1.5 border-t-2 border-dashed border-pencil pt-3 font-heading text-sm font-bold text-ink">
        <Play className="h-3.5 w-3.5" strokeWidth={2.5} /> {human ? 'Play' : 'Open'}
      </span>
    </Link>
  );
}

function TicketRequestModal({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const [repoSlug, setRepoSlug] = useState(profile.repos[0]?.slug ?? '');
  const [count, setCount] = useState(1);
  const [note, setNote] = useState('');
  const req = trpc.tickets.request.useMutation({
    onSuccess: () => {
      toast.success(`Requested — ${profile.name} will follow up (usually on WhatsApp)`);
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <ModalShell title={`Request tickets from ${profile.name}`} onClose={onClose}>
      <p className="text-sm text-ink-soft">
        A ticket lets you generate one custom version of a repo. {profile.name} grants them from their
        pool — you coordinate payment over WhatsApp.
      </p>
      {profile.repos.length === 0 ? (
        <p className="text-sm text-red">This user has no public repos to request tickets for.</p>
      ) : (
        <>
          <Field label="Repo">
            <select
              value={repoSlug}
              onChange={(e) => setRepoSlug(e.target.value)}
              className={selectCls}
            >
              {profile.repos.map((r) => (
                <option key={r.slug} value={r.slug}>
                  {r.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tickets">
            <input
              type="number"
              min={1}
              max={20}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              className={cn(selectCls, 'w-24')}
            />
          </Field>
          <Field label="Note (optional)">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What you'd like to customize…"
              className={cn(selectCls, 'min-h-[56px] resize-y')}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <SketchButton variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </SketchButton>
            <SketchButton
              variant="accent"
              size="sm"
              loading={req.isPending}
              onClick={() => req.mutate({ repoSlug, count, note })}
            >
              <Ticket className="h-4 w-4" /> Send request
            </SketchButton>
          </div>
        </>
      )}
    </ModalShell>
  );
}

function CoinRequestModal({ onClose }: { onClose: () => void }) {
  const packsQ = trpc.tokens.packs.useQuery();
  const packs = packsQ.data?.packs ?? [];
  const [packId, setPackId] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!packId && packs[0]) setPackId(packs[0].id);
  }, [packs, packId]);
  const submit = trpc.payments.submitPaidNote.useMutation({
    onSuccess: () => {
      toast.success('Coin request sent — the admin will credit you once settled');
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <ModalShell title="Request coins from the admin" onClose={onClose}>
      <p className="text-sm text-ink-soft">
        Coins (credits) let you build repos and buy tickets. Pick a pack and add a note — you settle
        payment with the admin over WhatsApp, and they credit your balance.
      </p>
      <Field label="Pack">
        <select value={packId} onChange={(e) => setPackId(e.target.value)} className={selectCls}>
          {packs.map((pk) => (
            <option key={pk.id} value={pk.id}>
              {pk.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Note (optional)">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Payment reference, timing…"
          className={cn(selectCls, 'min-h-[56px] resize-y')}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <SketchButton variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </SketchButton>
        <SketchButton
          variant="accent"
          size="sm"
          disabled={!packId}
          loading={submit.isPending}
          onClick={() => submit.mutate({ packId, note })}
        >
          <Coins className="h-4 w-4" /> Send request
        </SketchButton>
      </div>
    </ModalShell>
  );
}

const selectCls =
  'w-full rounded-wobble-sm border-2 border-ink bg-paper px-3 py-2 text-sm text-ink shadow-offset outline-none focus:border-blue';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="micro mb-1 block text-[0.6rem] uppercase tracking-wider text-ink-faint">{label}</span>
      {children}
    </label>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex w-full max-w-[460px] flex-col gap-3 rounded-wobble-2 border-2 border-ink bg-paper-3 p-6 shadow-offset"
      >
        <h3 className="font-display text-2xl font-bold text-ink">{title}</h3>
        {children}
      </div>
    </div>
  );
}

/**
 * Rename from the profile page. Which endpoint it calls depends on whose page
 * it is: your own name goes through auth.updateProfile (the same call Settings
 * makes), someone else's through the admin-only users.updateIdentity. Two doors
 * to one field, because "change my name" and "fix that user's name" are
 * different permissions wearing the same button.
 */
function RenameModal({
  profile,
  isSelf,
  onClose,
}: {
  profile: Profile;
  isSelf: boolean;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(profile.name);

  const done = (newName: string) => {
    toast.success(`Now known as ${newName}`);
    void utils.users.profile.invalidate({ userId: profile.id });
    void utils.users.directory.invalidate();
    void utils.auth.me.invalidate();
    onClose();
  };
  const mine = trpc.auth.updateProfile.useMutation({
    onSuccess: (u) => done(u.name),
    onError: (e) => toast.error(e.message),
  });
  const theirs = trpc.users.updateIdentity.useMutation({
    onSuccess: (r) => done(r.name),
    onError: (e) => toast.error(e.message),
  });

  const clean = normalizeUsername(name);
  const pending = mine.isPending || theirs.isPending;
  const save = () => {
    if (!clean) return toast.error('A username needs some letters in it');
    if (isSelf) mine.mutate({ name: clean });
    else theirs.mutate({ userId: profile.id, name: clean });
  };

  return (
    <ModalShell title={isSelf ? 'Change your username' : `Rename ${profile.name}`} onClose={onClose}>
      <p className="text-sm text-ink-soft">
        One word, up to {USERNAME_MAX_LENGTH} characters. It's how people find you and how you can
        sign in instead of typing your email.
      </p>
      <label className="micro mt-4 block text-ink-soft" htmlFor="rename-name">
        Username · {clean.length}/{USERNAME_MAX_LENGTH}
      </label>
      <SketchInput
        id="rename-name"
        value={name}
        maxLength={USERNAME_MAX_LENGTH}
        onChange={(e) => setName(normalizeUsername(e.target.value))}
      />
      <div className="mt-5 flex justify-end gap-2">
        <SketchButton variant="ghost" onClick={onClose}>
          Cancel
        </SketchButton>
        <SketchButton
          variant="accent"
          loading={pending}
          disabled={!clean || clean === profile.name}
          onClick={save}
        >
          Save
        </SketchButton>
      </div>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ */
/* Admin + moderator actions on someone else's profile                 */
/* ------------------------------------------------------------------ */

/** Admin hands tickets over for nothing. */
function GiveTicketsModal({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [count, setCount] = useState(1);
  const grant = trpc.tickets.grantFree.useMutation({
    onSuccess: (r) => {
      toast.success(`${profile.name} now holds ${r.ticketBalance} ticket${r.ticketBalance === 1 ? '' : 's'}`);
      void utils.users.list.invalidate();
      void utils.auth.me.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <ModalShell title={`Give tickets to ${profile.name}`} onClose={onClose}>
      <p className="text-sm text-ink-soft">
        Free — no coins are taken from them and nothing is recorded as a sale. To charge for
        tickets, use the Sales desk in Finance.
      </p>
      <label className="micro mt-4 block text-ink-soft" htmlFor="give-count">
        How many
      </label>
      <SketchInput
        id="give-count"
        type="number"
        min={1}
        max={500}
        value={String(count)}
        onChange={(e) => setCount(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
      />
      <div className="mt-5 flex justify-end gap-2">
        <SketchButton variant="ghost" onClick={onClose}>
          Cancel
        </SketchButton>
        <SketchButton
          variant="accent"
          loading={grant.isPending}
          onClick={() => grant.mutate({ userId: profile.id, count })}
        >
          Give {count} ticket{count === 1 ? '' : 's'}
        </SketchButton>
      </div>
    </ModalShell>
  );
}

/** A holder passes some of their own tickets to another holder. */
function SendTicketsModal({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const [count, setCount] = useState(1);
  const send = trpc.tickets.send.useMutation({
    onSuccess: (r) => {
      toast.success(`Sent to ${r.recipientName} — you have ${r.senderBalance} left`);
      void utils.auth.me.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const mine = user?.ticketBalance ?? 0;
  return (
    <ModalShell title={`Send tickets to ${profile.name}`} onClose={onClose}>
      <p className="text-sm text-ink-soft">
        Out of your own pool — you hold {mine} ticket{mine === 1 ? '' : 's'}.
      </p>
      <label className="micro mt-4 block text-ink-soft" htmlFor="send-count">
        How many
      </label>
      <SketchInput
        id="send-count"
        type="number"
        min={1}
        max={Math.max(1, mine)}
        value={String(count)}
        onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
      />
      <div className="mt-5 flex justify-end gap-2">
        <SketchButton variant="ghost" onClick={onClose}>
          Cancel
        </SketchButton>
        <SketchButton
          variant="accent"
          loading={send.isPending}
          disabled={mine < 1}
          onClick={() => send.mutate({ toUserId: profile.id, count })}
        >
          Send {count}
        </SketchButton>
      </div>
    </ModalShell>
  );
}

/** Admin moves someone's coin balance either way. */
function AdjustCoinsModal({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [amount, setAmount] = useState(100);
  const [direction, setDirection] = useState<'credit' | 'deduct'>('credit');
  const [reason, setReason] = useState('manual adjustment');
  const adjust = trpc.users.creditTokens.useMutation({
    onSuccess: (r) => {
      toast.success(`${profile.name} now holds ${r.balance} 🪙`);
      void utils.users.list.invalidate();
      void utils.users.profile.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <ModalShell title={`Adjust ${profile.name}'s credits`} onClose={onClose}>
      <p className="text-sm text-ink-soft">
        Crediting a plain user makes them a moderator; taking their last coin returns them to a
        user. Admins keep their role either way.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <span>
          <label className="micro mb-1 block text-ink-soft" htmlFor="adj-dir">
            Direction
          </label>
          <SketchSelect
            id="adj-dir"
            value={direction}
            onChange={(e) => setDirection(e.target.value as 'credit' | 'deduct')}
          >
            <option value="credit">+ Add coins</option>
            <option value="deduct">− Remove coins</option>
          </SketchSelect>
        </span>
        <span>
          <label className="micro mb-1 block text-ink-soft" htmlFor="adj-amt">
            Amount
          </label>
          <SketchInput
            id="adj-amt"
            type="number"
            min={1}
            max={100000}
            className="w-28"
            value={String(amount)}
            onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 1))}
          />
        </span>
        <span className="min-w-[10rem] flex-1">
          <label className="micro mb-1 block text-ink-soft" htmlFor="adj-why">
            Reason (ledger)
          </label>
          <SketchInput id="adj-why" value={reason} onChange={(e) => setReason(e.target.value)} />
        </span>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <SketchButton variant="ghost" onClick={onClose}>
          Cancel
        </SketchButton>
        <SketchButton
          variant="accent"
          loading={adjust.isPending}
          onClick={() =>
            adjust.mutate({
              userId: profile.id,
              amount,
              direction,
              reason: reason.trim() || 'manual adjustment',
            })
          }
        >
          {direction === 'credit' ? 'Add' : 'Remove'} {amount} 🪙
        </SketchButton>
      </div>
    </ModalShell>
  );
}
