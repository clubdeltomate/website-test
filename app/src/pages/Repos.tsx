import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  PencilRuler,
  Plus,
  Search,
  Sparkles,
  Star,
  Table2,
  UserCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import AuthWall from '@/components/AuthWall';
import Chip from '@/components/sketch/Chip';
import EmptyState from '@/components/sketch/EmptyState';
import SketchButton from '@/components/sketch/SketchButton';
import SketchTable from '@/components/sketch/SketchTable';
import type { SketchColumn } from '@/components/sketch/SketchTable';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import type { RepoSummary, RepoTemplate } from '@contracts/types';
import RepoCard from '@/components/repo/RepoCard';
import AssignModal from '@/components/repo/AssignModal';
import {
  ProgressStrip,
  SketchToaster,
  TEMPLATE_META,
  TemplateIcon,
  relTime,
  useDebounced,
} from '@/components/repo/shared';

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const PAGE_SIZE = 12;

type SortKey = 'recent' | 'name' | 'lessons' | 'runs';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: 'Recent' },
  { key: 'name', label: 'Name A–Z' },
  { key: 'lessons', label: 'Most lessons' },
  { key: 'runs', label: 'Most runs' },
];

export default function Repos({ mine = true }: { mine?: boolean }) {
  const navigate = useNavigate();
  const { isGuest, user, role } = useAuth();
  const utils = trpc.useUtils();
  // Admins and a repo's own owner can delete it straight from the gallery card.
  const canDeleteRepo = (repo: RepoSummary) =>
    role === 'admin' || (!!user && repo.ownerName === user.name);
  const deleteRepo = trpc.repos.delete.useMutation({
    onSuccess: () => {
      toast.success('Repository deleted.');
      void utils.repos.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const onDeleteRepo = (repo: RepoSummary) => {
    if (window.confirm(`Delete "${repo.title}" and all its units, lessons and presets? This can't be undone.`)) {
      deleteRepo.mutate({ slug: repo.slug });
    }
  };

  const [q, setQ] = useState('');
  const debouncedQ = useDebounced(q, 250);
  const [template, setTemplate] = useState<RepoTemplate | 'all'>('all');
  const [favsOnly, setFavsOnly] = useState(false);
  const [followingOnly, setFollowingOnly] = useState(false);

  const [sort, setSort] = useState<SortKey>('recent');
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [page, setPage] = useState(1);
  const [authWallOpen, setAuthWallOpen] = useState(false);
  /** The repo whose Assign popup is open (hand it to another user's shelf). */
  const [assignFor, setAssignFor] = useState<RepoSummary | null>(null);
  // Assigning is a privilege of admins and VERIFIED moderators — ownership
  // alone doesn't grant it, and an unverified moderator waits for the check.
  const canAssign =
    !isGuest && (role === 'admin' || (role === 'moderator' && !!user?.verified));

  const list = trpc.repos.list.useQuery(
    {
      q: debouncedQ.trim() || undefined,
      template: template === 'all' ? undefined : template,
      limit: 100,
      mine,
      excludeMine: !mine,
      followingOnly: followingOnly && !mine,
    },
    { placeholderData: (prev) => prev },
  );

  /* -------- mobile: table falls back to cards with a one-time toast ------- */
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = () => {
      if (mq.matches) {
        setView((v) => {
          if (v === 'table') {
            toast.info('Tables need a bigger page — switched to cards.');
            return 'cards';
          }
          return v;
        });
      }
    };
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /* -------- favorites ------------------------------------------------------ */
  const toggleFavorite = trpc.repos.toggleFavorite.useMutation({
    onSuccess: (res) => {
      toast.success(res.favorite ? 'Pinned to your favorites ★' : 'Removed from favorites');
      void utils.repos.list.invalidate();
    },
    onError: () => toast.error("Couldn't update favorites — try again"),
  });

  const onToggleFavorite = (repo: RepoSummary) => {
    if (isGuest) {
      setAuthWallOpen(true);
      return;
    }
    toggleFavorite.mutate({ slug: repo.slug });
  };

  /* -------- filter + sort + paginate --------------------------------------- */
  const repos = useMemo(() => {
    let rows = list.data ?? [];
    if (favsOnly) rows = rows.filter((r) => r.favorite);
    const sorted = [...rows];
    switch (sort) {
      case 'name':
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'lessons':
        sorted.sort((a, b) => b.lessonCount - a.lessonCount);
        break;
      case 'runs':
        sorted.sort((a, b) => b.runCount - a.runCount);
        break;
      default:
        sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return sorted;
  }, [list.data, favsOnly, sort]);

  const pageCount = Math.max(1, Math.ceil(repos.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = repos.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, template, favsOnly, followingOnly, sort]);

  const onPickTemplate = (t: RepoTemplate | 'all') => setTemplate(t);
  const onPickFavs = () => {
    if (isGuest) {
      setAuthWallOpen(true);
      return;
    }
    setFavsOnly((f) => !f);
  };

  /* -------- table columns --------------------------------------------------- */
  const columns: SketchColumn<RepoSummary>[] = [
    {
      key: 'ref',
      header: 'Ref',
      render: (row) => <Chip kind="repo-ref">#{row.ref}</Chip>,
      sortValue: (row) => row.ref,
    },
    {
      key: 'title',
      header: 'Title',
      render: (row) => (
        <span className="inline-flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink bg-yellow-soft text-ink">
            <TemplateIcon template={row.template} className="h-3.5 w-3.5" />
          </span>
          {/* the card banner, shrunk to a table thumbnail */}
          {row.bannerUrl && (
            <img
              src={row.bannerUrl}
              alt=""
              loading="lazy"
              className="h-8 w-20 shrink-0 rounded-wobble-sm border-2 border-ink object-cover object-center"
            />
          )}
          <span className="font-heading font-semibold text-ink">{row.title}</span>
          {row.assigned && (
            <Chip kind="neutral" className="border-blue bg-blue-soft text-[0.55rem]" title="A moderator put this on your shelf">
              assigned
            </Chip>
          )}
          {row.source === 'ai' && (
            <span
              title="Generated with AI"
              className="inline-flex items-center gap-0.5 rounded-wobble-sm border border-purple bg-purple-soft px-1 text-[0.55rem] font-bold text-purple"
            >
              <Sparkles className="h-2.5 w-2.5" strokeWidth={2.5} /> AI
            </span>
          )}
        </span>
      ),
      sortValue: (row) => row.title.toLowerCase(),
    },
    {
      key: 'counts',
      header: 'Units / Lessons',
      mono: true,
      render: (row) => `${row.unitCount} / ${row.lessonCount}`,
      sortValue: (row) => row.lessonCount,
    },
    {
      key: 'runs',
      header: 'Runs',
      mono: true,
      render: (row) => row.runCount,
      sortValue: (row) => row.runCount,
    },
    {
      key: 'progress',
      header: 'Progress',
      render: (row) => (
        <ProgressStrip
          played={Math.min(row.myCompletedUnits, row.unitCount)}
          total={row.unitCount}
          noun="units"
          label="units done"
          className="min-w-[140px]"
        />
      ),
    },
    {
      key: 'created',
      header: 'Sketched',
      mono: true,
      render: (row) => relTime(row.createdAt),
      sortValue: (row) => new Date(row.createdAt).getTime(),
    },
    {
      key: 'fav',
      header: '★',
      render: (row) => (
        <button
          type="button"
          aria-label={row.favorite ? 'Remove from favorites' : 'Add to favorites'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(row);
          }}
          className="rounded-full p-1 transition-transform duration-200 hover:scale-125"
        >
          <Star
            className={cn('h-5 w-5', row.favorite ? 'fill-yellow text-ink' : 'text-ink-faint')}
            strokeWidth={2}
          />
        </button>
      ),
    },
  ];

  const searching = debouncedQ.trim().length > 0;

  return (
    <div className="mx-auto w-full max-w-content px-4 py-6 lg:px-8">
      <SketchToaster />
      <AuthWall
        open={authWallOpen}
        onClose={() => setAuthWallOpen(false)}
        message="Sign in to create repositories and pin favorites to your shelf."
      />
      {assignFor && (
        <AssignModal
          open
          onClose={() => setAssignFor(null)}
          targetType="repo"
          slug={assignFor.slug}
          title={assignFor.title}
        />
      )}

      {/* guest banner */}
      {isGuest && (
        <p className="mb-4 flex flex-wrap items-center gap-2 rounded-wobble-sm border-2 border-dashed border-blue/50 bg-blue-soft/50 px-4 py-2 text-sm text-ink">
          You're browsing as a guest —{' '}
          <Link to="/auth" className="font-bold text-blue hover:squiggle">
            sign in
          </Link>{' '}
          to create your own.
        </p>
      )}

      {/* heading */}
      <div className="flex items-center gap-3">
        <h2 className="sr-only">Repositories</h2>
        <p className="font-display text-3xl font-bold text-ink">{mine ? 'Your notebook shelf' : 'Community shelf'}</p>
        {list.data && (
          <Chip kind="neutral" className="font-mono">
            {repos.length}
          </Chip>
        )}
      </div>

      {/* toolbar */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="mt-4 flex flex-wrap items-center gap-2.5 rounded-wobble-sm border-2 border-ink bg-paper-3 p-3 shadow-offset"
      >
        {/* search */}
        <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 focus-within:border-blue focus-within:shadow-[4px_4px_0_#DDE9FB]">
          <Search className="h-4 w-4 shrink-0 text-ink-faint" strokeWidth={2} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search notebooks…"
            aria-label="Search repositories"
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
        </label>

        {/* favorites toggle */}
        <motion.button
          type="button"
          whileTap={{ scale: 1.25 }}
          onClick={onPickFavs}
          aria-pressed={favsOnly}
          title="Favorites only"
          className={cn(
            'flex items-center gap-1.5 rounded-wobble-sm border-2 px-3 py-2 text-sm font-bold transition-colors',
            favsOnly
              ? 'border-ink bg-yellow text-ink shadow-offset'
              : 'border-pencil text-ink-faint hover:border-ink hover:text-ink',
          )}
        >
          <Star className={cn('h-4 w-4', favsOnly && 'fill-ink')} strokeWidth={2} />
          Favorites
        </motion.button>

        {/* Following — gallery only. On your own shelf every item is yours, so
            filtering by "people I follow" would always come back empty. */}
        {!mine && (
          <motion.button
            type="button"
            whileTap={{ scale: 1.25 }}
            onClick={() => setFollowingOnly((f) => !f)}
            aria-pressed={followingOnly}
            title="Only work by people you follow"
            className={cn(
              'flex items-center gap-1.5 rounded-wobble-sm border-2 px-3 py-2 text-sm font-bold transition-colors',
              followingOnly
                ? 'border-ink bg-yellow text-ink shadow-offset'
                : 'border-pencil text-ink-faint hover:border-ink hover:text-ink',
            )}
          >
            <UserCheck className="h-4 w-4" strokeWidth={2} />
            Following
          </motion.button>
        )}

        {/* sort */}
        <label className="flex items-center gap-1.5 text-sm text-ink-soft">
          <span className="micro hidden text-[0.6rem] sm:inline">Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort repositories"
            className="rounded-wobble-sm border-2 border-ink bg-paper-3 px-2.5 py-1.5 text-sm font-bold text-ink outline-none"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        {/* view toggle */}
        <div className="flex overflow-hidden rounded-wobble-sm border-2 border-ink" role="group" aria-label="View">
          {(
            [
              { key: 'cards', icon: LayoutGrid, label: 'Cards' },
              { key: 'table', icon: Table2, label: 'Table' },
            ] as const
          ).map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              aria-pressed={view === v.key}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-sm font-bold transition-colors',
                view === v.key ? 'marker-highlight-yellow bg-paper-3 text-ink' : 'bg-paper-2 text-ink-faint hover:text-ink',
              )}
            >
              <v.icon className="h-4 w-4" strokeWidth={2} />
              {v.label}
            </button>
          ))}
        </div>

        {/* new repository — AI (lesson path) or by hand */}
        <div className="ml-auto flex items-center gap-2">
          <Link to="/repos/new/manual" className="no-underline">
            <SketchButton variant="secondary" size="sm" title="Lay out a repo by hand — no AI">
              <PencilRuler className="h-4 w-4" strokeWidth={2.5} />
              By hand
            </SketchButton>
          </Link>
          <Link to="/lesson-path" className="no-underline">
            <SketchButton variant="accent" size="sm">
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              New repository
            </SketchButton>
          </Link>
        </div>

        {/* template filter chips */}
        <div className="flex w-full flex-wrap items-center gap-1.5 border-t-2 border-dashed border-pencil pt-2.5">
          {(['all', 'course', 'restaurant', 'service', 'shop', 'walkthrough', 'news'] as const).map((t) => {
            const active = template === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => onPickTemplate(t)}
                aria-pressed={active}
                className={cn(
                  'flex items-center gap-1.5 rounded-wobble-sm border-2 px-2.5 py-1 text-xs font-bold transition-all',
                  active
                    ? 'border-ink bg-yellow/70 text-ink shadow-offset'
                    : 'border-pencil text-ink-soft hover:border-ink hover:text-ink',
                )}
              >
                {t !== 'all' && <TemplateIcon template={t} className="h-3.5 w-3.5" />}
                {t === 'all' ? 'All' : TEMPLATE_META[t].label}
              </button>
            );
          })}
        </div>
      </motion.div>

      {/* body */}
      <div className="mt-6">
        {list.isLoading && <GallerySkeleton />}

        {list.isError && (
          <div className="rounded-wobble-sm border-2 border-dashed border-red bg-red-soft/60 px-4 py-6 text-center">
            <p className="font-heading text-lg text-ink">The shelf fell off the wall…</p>
            <p className="mt-1 text-sm text-ink-soft">Couldn't load repositories.</p>
            <SketchButton variant="secondary" size="sm" className="mt-3" onClick={() => void list.refetch()}>
              Try again
            </SketchButton>
          </div>
        )}

        {list.isSuccess && repos.length === 0 && (
          searching || favsOnly || followingOnly || template !== 'all' ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <img src="/empty-repos.svg" alt="" className="w-40" />
              <h2 className="font-display text-3xl text-ink">
                No notebooks match{searching ? ` “${debouncedQ.trim()}”` : ' these filters'}
              </h2>
              <SketchButton
                variant="secondary"
                size="sm"
                onClick={() => {
                  setQ('');
                  setTemplate('all');
                  setFavsOnly(false);
                }}
              >
                Clear search & filters
              </SketchButton>
            </div>
          ) : (
            <EmptyState
              image="/empty-repos.svg"
              imageAlt="Empty notebook doodle"
              headline="Your shelf is empty — let's sketch your first notebook"
              explainer="Courses, menus, service catalogs, product collections — one builder does it all."
              ctaLabel="Open the Lesson Path"
              onCta={() => (isGuest ? setAuthWallOpen(true) : navigate('/lesson-path'))}
            >
              <Link to="/" className="text-sm font-bold text-blue hover:squiggle">
                Ask the Coach instead
              </Link>
            </EmptyState>
          )
        )}

        {list.isSuccess && repos.length > 0 && (
          <AnimatePresence mode="wait">
            {view === 'cards' ? (
              <motion.div
                key="cards"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.25 }}
                className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
              >
                {pageRows.map((repo, i) => (
                  <RepoCard
                    key={repo.slug}
                    repo={repo}
                    index={i}
                    onToggleFavorite={onToggleFavorite}
                    canDelete={canDeleteRepo(repo)}
                    onDelete={onDeleteRepo}
                    onAssign={canAssign ? setAssignFor : undefined}
                  />
                ))}
              </motion.div>
            ) : (
              <motion.div
                key="table"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.25 }}
              >
                <SketchTable
                  columns={columns}
                  rows={pageRows}
                  rowKey={(row) => row.slug}
                  onRowClick={(row) => navigate(`/repos/${row.slug}`)}
                />
              </motion.div>
            )}
          </AnimatePresence>
        )}

        {/* pagination */}
        {repos.length > PAGE_SIZE && (
          <nav aria-label="Pagination" className="mt-8 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              aria-label="Previous page"
              className="rounded-full p-1.5 text-ink transition-colors hover:bg-paper-2 disabled:opacity-40"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPage(n)}
                aria-current={n === safePage ? 'page' : undefined}
                className={cn(
                  'flex h-10 w-10 items-center justify-center font-display text-xl text-ink transition-transform hover:-translate-y-0.5',
                  n === safePage && 'rounded-full border-2 border-ink bg-yellow-soft shadow-offset',
                )}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={safePage === pageCount}
              aria-label="Next page"
              className="rounded-full p-1.5 text-ink transition-colors hover:bg-paper-2 disabled:opacity-40"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}

/** Pencil-stroke skeletons + playful status line (design.md §6) */
function GallerySkeleton() {
  return (
    <div aria-label="Loading repositories">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="rounded-wobble-2 border-2 border-dashed border-pencil bg-paper-3/60 p-5">
            <div className="flex items-center gap-3">
              <div className="skeleton-stroke h-11 w-11 rounded-full" />
              <div className="skeleton-stroke h-4 flex-1" />
            </div>
            <div className="skeleton-stroke mt-4 h-5 w-3/4" />
            <div className="skeleton-stroke mt-2 h-3 w-1/2" />
            <div className="skeleton-stroke mt-4 h-2.5 w-full" />
          </div>
        ))}
      </div>
      <p className="mt-4 text-center text-sm text-ink-faint">Dusting off the shelf…</p>
    </div>
  );
}
