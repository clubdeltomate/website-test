import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Grid3x3,
  Heart,
  Layers,
  Plus,
  Rows3,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { setSoundOn, useSoundOn } from '@/lib/sound';
import { POST_CATEGORIES, type PostCategory, type PostSummary } from '@contracts/post';
import { TEMPLATE_META } from '@/components/repo/shared';
import PostDetails from '@/components/feed/PostDetails';
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
 * The width of a post when it is being read at its natural size — the phone
 * layout of the single-post page, and the fallback anywhere a fixed column is
 * wanted. Instagram's own feed column is about this wide.
 */
export const POST_W = 'min(100%, 520px)';

/**
 * How tall a post stands in the feed.
 *
 * Nearly the whole window, because on a wide screen the feed is the window:
 * the shell drops its top bar and footer here, the filters float over the
 * page instead of taking a row of it, and the caption moved into the panel on
 * the right. What is left to subtract is a margin and the swipe dots.
 *
 * A 9:16 post in a scrolling column was either a sliver narrow enough to fit
 * the height or something you met in pieces. Filling the height and stepping
 * between posts — TikTok's answer — is the one that suits this content.
 *
 * What is subtracted: the slim bar of filters at the top, and a margin.
 */
const FEED_PANE_H = 'calc(100dvh - 104px)';

/**
 * A ceiling, only so a pathological upload cannot produce a mile of page. Set
 * far above any real post — a 9:16 at full column width is about 920px — so
 * in practice nothing is ever cropped by it.
 */
const MEDIA_MAX_H = '1400px';

/** Swipe through one post's slides in place. */
/**
 * Swipe through one post's slides.
 *
 * Two ways to be sized. In the feed the picture fills the column's width and
 * the height follows — the normal way a post is read. Given a `height`, it
 * fills that instead and the width follows, which is what the desktop
 * lightbox wants: the picture as tall as the window allows, with the caption
 * beside it rather than under it.
 */
export function Carousel({ post, height }: { post: PostSummary; height?: string }) {
  const [at, setAt] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const many = post.imageUrls.length > 1;
  const ratio = `${post.width} / ${post.height}`;

  /* Sound starts off — no browser lets a page make noise unasked, and no
     reader wants it to — but once it is on it stays on. The switch is the
     whole feed's, not this post's: stepping to the next one keeps playing,
     and only the post on screen has an <audio> to play. */
  const soundOn = useSoundOn();
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    if (!soundOn) {
      el.pause();
      return;
    }
    // A browser may still refuse; if it does, the switch goes back off
    // rather than lying about it.
    void el.play().catch(() => setSoundOn(false));
  }, [soundOn, post.audioUrl]);

  return (
    // A column of its own, so the dots sit under the picture whichever
    // direction the parent happens to lay its children out in.
    <div className="flex min-w-0 flex-col items-center">
    <div
      className={cn(
        'relative flex justify-center overflow-hidden bg-ink/5',
        height ? 'w-auto' : 'w-full',
      )}
      style={height ? { height } : { aspectRatio: ratio, maxHeight: MEDIA_MAX_H }}
    >
      <img
        src={post.imageUrls[at]}
        alt={`Slide ${at + 1} of ${post.imageUrls.length}`}
        className={cn('object-cover', height ? 'block h-full w-auto max-w-full' : 'h-full w-full')}
        style={height ? { aspectRatio: ratio } : undefined}
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
          <span className="absolute right-2 top-2 rounded-full border-2 border-ink bg-paper-3/90 px-2 font-mono text-[0.6rem] text-ink">
            {at + 1}/{post.imageUrls.length}
          </span>
        </>
      )}
      {post.audioUrl && (
        <>
          <audio ref={audio} src={post.audioUrl} loop preload="none" />
          {/* Top left: the bottom of a 9:16 post is the caption band, and a
              button sitting on the words is a button in the way. */}
          <button
            type="button"
            onClick={() => setSoundOn(!soundOn)}
            aria-label={soundOn ? 'Mute the music' : 'Play the music'}
            title={soundOn ? 'Mute' : 'Play the music'}
            aria-pressed={soundOn}
            className="absolute left-2 top-2 rounded-full border-2 border-ink bg-paper-3/90 p-1.5 text-ink shadow-offset"
          >
            {soundOn ? (
              <Volume2 className="h-4 w-4" strokeWidth={2.5} />
            ) : (
              <VolumeX className="h-4 w-4" strokeWidth={2.5} />
            )}
          </button>
        </>
      )}
    </div>
    <Dots count={post.imageUrls.length} at={at} />
    </div>
  );
}

/** The swipe dots, under the picture rather than over it — on a 9:16 post the
 *  bottom of the frame is the caption band, and dots do not belong on it. */
function Dots({ count, at }: { count: number; at: number }) {
  if (count < 2) return null;
  return (
    <div className="flex justify-center gap-1.5 py-2">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-1.5 w-1.5 rounded-full border border-ink transition-colors',
            i === at ? 'bg-ink' : 'bg-transparent',
          )}
        />
      ))}
    </div>
  );
}

export default function Feed() {
  const [view, setView] = useState<View>('feed');
  const [category, setCategory] = useState<PostCategory | null>(null);
  const [savedOnly, setSavedOnly] = useState(false);
  const [atPost, setAtPost] = useState(0);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const utils = trpc.useUtils();
  const list = trpc.posts.list.useQuery({
    category: category ?? undefined,
    saved: savedOnly,
    limit: 30,
  });

  const remove = async (slug: string) => {
    try {
      await utils.client.posts.remove.mutate({ slug });
      await list.refetch();
      toast.success('Post removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That post couldn't be removed");
    }
  };

  const feed = useMemo(() => list.data ?? [], [list.data]);

  /* Arriving from the marketing tool: ?post=<slug> opens the feed standing on
     the post that was just published, rather than on a page of its own. Read
     rather than copied into state — the address is the answer until you move,
     and the first step clears it. */
  const wanted = params.get('post');
  const wantedAt = useMemo(
    () => (wanted ? feed.findIndex((p) => p.slug === wanted) : -1),
    [wanted, feed],
  );
  /* Clamped rather than reset, so a post disappearing — deleted, or filtered
     out — leaves you next to where you were instead of back at the top. */
  const shown = wantedAt >= 0 ? wantedAt : Math.min(atPost, Math.max(0, feed.length - 1));

  const goTo = useCallback(
    (i: number) => {
      setAtPost(Math.max(0, i));
      if (!wanted) return;
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          next.delete('post');
          return next;
        },
        { replace: true },
      );
    },
    [wanted, setParams],
  );

  /* Arrow keys step posts too. Skipped while something is focused that wants
     the arrows for itself, so typing in a field never jumps the feed. */
  useEffect(() => {
    if (view !== 'feed') return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowDown') goTo(shown + 1);
      else if (e.key === 'ArrowUp') goTo(shown - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, shown, goTo]);

  /**
   * The wheel steps posts instead of scrolling the page.
   *
   * There is nothing to scroll — one post fills the window — so a flick of
   * the wheel means "the next one", the way it does on TikTok. Rate-limited,
   * because a trackpad sends a burst of events for one flick and stepping
   * once per event would fly past four posts. Anything with its own
   * scrollbar (the caption column) keeps the wheel for itself.
   */
  const pane = useRef<HTMLDivElement | null>(null);
  const lastStep = useRef(0);
  useEffect(() => {
    const el = pane.current;
    if (!el || view !== 'feed') return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement | null)?.closest('[data-own-scroll]')) return;
      if (Math.abs(e.deltaY) < 8) return;
      e.preventDefault();
      const now = performance.now();
      if (now - lastStep.current < 420) return;
      lastStep.current = now;
      goTo(shown + (e.deltaY > 0 ? 1 : -1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [view, shown, goTo]);

  const empty = (
    <EmptyState
      image="/empty-repos.svg"
      imageAlt="Empty notebook doodle"
      headline={
        savedOnly
          ? 'Nothing saved yet'
          : category
            ? 'Nothing filed under that yet'
            : 'Nothing posted yet'
      }
      explainer={
        savedOnly
          ? 'Tap the heart on a post and it waits for you here.'
          : user?.role === 'admin'
          ? 'Build a carousel in the marketing tool, then publish it here.'
          : 'Posts made with the marketing tool show up here.'
      }
      ctaLabel={!savedOnly && user?.role === 'admin' ? 'Open the marketing tool' : undefined}
      onCta={
        !savedOnly && user?.role === 'admin'
          ? () => navigate('/admin/projects/marketing')
          : undefined
      }
    />
  );

  /* One slim bar instead of the old heading, count, toggle and filter rows —
     everything that used to stack above the post now fits in its height. */
  const controls = (
    <div className="flex flex-wrap items-center gap-1.5">
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
      <button
        type="button"
        onClick={() => {
          setCategory(null);
          goTo(0);
        }}
        aria-pressed={category === null}
        className={cn(
          'micro rounded-wobble-sm border-2 px-2.5 py-1.5 text-[0.6rem] font-bold transition-colors',
          category === null
            ? 'border-ink bg-yellow text-ink shadow-offset'
            : 'border-dashed border-pencil bg-paper-3/80 text-ink-soft hover:border-ink hover:text-ink',
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
            onClick={() => {
              setCategory(c);
              goTo(0);
            }}
            aria-pressed={category === c}
            title={meta.label}
            className={cn(
              'micro flex items-center gap-1 rounded-wobble-sm border-2 px-2.5 py-1.5 text-[0.6rem] font-bold transition-colors',
              category === c
                ? 'border-ink bg-yellow text-ink shadow-offset'
                : 'border-dashed border-pencil bg-paper-3/80 text-ink-soft hover:border-ink hover:text-ink',
            )}
          >
            <Icon className="h-3 w-3" strokeWidth={2} />
            {meta.label}
          </button>
        );
      })}
      {/* Sits with the category chips because it is the same kind of thing —
          a narrowing of the same feed — and it combines with them: saved
          restaurant posts is a sentence you can say here. */}
      {user && (
        <button
          type="button"
          onClick={() => {
            setSavedOnly((s) => !s);
            goTo(0);
          }}
          aria-pressed={savedOnly}
          title="Only the posts you saved"
          className={cn(
            'micro flex items-center gap-1 rounded-wobble-sm border-2 px-2.5 py-1.5 text-[0.6rem] font-bold transition-colors',
            savedOnly
              ? 'border-ink bg-red-soft text-ink shadow-offset'
              : 'border-dashed border-pencil bg-paper-3/80 text-ink-soft hover:border-ink hover:text-ink',
          )}
        >
          <Heart className="h-3 w-3" strokeWidth={2} fill={savedOnly ? 'currentColor' : 'none'} />
          Saved
        </button>
      )}
      {user?.role === 'admin' && (
        <SketchButton variant="accent" onClick={() => navigate('/admin/projects/marketing')}>
          <Plus className="h-4 w-4" strokeWidth={2.5} /> New post
        </SketchButton>
      )}
    </div>
  );

  if (view === 'grid') {
    return (
      /* Its own scrollbar: the shell gives this page the window's height for
         the feed's sake, so the grid has to scroll inside that rather than
         run off the bottom of it. */
      <div
        data-lenis-prevent
        className="mx-auto flex w-full max-w-content flex-col gap-3 px-4 py-3 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:px-8"
      >
        {controls}
        {list.isLoading ? (
          <p className="micro text-[0.62rem] text-ink-faint">Loading the feed…</p>
        ) : feed.length === 0 ? (
          empty
        ) : (
          /* One card per post, not one per picture. The grid is the index —
             what has been posted, three across — and a card opens that post
             on a page of its own. The feed beside it is for reading them one
             after another; this is for finding one. */
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
            {feed.map((p) => {
              const meta = TEMPLATE_META[p.category as PostCategory] ?? TEMPLATE_META.course;
              const Icon = meta.icon;
              return (
                <Link
                  key={p.slug}
                  to={`/feed/${p.slug}`}
                  aria-label={`Open ${p.slug}`}
                  className="group flex flex-col overflow-hidden rounded-wobble-sm border-2 border-ink bg-paper-3 shadow-offset transition-transform hover:-translate-y-0.5"
                >
                  <div className="relative aspect-square overflow-hidden bg-paper-2">
                    <img
                      src={p.imageUrls[0]}
                      alt=""
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                    {p.imageUrls.length > 1 && (
                      <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full border-2 border-ink bg-paper-3/90 px-1.5 font-mono text-[0.6rem] text-ink">
                        <Layers className="h-3 w-3" strokeWidth={2} />
                        {p.imageUrls.length}
                      </span>
                    )}
                    <span className="absolute left-1.5 top-1.5 flex gap-1">
                      {p.audioUrl && (
                        <span
                          title="Has music"
                          className="rounded-full border-2 border-ink bg-paper-3/90 p-1 text-ink"
                        >
                          <Volume2 className="h-3 w-3" strokeWidth={2} />
                        </span>
                      )}
                      {p.saved && (
                        <span
                          title="Saved"
                          className="rounded-full border-2 border-ink bg-paper-3/90 p-1 text-red"
                        >
                          <Heart className="h-3 w-3" strokeWidth={2} fill="currentColor" />
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1 border-t-2 border-ink px-2 py-1.5">
                    <p className="line-clamp-2 break-words text-[0.72rem] leading-snug text-ink">
                      {p.caption || <span className="text-ink-faint">No caption.</span>}
                    </p>
                    <span className="micro flex items-center gap-1 text-[0.52rem] text-ink-faint">
                      <Icon className="h-2.5 w-2.5" strokeWidth={2} />
                      {meta.label} · {p.ownerName}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    /* One post, the height of the window, with what you read beside it — the
       shape TikTok uses, and the one that suits a 9:16 carousel. */
    <div ref={pane} className="flex h-full w-full flex-col px-4 py-3 lg:px-6">
      {controls}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:items-center lg:justify-center lg:gap-4">
      {list.isLoading ? (
        <p className="micro m-auto text-[0.62rem] text-ink-faint">Loading the feed…</p>
      ) : feed.length === 0 ? (
        <div className="m-auto">{empty}</div>
      ) : (
        <>
          <div className="flex min-w-0 shrink-0 justify-center lg:h-full lg:items-center">
            {/* Keyed by slug so stepping to another post mounts a fresh
                carousel, rather than opening it on whatever slide the last one
                was left showing.

                Not a link. Everything a post has to offer is already on this
                page — the slides swipe here, the caption is in the column
                beside it, and the steppers move through the feed — so clicking
                the picture leads nowhere, and the chevrons on it do what they
                say instead of navigating away mid-carousel. */}
            <div
              key={feed[shown].slug}
              className="flex overflow-hidden rounded-wobble-2 border-2 border-ink bg-paper-3 shadow-offset"
            >
              <Carousel post={feed[shown]} height={isMobile ? undefined : FEED_PANE_H} />
            </div>
          </div>

          {/* Stepping between posts: the post stays put and the next one takes
              its place, rather than the page moving under you. */}
          <div className="flex shrink-0 items-center justify-center gap-2 py-3 lg:flex-col lg:py-0">
            <button
              type="button"
              disabled={shown === 0}
              onClick={() => goTo(shown - 1)}
              aria-label="Previous post"
              className="rounded-full border-2 border-ink bg-paper-3 p-2 text-ink shadow-offset transition-transform hover:-translate-y-0.5 disabled:opacity-30 disabled:hover:translate-y-0"
            >
              <ChevronUp className="h-4 w-4" strokeWidth={2.5} />
            </button>
            <span
              aria-label={`Post ${shown + 1} of ${feed.length}`}
              aria-live="polite"
              className="micro text-center text-[0.55rem] tabular-nums text-ink-faint"
            >
              {shown + 1}/{feed.length}
            </span>
            <button
              type="button"
              disabled={shown >= feed.length - 1}
              onClick={() => goTo(shown + 1)}
              aria-label="Next post"
              className="rounded-full border-2 border-ink bg-paper-3 p-2 text-ink shadow-offset transition-transform hover:-translate-y-0.5 disabled:opacity-30 disabled:hover:translate-y-0"
            >
              <ChevronDown className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>

          {/* What you read, in a column of its own, the way TikTok puts the
              comments beside the video instead of under it. */}
          <div
            className="flex w-full min-w-0 shrink-0 overflow-hidden rounded-wobble-2 border-2 border-ink bg-paper-3 shadow-offset lg:w-[min(32vw,400px)]"
            style={{ height: isMobile ? undefined : FEED_PANE_H }}
          >
            <PostDetails
              key={feed[shown].slug}
              post={feed[shown]}
              onRemove={
                feed[shown].mine || user?.role === 'admin' ? (x) => void remove(x) : undefined
              }
              className="w-full"
            />
          </div>
        </>
      )}
      </div>
    </div>
  );
}
