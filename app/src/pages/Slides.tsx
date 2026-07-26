import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Search,
  Star,
  LayoutGrid,
  Rows3,
  Play,
  Plus,
  Presentation,
  Sparkles,
  MoreHorizontal,
  Trash2,
  Copy,
  Pencil,
  PencilRuler,
  Route,
} from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import type { RepoTemplate, SlideToolSummary } from '@contracts/types';
import SketchButton from '@/components/sketch/SketchButton';
import Chip from '@/components/sketch/Chip';
import SketchCard from '@/components/sketch/SketchCard';
import SketchTable, { type SketchColumn } from '@/components/sketch/SketchTable';
import EmptyState from '@/components/sketch/EmptyState';
import AuthWall from '@/components/AuthWall';
import { Toaster } from '@/components/ui/sonner';
import CreateToolModal from '@/components/slides/CreateToolModal';
import { SourceBadge, TemplateIcon, TEMPLATE_CIRCLE_BG, TEMPLATE_META } from '@/components/repo/shared';

type SortKey = 'recent' | 'name' | 'plays';
type ViewMode = 'cards' | 'table';

const PAGE_SIZE = 12;


function relTime(d: Date): string {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(d).toLocaleDateString();
}

function StarButton({
  favorite,
  onToggle,
}: {
  favorite: boolean;
  onToggle: () => void;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.7 }}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onToggle();
      }}
      aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
      className="rounded-wobble-sm p-1.5 text-ink transition-colors hover:bg-yellow-soft"
    >
      <motion.span
        key={String(favorite)}
        initial={{ scale: 0.6 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 15 }}
        className="block"
      >
        <Star
          className={cn('h-5 w-5', favorite ? 'fill-yellow text-ink' : 'text-ink-faint')}
          strokeWidth={2}
        />
      </motion.span>
    </motion.button>
  );
}

export default function Slides() {
  const navigate = useNavigate();
  const { isGuest, user, role } = useAuth();
  const utils = trpc.useUtils();
  // Admins and a tool's own owner can delete it straight from the gallery card.
  const canDeleteTool = (tool: SlideToolSummary) =>
    role === 'admin' || (!!user && tool.ownerName === user.name);

  const [search, setSearch] = useState('');
  const [favOnly, setFavOnly] = useState(false);
  const [template, setTemplate] = useState<RepoTemplate | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('recent');
  const [view, setView] = useState<ViewMode>('cards');
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const toolsQuery = trpc.slideTools.list.useQuery(
    { q: search.trim() || undefined, limit: 100 },
    { placeholderData: (prev) => prev },
  );
  // repo linkage heuristic: tools created by Lesson Path are named <repoSlug>-studio
  const reposQuery = trpc.repos.list.useQuery({ limit: 100 });
  const repoLinkByTool = useMemo(() => {
    const map = new Map<string, { slug: string; ref: string }>();
    for (const repo of reposQuery.data ?? []) {
      map.set(`${repo.slug}-studio`, { slug: repo.slug, ref: repo.ref });
    }
    return map;
  }, [reposQuery.data]);

  const favMutation = trpc.slideTools.toggleFavorite.useMutation({
    onSuccess: () => utils.slideTools.list.invalidate(),
    onError: (err) => toast.error(err.message),
  });
  const deleteMutation = trpc.slideTools.delete.useMutation({
    onSuccess: () => {
      toast.success('Slide tool deleted.');
      utils.slideTools.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const duplicateMutation = trpc.slideTools.create.useMutation({
    onSuccess: () => {
      toast.success('Duplicated — find the copy at the top of the drawer.');
      utils.slideTools.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const requireAuth = (fn: () => void) => () => {
    if (isGuest) setAuthOpen(true);
    else fn();
  };

  const tools = useMemo(() => {
    let list = [...(toolsQuery.data ?? [])];
    if (favOnly) list = list.filter((t) => t.favorite);
    if (template !== 'all') list = list.filter((t) => t.template === template);
    switch (sort) {
      case 'name':
        list.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'plays':
        list.sort((a, b) => b.runCount - a.runCount);
        break;
      default:
        list.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
    }
    return list;
  }, [toolsQuery.data, favOnly, template, sort]);

  const pageCount = Math.max(1, Math.ceil(tools.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageTools = tools.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const prefetch = (slug: string) => {
    void utils.slideTools.getBySlug.prefetch({ slug });
  };

  const renameTool = (tool: SlideToolSummary) => {
    const name = window.prompt('Rename slide tool', tool.name);
    if (!name || name.trim().length < 3 || name.trim() === tool.name) return;
    utils.client.slideTools.update
      .mutate({ slug: tool.slug, name: name.trim() })
      .then(() => {
        toast.success('Renamed.');
        utils.slideTools.list.invalidate();
      })
      .catch((err: Error) => toast.error(err.message));
  };

  const duplicateTool = (tool: SlideToolSummary) => {
    duplicateMutation.mutate({
      name: `${tool.name} (copy)`,
      description: tool.description,
      topic: tool.topic,
      instructions: tool.instructions,
      defaultLevel: tool.defaultLevel,
      defaultSlideCount: tool.defaultSlideCount,
      defaultImageStyle: tool.defaultImageStyle,
    });
  };

  const deleteTool = (tool: SlideToolSummary) => {
    if (window.confirm(`Delete "${tool.name}"? This can't be undone.`)) {
      deleteMutation.mutate({ slug: tool.slug });
    }
  };

  const columns: SketchColumn<SlideToolSummary>[] = [
    {
      key: 'name',
      header: 'Name',
      sortValue: (t) => t.name.toLowerCase(),
      render: (t) => (
        <span className="flex flex-col">
          <span className="font-heading font-semibold text-ink">{t.name}</span>
          <span className="font-mono text-xs text-ink-faint">{t.slug}</span>
        </span>
      ),
    },
    {
      key: 'link',
      header: 'Ref / Link',
      render: (t) =>
        repoLinkByTool.get(t.slug) ? (
          <Chip kind="repo-ref">#{repoLinkByTool.get(t.slug)!.ref}</Chip>
        ) : (
          <Chip kind="neutral" className="border-dashed">
            Direct
          </Chip>
        ),
    },
    {
      key: 'level',
      header: 'Level',
      sortValue: (t) => t.defaultLevel,
      render: (t) => <Chip kind={t.defaultLevel}>{t.defaultLevel}</Chip>,
    },
    {
      key: 'style',
      header: 'Style',
      render: (t) =>
        t.defaultImageStyle === 'none' ? (
          <span className="text-xs text-ink-faint">none</span>
        ) : (
          <img
            src={`/style-${t.defaultImageStyle}.svg`}
            alt={t.defaultImageStyle}
            title={t.defaultImageStyle}
            className="h-8 w-12 rounded-wobble-sm border-2 border-ink object-cover"
          />
        ),
    },
    {
      key: 'plays',
      header: 'Plays',
      mono: true,
      sortValue: (t) => t.runCount,
      render: (t) => t.runCount,
    },
    {
      key: 'slides',
      header: 'Slides',
      mono: true,
      sortValue: (t) => t.defaultSlideCount,
      render: (t) => t.defaultSlideCount,
    },
    {
      key: 'created',
      header: 'Made',
      mono: true,
      sortValue: (t) => new Date(t.createdAt).getTime(),
      render: (t) => relTime(t.createdAt),
    },
    {
      key: 'fav',
      header: '★',
      render: (t) => (
        <StarButton
          favorite={t.favorite}
          onToggle={requireAuth(() => favMutation.mutate({ slug: t.slug }))}
        />
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (t) => (
        <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Link to={`/slides/${t.slug}`} title="New presentation">
            <SketchButton variant="accent" size="sm">
              <Play className="h-3.5 w-3.5" strokeWidth={2.5} />
            </SketchButton>
          </Link>
          <span className="relative">
            <button
              className="rounded-wobble-sm p-2 text-ink-soft hover:bg-paper-2 hover:text-ink"
              aria-label="More actions"
              onClick={() => setMenuFor((m) => (m === t.slug ? null : t.slug))}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuFor === t.slug && (
              <span className="absolute right-0 top-full z-40 mt-1 block w-44 rounded-wobble-sm border-2 border-ink bg-paper-3 p-1.5 shadow-offset">
                <button
                  className="flex w-full items-center gap-2 rounded-wobble-sm px-2.5 py-1.5 text-left text-sm font-bold text-ink hover:bg-paper-2"
                  onClick={requireAuth(() => {
                    setMenuFor(null);
                    renameTool(t);
                  })}
                >
                  <Pencil className="h-3.5 w-3.5" /> Rename
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded-wobble-sm px-2.5 py-1.5 text-left text-sm font-bold text-ink hover:bg-paper-2"
                  onClick={requireAuth(() => {
                    setMenuFor(null);
                    duplicateTool(t);
                  })}
                >
                  <Copy className="h-3.5 w-3.5" /> Duplicate
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded-wobble-sm px-2.5 py-1.5 text-left text-sm font-bold text-red hover:bg-red-soft"
                  onClick={requireAuth(() => {
                    setMenuFor(null);
                    deleteTool(t);
                  })}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              </span>
            )}
          </span>
        </span>
      ),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-content px-4 py-8 lg:px-8">
      <Toaster position="bottom-right" />
      {/* header */}
      <div className="flex items-end gap-3">
        <h1 className="font-display text-[32px] font-bold leading-none text-ink">
          Slide tools
        </h1>
        {!toolsQuery.isLoading && (
          <Chip kind="slide-tool">{tools.length} in the drawer</Chip>
        )}
      </div>

      {/* guest banner */}
      {isGuest && (
        <p className="mt-3 inline-block rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-2 px-3 py-1.5 text-sm text-ink-soft">
          Browsing as guest — you can play any tool's demo deck.{' '}
          <Link to="/auth" className="squiggle font-bold">
            Sign in
          </Link>{' '}
          to create your own.
        </p>
      )}

      {/* toolbar — same layout & design language as the Repos gallery */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mt-5 flex flex-wrap items-center gap-2.5 rounded-wobble-sm border-2 border-ink bg-paper-3 p-3 shadow-offset"
      >
        {/* search */}
        <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 focus-within:border-blue focus-within:shadow-[4px_4px_0_#DDE9FB]">
          <Search className="h-4 w-4 shrink-0 text-ink-faint" strokeWidth={2} />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search slide tools…"
            aria-label="Search slide tools"
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
        </label>

        {/* favorites toggle */}
        <motion.button
          type="button"
          whileTap={{ scale: 1.25 }}
          onClick={requireAuth(() => {
            setFavOnly((f) => !f);
            setPage(0);
          })}
          aria-pressed={favOnly}
          title="Favorites only"
          className={cn(
            'flex items-center gap-1.5 rounded-wobble-sm border-2 px-3 py-2 text-sm font-bold transition-colors',
            favOnly
              ? 'border-ink bg-yellow text-ink shadow-offset'
              : 'border-pencil text-ink-faint hover:border-ink hover:text-ink',
          )}
        >
          <Star className={cn('h-4 w-4', favOnly && 'fill-ink')} strokeWidth={2} />
          Favorites
        </motion.button>

        {/* sort */}
        <label className="flex items-center gap-1.5 text-sm text-ink-soft">
          <span className="micro hidden text-[0.6rem] sm:inline">Sort</span>
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as SortKey);
              setPage(0);
            }}
            aria-label="Sort slide tools"
            className="rounded-wobble-sm border-2 border-ink bg-paper-3 px-2.5 py-1.5 text-sm font-bold text-ink outline-none"
          >
            <option value="recent">Recent</option>
            <option value="name">Name</option>
            <option value="plays">Most played</option>
          </select>
        </label>

        {/* view toggle */}
        <div className="flex overflow-hidden rounded-wobble-sm border-2 border-ink" role="group" aria-label="View">
          {(
            [
              { key: 'cards', icon: LayoutGrid, label: 'Cards' },
              { key: 'table', icon: Rows3, label: 'Table' },
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

        {/* new presentation — by hand or AI slide tool */}
        <div className="ml-auto flex items-center gap-2">
          <SketchButton
            variant="secondary"
            size="sm"
            onClick={requireAuth(() => navigate('/slides/build'))}
            title="Build a presentation by hand — no AI"
          >
            <PencilRuler className="h-4 w-4" strokeWidth={2.5} />
            By hand
          </SketchButton>
          <SketchButton
            variant="accent"
            size="sm"
            onClick={requireAuth(() => setCreateOpen(true))}
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            New slide tool
          </SketchButton>
        </div>

        {/* template filter chips */}
        <div className="flex w-full flex-wrap items-center gap-1.5 border-t-2 border-dashed border-pencil pt-2.5">
          {(['all', 'course', 'restaurant', 'service', 'shop', 'walkthrough', 'news'] as const).map((t) => {
            const active = template === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTemplate(t);
                  setPage(0);
                }}
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

      {/* content */}
      <div className="mt-6">
        {toolsQuery.isLoading ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-3 rounded-wobble-2 border-2 border-dashed border-pencil p-5">
                <div className="skeleton-stroke h-10 w-10 rounded-full" />
                <div className="skeleton-stroke h-5 w-3/4" />
                <div className="skeleton-stroke h-4 w-1/2" />
                <div className="skeleton-stroke h-8 w-full" />
              </div>
            ))}
            <p className="col-span-full text-center font-display text-2xl text-ink-faint">
              Sharpening pencils…
            </p>
          </div>
        ) : tools.length === 0 ? (
          search.trim() || favOnly || template !== 'all' ? (
            <EmptyState
              image="/empty-slides.svg"
              headline={`No tools match '${search.trim() || (template !== 'all' ? TEMPLATE_META[template].label : 'favorites')}'`}
              explainer="Try a different search, or clear the filters."
              ctaLabel="Clear filters"
              onCta={() => {
                setSearch('');
                setFavOnly(false);
                setTemplate('all');
              }}
            />

          ) : (
            <EmptyState
              image="/empty-slides.svg"
              headline="No slide tools yet"
              explainer="Make one directly — or let the Lesson Path create a repo and its tool together."
              ctaLabel={isGuest ? 'Sign in to create' : 'New slide tool'}
              onCta={requireAuth(() => setCreateOpen(true))}
            >
              <Link to="/lesson-path" className="mt-1">
                <SketchButton variant="ghost">
                  <Route className="h-4 w-4" />
                  Open Lesson Path
                </SketchButton>
              </Link>
            </EmptyState>
          )
        ) : view === 'cards' ? (
          <AnimatePresence mode="popLayout">
            <motion.div
              key={`cards-${safePage}-${sort}`}
              className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
              initial="hidden"
              animate="show"
              variants={{ show: { transition: { staggerChildren: 0.05 } } }}
            >
              {pageTools.map((tool, i) => {
                const repo = repoLinkByTool.get(tool.slug);
                const isDraft = !tool.hasDeck && tool.runCount === 0;
                return (
                  <motion.div
                    key={tool.slug}
                    variants={{
                      hidden: { opacity: 0, y: 16 },
                      show: { opacity: 1, y: 0 },
                    }}
                  >
                    <SketchCard
                      index={i}
                      hover
                      className={cn(
                        'relative flex h-full flex-col gap-3 p-5',
                        isDraft && 'border-dashed !border-green',
                      )}
                      onMouseEnter={() => prefetch(tool.slug)}
                      onClick={() =>
                        navigate(tool.hasDeck ? `/slides/show/${tool.slug}` : `/slides/${tool.slug}`)
                      }
                    >
                      <div className="flex items-start justify-between">
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className={cn(
                              'flex h-11 w-11 items-center justify-center rounded-full border-2 border-ink text-ink',
                              TEMPLATE_CIRCLE_BG[tool.template] ?? 'bg-blue-soft',
                            )}
                            title={tool.template}
                          >
                            <TemplateIcon template={tool.template} className="h-5 w-5" />
                          </span>
                          {isDraft && (
                            <span
                              title="Only you (and admins) can see this draft"
                              className="rounded-wobble-sm border-2 border-dashed border-green bg-green-soft px-2 py-0.5 text-xs font-bold text-ink"
                            >
                              Draft
                            </span>
                          )}
                          <span className="micro truncate text-ink-faint">by {tool.ownerName}</span>
                        </span>
                        <span className="flex items-center gap-0.5">
                          {repo && (
                            <Sparkles
                              className="h-4 w-4 text-purple"
                              aria-label="AI-linked to a repo"
                            />
                          )}
                          <StarButton
                            favorite={tool.favorite}
                            onToggle={requireAuth(() =>
                              favMutation.mutate({ slug: tool.slug }),
                            )}
                          />
                          {canDeleteTool(tool) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                deleteTool(tool);
                              }}
                              aria-label="Delete slide tool"
                              title="Delete this slide tool"
                              className="rounded-wobble-sm p-1.5 text-ink-faint transition-colors hover:bg-red-soft hover:text-red"
                            >
                              <Trash2 className="h-4 w-4" strokeWidth={2} />
                            </button>
                          )}
                        </span>
                      </div>

                      <div>
                        <h3 className="line-clamp-2 font-heading text-lg font-semibold leading-snug text-ink">
                          {tool.name}
                        </h3>
                        <p className="font-mono text-xs text-ink-faint">{tool.slug}</p>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <Chip kind={tool.defaultLevel}>{tool.defaultLevel}</Chip>
                        <Chip kind="neutral" className="gap-1.5">
                          {tool.defaultImageStyle !== 'none' && (
                            <img
                              src={`/style-${tool.defaultImageStyle}.svg`}
                              alt=""
                              className="h-4 w-6 rounded-sm border border-ink object-cover"
                            />
                          )}
                          {tool.defaultImageStyle}
                        </Chip>
                        {repo ? (
                          <Chip kind="repo-ref">#{repo.ref}</Chip>
                        ) : (
                          <Chip kind="neutral" className="border-dashed">
                            Direct
                          </Chip>
                        )}
                        <SourceBadge source={tool.source} />
                      </div>

                      <p className="micro text-ink-faint">
                        {tool.runCount} {tool.runCount === 1 ? 'play' : 'plays'} ·{' '}
                        {tool.deckSlideCount ?? tool.defaultSlideCount} slides ·{' '}
                        {relTime(tool.createdAt)}
                      </p>

                      <div
                        className="mt-auto flex items-center gap-2 border-t-2 border-dashed border-pencil pt-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {tool.hasDeck ? (
                          <>
                            <Link to={`/slides/show/${tool.slug}`}>
                              <SketchButton variant="accent" size="sm" className="w-40 justify-center">
                                <Play className="h-3.5 w-3.5" strokeWidth={2.5} />
                                Play
                              </SketchButton>
                            </Link>
                            <Link to={`/slides/build/${tool.slug}`}>
                              <SketchButton variant="ghost" size="sm">
                                <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                                Edit
                              </SketchButton>
                            </Link>
                          </>
                        ) : tool.runCount === 0 ? (
                          // Configured but never generated — a green call-to-action.
                          <>
                            <Link to={`/slides/${tool.slug}`} className="no-underline">
                              <span className="flex w-40 items-center justify-center gap-1.5 rounded-wobble-sm border-2 border-ink bg-green px-3 py-1.5 text-sm font-bold text-paper-3 shadow-offset transition-colors hover:bg-[#3f8850]">
                                <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />
                                Generate
                              </span>
                            </Link>
                            <Link to={`/slides/${tool.slug}`}>
                              <SketchButton variant="ghost" size="sm">
                                Open
                              </SketchButton>
                            </Link>
                          </>
                        ) : (
                          <>
                            <Link to={`/slides/${tool.slug}`}>
                              <SketchButton variant="accent" size="sm" className="w-40 justify-center">
                                <Play className="h-3.5 w-3.5" strokeWidth={2.5} />
                                Play
                              </SketchButton>
                            </Link>
                            <Link to={`/slides/${tool.slug}`}>
                              <SketchButton variant="ghost" size="sm">
                                Open
                              </SketchButton>
                            </Link>
                          </>
                        )}
                      </div>
                    </SketchCard>
                  </motion.div>
                );
              })}
            </motion.div>
          </AnimatePresence>
        ) : (
          <motion.div
            key={`table-${safePage}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
          >
            <SketchTable
              columns={columns}
              rows={pageTools}
              rowKey={(t) => t.slug}
              onRowClick={(t) => navigate(`/slides/${t.slug}`)}
            />
          </motion.div>
        )}

        {/* pagination */}
        {tools.length > PAGE_SIZE && (
          <nav
            className="mt-8 flex items-center justify-center gap-2 font-display text-2xl"
            aria-label="Pagination"
          >
            <button
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="px-2 text-ink disabled:text-pencil"
              aria-label="Previous page"
            >
              ←
            </button>
            {Array.from({ length: pageCount }).map((_, i) => (
              <button
                key={i}
                onClick={() => setPage(i)}
                aria-current={i === safePage ? 'page' : undefined}
                className={cn(
                  'px-2 transition-transform hover:-translate-y-0.5',
                  i === safePage
                    ? 'rounded-full border-2 border-ink bg-yellow-soft px-3 text-ink'
                    : 'text-ink-faint hover:text-ink',
                )}
              >
                {i + 1}
              </button>
            ))}
            <button
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              className="px-2 text-ink disabled:text-pencil"
              aria-label="Next page"
            >
              →
            </button>
          </nav>
        )}
      </div>

      {/* footer doodle when empty drawer */}
      {!toolsQuery.isLoading && tools.length > 0 && (
        <p className="mt-10 flex items-center justify-center gap-2 text-center text-sm text-ink-faint">
          <Presentation className="h-4 w-4" />
          Hover a card to warm it up — the tool page opens instantly.
        </p>
      )}

      <CreateToolModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <AuthWall
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        message="Sign in to create slide tools, star favorites, and keep your decks."
      />
    </div>
  );
}
