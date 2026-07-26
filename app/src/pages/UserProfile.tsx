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
  Sparkles,
  Star,
  Ticket,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import Chip from '@/components/sketch/Chip';
import SketchButton from '@/components/sketch/SketchButton';
import RepoCard from '@/components/repo/RepoCard';
import { TemplateIcon } from '@/components/repo/shared';
import type { RepoSummary, RepoTemplate, SlideToolSummary, UserProfile as Profile } from '@contracts/types';

const CATEGORIES = ['all', 'course', 'restaurant', 'service', 'shop'] as const;
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
  const [aiOnly, setAiOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [coinOpen, setCoinOpen] = useState(false);

  const profile = trpc.users.profile.useQuery({ userId }, { enabled: Number.isFinite(userId) });

  const toggleFav = trpc.users.toggleFavorite.useMutation({
    onMutate: async () => {
      await utils.users.profile.cancel({ userId });
      const prev = utils.users.profile.getData({ userId });
      utils.users.profile.setData({ userId }, (old) => (old ? { ...old, favorite: !old.favorite } : old));
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
        .filter((r) => !aiOnly || r.source === 'ai'),
    [repos, category, q, aiOnly],
  );
  const filteredTools = useMemo(
    () =>
      tools
        .filter((t) => !q || t.name.toLowerCase().includes(q))
        .filter((t) => !aiOnly || t.source === 'ai'),
    [tools, q, aiOnly],
  );

  const items: (RepoSummary | SlideToolSummary)[] = tab === 'repos' ? filteredRepos : filteredTools;
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = items.slice(safePage * PAGE, safePage * PAGE + PAGE);
  useEffect(() => setPage(0), [tab, category, q, aiOnly]);

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

  const onFav = () => {
    if (isGuest) return toast.error('Sign in to favorite');
    toggleFav.mutate({ userId });
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
            onClick={onFav}
            className={cn(
              'flex items-center gap-1.5 rounded-wobble-sm border-2 px-3 py-2 text-sm font-bold transition-colors',
              p.favorite
                ? 'border-ink bg-yellow text-ink shadow-offset'
                : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
            )}
          >
            <Star className={cn('h-4 w-4', p.favorite && 'fill-ink')} strokeWidth={2} />
            {p.favorite ? 'Favorited' : 'Favorite'}
          </button>
          {canRequestTickets && (
            <SketchButton variant="accent" size="sm" onClick={() => setTicketOpen(true)}>
              <Ticket className="h-4 w-4" /> Request tickets
            </SketchButton>
          )}
          {canRequestCoins && (
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
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === 'repos' ? 'Search repos by name…' : 'Search slides by name…'}
            className="min-w-[200px] flex-1 rounded-wobble-sm border-2 border-ink bg-paper px-3 py-2 text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue"
          />
          <button
            type="button"
            onClick={() => setAiOnly((a) => !a)}
            className={cn(
              'flex items-center gap-1.5 rounded-wobble-sm border-2 px-3 py-2 text-xs font-bold transition-colors',
              aiOnly
                ? 'border-ink bg-purple-soft text-purple shadow-offset'
                : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
            )}
          >
            <Sparkles className="h-4 w-4" /> Made with AI
          </button>
        </div>
        {tab === 'repos' && (
          <div className="flex flex-wrap gap-2 border-t-2 border-dashed border-pencil pt-2.5">
            {CATEGORIES.map((c) => (
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
          </div>
        )}
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
