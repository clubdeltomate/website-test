import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ChevronLeft, ChevronRight, Grid3x3, Plus, Rows3, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import { POST_CATEGORIES, type PostCategory, type PostSummary } from '@contracts/post';
import { TEMPLATE_META, VerifiedBadge } from '@/components/repo/shared';
import SketchButton from '@/components/sketch/SketchButton';
import EmptyState from '@/components/sketch/EmptyState';

/* The feed — the front door.
 *
 * Two ways to look at the same posts. "Feed" runs them full width, one
 * carousel at a time, the way they were designed to be seen; "Grid" lays every
 * slide out as a thumbnail like a profile page. The filter is the shelf's
 * filter, over the same six categories, so moving between the two doesn't mean
 * learning a second vocabulary. */

type View = 'feed' | 'grid';

/**
 * How tall a post's picture may get.
 *
 * Sized against the screen rather than the column, because a 9:16 carousel at
 * a fixed column width is about a thousand pixels tall — you saw a slice of it
 * and scrolled the rest, while the desktop's width went spare. Fitting the
 * viewport instead means the whole post is on screen at once and the width
 * follows from the shape, so a square or 4:5 post comes out wider than a story
 * does.
 *
 * The subtraction is everything else on screen, measured rather than guessed:
 * the app bar, the page padding, the heading and filter rows, the card's own
 * header and its caption. A caption of more than a couple of lines will still
 * push a little below the fold, which is what Instagram does too.
 *
 * The floor matters as much as the ceiling: on a short laptop, fitting a 9:16
 * post exactly would shrink it to a postage stamp, and a readable post you
 * scroll a little is worth more than a tiny one that fits.
 */
export const MEDIA_MAX_H = 'clamp(420px, calc(100dvh - 330px), 900px)';

/** Swipe through one post's slides in place. */
function Carousel({ post, maxHeight = MEDIA_MAX_H }: { post: PostSummary; maxHeight?: string }) {
  const [at, setAt] = useState(0);
  const many = post.imageUrls.length > 1;
  return (
    <div className="relative flex max-w-full overflow-hidden bg-ink/5">
      {/* The picture sizes the frame. An <img> with an aspect ratio and both
          caps scales itself down preserving shape, which no amount of
          height-on-a-div does without either cropping or letterboxing. */}
      <img
        src={post.imageUrls[at]}
        alt={`Slide ${at + 1} of ${post.imageUrls.length}`}
        className="block h-auto w-auto max-w-full object-cover"
        style={{ aspectRatio: `${post.width} / ${post.height}`, maxHeight }}
      />
      {many && (
        <>
          <button
            type="button"
            disabled={at === 0}
            onClick={() => setAt((a) => a - 1)}
            aria-label="Previous slide"
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-paper-3/90 p-1.5 text-ink shadow-offset disabled:opacity-0"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            disabled={at === post.imageUrls.length - 1}
            onClick={() => setAt((a) => a + 1)}
            aria-label="Next slide"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-paper-3/90 p-1.5 text-ink shadow-offset disabled:opacity-0"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
          </button>
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
            {post.imageUrls.map((_, i) => (
              <span
                key={i}
                className={cn(
                  'h-1.5 w-1.5 rounded-full border border-ink',
                  i === at ? 'bg-ink' : 'bg-paper-3/70',
                )}
              />
            ))}
          </div>
          <span className="absolute right-2 top-2 rounded-full border-2 border-ink bg-paper-3/90 px-2 font-mono text-[0.6rem] text-ink">
            {at + 1}/{post.imageUrls.length}
          </span>
        </>
      )}
    </div>
  );
}

function PostCard({ post, onRemove }: { post: PostSummary; onRemove: (slug: string) => void }) {
  const meta = TEMPLATE_META[post.category as PostCategory] ?? TEMPLATE_META.course;
  const Icon = meta.icon;
  const { user } = useAuth();
  const canRemove = post.mine || user?.role === 'admin';
  return (
    // w-fit so the header and caption line up with the picture's edges,
    // whatever width fitting the screen gave it.
    <article className="flex w-fit max-w-full flex-col overflow-hidden rounded-wobble-2 border-2 border-ink bg-paper-3 shadow-offset">
      <header className="flex items-center gap-2 px-3 py-2">
        <Link
          to={`/users/${post.ownerId}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-ink bg-paper-2 font-heading text-[0.7rem] font-bold text-ink"
        >
          {post.ownerAvatarUrl ? (
            <img src={post.ownerAvatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            post.ownerName.slice(0, 1).toUpperCase()
          )}
        </Link>
        <Link to={`/users/${post.ownerId}`} className="text-sm font-bold text-ink hover:underline">
          {post.ownerName}
        </Link>
        {post.ownerVerified && <VerifiedBadge />}
        <span
          title={meta.label}
          className="micro ml-auto flex items-center gap-1 rounded-wobble-sm border-2 border-dashed border-pencil px-1.5 py-0.5 text-[0.55rem] font-bold text-ink-soft"
        >
          <Icon className="h-3 w-3" strokeWidth={2} />
          {meta.label}
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={() => onRemove(post.slug)}
            aria-label={`Delete ${post.slug}`}
            className="text-ink-faint hover:text-red"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        )}
      </header>
      <Link to={`/feed/${post.slug}`} className="flex border-y-2 border-ink">
        <Carousel post={post} />
      </Link>
      {post.caption && (
        <p className="max-w-full whitespace-pre-wrap break-words px-3 py-2 text-[0.92rem] leading-relaxed text-ink">
          {post.caption}
        </p>
      )}
    </article>
  );
}

export default function Feed() {
  const [view, setView] = useState<View>('feed');
  const [category, setCategory] = useState<PostCategory | null>(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const list = trpc.posts.list.useQuery({ category: category ?? undefined, limit: 30 });

  const remove = async (slug: string) => {
    try {
      await utils.client.posts.remove.mutate({ slug });
      await list.refetch();
      toast.success('Post removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That post couldn't be removed");
    }
  };

  const feed = list.data ?? [];
  /** Every slide of every post, flattened — the grid shows pictures, not posts. */
  const tiles = feed.flatMap((p) =>
    p.imageUrls.map((url, i) => ({ url, slug: p.slug, key: `${p.slug}-${i}` })),
  );

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-4 px-4 py-5 lg:px-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl text-ink">The feed</h1>
        {feed.length > 0 && (
          <span className="micro rounded-wobble-sm border-2 border-ink bg-yellow-soft px-2 py-0.5 text-[0.6rem] font-bold text-ink">
            {feed.length}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-wobble-sm border-2 border-ink shadow-offset">
            {(
              [
                { id: 'feed' as const, label: 'Feed', icon: Rows3 },
                { id: 'grid' as const, label: 'Grid', icon: Grid3x3 },
              ]
            ).map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setView(v.id)}
                aria-pressed={view === v.id}
                className={cn(
                  'micro flex items-center gap-1 px-2.5 py-1.5 text-[0.6rem] font-bold transition-colors',
                  view === v.id ? 'bg-yellow text-ink' : 'bg-paper-3 text-ink-soft hover:text-ink',
                )}
              >
                <v.icon className="h-3.5 w-3.5" strokeWidth={2} />
                {v.label}
              </button>
            ))}
          </div>
          {user?.role === 'admin' && (
            <SketchButton variant="accent" onClick={() => navigate('/admin/projects/marketing')}>
              <Plus className="h-4 w-4" strokeWidth={2.5} /> New post
            </SketchButton>
          )}
        </div>
      </div>

      {/* the shelf's filter, over the same six categories */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setCategory(null)}
          aria-pressed={category === null}
          className={cn(
            'micro rounded-wobble-sm border-2 px-2.5 py-1 text-[0.6rem] font-bold transition-colors',
            category === null
              ? 'border-ink bg-yellow text-ink shadow-offset'
              : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
          )}
        >
          All
        </button>
        {POST_CATEGORIES.map((c) => {
          const meta = TEMPLATE_META[c];
          const Icon = meta.icon;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={cn(
                'micro flex items-center gap-1 rounded-wobble-sm border-2 px-2.5 py-1 text-[0.6rem] font-bold transition-colors',
                category === c
                  ? 'border-ink bg-yellow text-ink shadow-offset'
                  : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
              )}
            >
              <Icon className="h-3 w-3" strokeWidth={2} />
              {meta.label}
            </button>
          );
        })}
      </div>

      {list.isLoading ? (
        <p className="micro text-[0.62rem] text-ink-faint">Loading the feed…</p>
      ) : feed.length === 0 ? (
        <EmptyState
          image="/empty-repos.svg"
          imageAlt="Empty notebook doodle"
          headline={category ? 'Nothing filed under that yet' : 'Nothing posted yet'}
          explainer={
            user?.role === 'admin'
              ? 'Build a carousel in the marketing tool, then publish it here.'
              : 'Posts made with the marketing tool show up here.'
          }
          ctaLabel={user?.role === 'admin' ? 'Open the marketing tool' : undefined}
          onCta={user?.role === 'admin' ? () => navigate('/admin/projects/marketing') : undefined}
        />
      ) : view === 'grid' ? (
        <div className="grid grid-cols-3 gap-1 sm:gap-2">
          {tiles.map((t) => (
            <Link
              key={t.key}
              to={`/feed/${t.slug}`}
              className="group relative aspect-square overflow-hidden rounded-wobble-sm border-2 border-ink bg-paper-2"
            >
              <img
                src={t.url}
                alt=""
                className="h-full w-full object-cover transition-transform group-hover:scale-105"
              />
            </Link>
          ))}
        </div>
      ) : (
        <div className="flex w-full flex-col items-center gap-8">
          {feed.map((p) => (
            <PostCard key={p.slug} post={p} onRemove={(s) => void remove(s)} />
          ))}
        </div>
      )}
    </div>
  );
}

export { Carousel };
