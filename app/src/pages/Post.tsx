import { Link, useNavigate, useParams } from 'react-router';
import { ChevronLeft, MessageCircle } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { useIsMobile } from '@/hooks/use-mobile';
import { TEMPLATE_META, VerifiedBadge } from '@/components/repo/shared';
import type { PostCategory } from '@contracts/post';
import { Carousel, POST_W } from './Feed';

/* One post on its own page, laid out the way Instagram lays one out when you
 * open it.
 *
 * On a desktop or a tablet that is two panes: the picture on the left, as tall
 * as the window allows and as wide as its own shape makes it, and everything
 * you read — who posted it, the caption, the date, and eventually the
 * conversation — in a column beside it. A screen that wide has the room, and a
 * caption sitting under a 900px-tall picture is a caption nobody reaches.
 *
 * On a phone there is no second column to put anything in, so it stacks, which
 * is what Instagram does there too.
 */

/** The picture's height in the two-pane layout: the window, less the app bar
 *  and this page's own padding. */
const PANE_H = 'min(calc(100dvh - 150px), 900px)';

export default function Post() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const post = trpc.posts.bySlug.useQuery({ slug }, { retry: false });

  if (post.isLoading) {
    return (
      <div className="mx-auto max-w-content px-4 py-8 lg:px-8">
        <p className="micro text-[0.62rem] text-ink-faint">Loading…</p>
      </div>
    );
  }
  if (post.error || !post.data) {
    return (
      <div className="mx-auto max-w-content px-4 py-8 lg:px-8">
        <h1 className="font-display text-2xl text-ink">That post isn&apos;t here</h1>
        <button
          type="button"
          onClick={() => navigate('/feed')}
          className="squiggle mt-3 text-sm font-bold text-blue"
        >
          Back to the feed
        </button>
      </div>
    );
  }

  const p = post.data;
  const meta = TEMPLATE_META[p.category as PostCategory] ?? TEMPLATE_META.course;
  const Icon = meta.icon;

  const who = (
    <header className="flex items-center gap-2 border-b-2 border-dashed border-pencil px-4 py-3">
      <Link
        to={`/users/${p.ownerId}`}
        className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-ink bg-paper-2 font-heading text-[0.75rem] font-bold text-ink"
      >
        {p.ownerAvatarUrl ? (
          <img src={p.ownerAvatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          p.ownerName.slice(0, 1).toUpperCase()
        )}
      </Link>
      <Link to={`/users/${p.ownerId}`} className="text-sm font-bold text-ink hover:underline">
        {p.ownerName}
      </Link>
      {p.ownerVerified && <VerifiedBadge />}
      <span className="micro ml-auto flex items-center gap-1 rounded-wobble-sm border-2 border-dashed border-pencil px-1.5 py-0.5 text-[0.55rem] font-bold text-ink-soft">
        <Icon className="h-3 w-3" strokeWidth={2} />
        {meta.label}
      </span>
    </header>
  );

  /** Everything that is not the picture. Beside it on a desktop, under it on
   *  a phone — the same blocks either way. */
  const details = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {who}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {p.caption ? (
          <p className="whitespace-pre-wrap break-words text-[0.95rem] leading-relaxed text-ink">
            <Link to={`/users/${p.ownerId}`} className="font-bold hover:underline">
              {p.ownerName}
            </Link>{' '}
            {p.caption}
          </p>
        ) : (
          <p className="micro text-[0.6rem] text-ink-faint">No caption.</p>
        )}
      </div>
      <p className="micro border-t-2 border-dashed border-pencil px-4 py-2 text-[0.55rem] text-ink-faint">
        {new Date(p.createdAt).toLocaleDateString()} · {p.imageUrls.length} slide
        {p.imageUrls.length === 1 ? '' : 's'}
      </p>
      {/* Where the conversation will go. Marked out rather than hidden, so the
          page does not need rearranging when it arrives. */}
      <div className="flex items-center gap-2 border-t-2 border-dashed border-pencil px-4 py-3 text-ink-faint">
        <MessageCircle className="h-4 w-4" strokeWidth={2} />
        <span className="micro text-[0.6rem]">Comments are coming here.</span>
      </div>
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-3 px-4 py-5 lg:px-8">
      <button
        type="button"
        onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/feed'))}
        className="micro flex items-center gap-1 self-start text-[0.62rem] font-bold text-blue hover:underline"
      >
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.5} /> Back
      </button>

      {isMobile ? (
        <article
          className="mx-auto flex w-full flex-col overflow-hidden rounded-wobble-2 border-2 border-ink bg-paper-3 shadow-offset"
          style={{ width: POST_W }}
        >
          <div className="border-b-2 border-ink">
            <Carousel post={p} />
          </div>
          {details}
        </article>
      ) : (
        <article className="mx-auto flex w-fit max-w-full overflow-hidden rounded-wobble-2 border-2 border-ink bg-paper-3 shadow-offset">
          <div className="flex shrink-0 flex-col items-center justify-center border-r-2 border-ink bg-ink/5">
            <Carousel post={p} height={PANE_H} />
          </div>
          {/* Wide enough to read a caption in, narrow enough that the picture
              stays the thing you look at. */}
          <div className="flex w-[min(42vw,460px)] min-w-[300px] flex-col">{details}</div>
        </article>
      )}
    </div>
  );
}
