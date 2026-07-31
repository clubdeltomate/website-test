import { useNavigate, useParams } from 'react-router';
import { ChevronLeft } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { useIsMobile } from '@/hooks/use-mobile';
import PostDetails from '@/components/feed/PostDetails';
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
          <PostDetails post={p} className="w-full" />
        </article>
      ) : (
        <article className="mx-auto flex w-fit max-w-full overflow-hidden rounded-wobble-2 border-2 border-ink bg-paper-3 shadow-offset">
          <div className="flex shrink-0 flex-col items-center justify-center border-r-2 border-ink bg-ink/5">
            <Carousel post={p} height={PANE_H} />
          </div>
          {/* Wide enough to read a caption in, narrow enough that the picture
              stays the thing you look at. */}
          <div className="flex w-[min(42vw,460px)] min-w-[300px] flex-col">
            <PostDetails post={p} className="w-full" />
          </div>
        </article>
      )}
    </div>
  );
}
