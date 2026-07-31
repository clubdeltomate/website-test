import { Link, useNavigate, useParams } from 'react-router';
import { ChevronLeft, MessageCircle } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { TEMPLATE_META, VerifiedBadge } from '@/components/repo/shared';
import type { PostCategory } from '@contracts/post';
import { Carousel } from './Feed';

/* One post on its own page. The carousel runs at full width with the caption
 * under it; conversation is meant to live here later, so the space for it is
 * marked out rather than pretended away. */

export default function Post() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
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

  return (
    <div className="mx-auto flex w-full max-w-[620px] flex-col gap-4 px-4 py-8">
      <button
        type="button"
        onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/feed'))}
        className="micro flex w-fit items-center gap-1 text-[0.62rem] font-bold text-blue hover:underline"
      >
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.5} /> Back
      </button>

      <article className="overflow-hidden rounded-wobble-2 border-2 border-ink bg-paper-3 shadow-offset">
        <header className="flex items-center gap-2 px-3 py-2">
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
        <div className="border-y-2 border-ink">
          <Carousel post={p} />
        </div>
        {p.caption && (
          <p className="whitespace-pre-wrap px-4 py-3 text-[0.95rem] leading-relaxed text-ink">
            {p.caption}
          </p>
        )}
        <p className="micro border-t-2 border-dashed border-pencil px-4 py-2 text-[0.55rem] text-ink-faint">
          {new Date(p.createdAt).toLocaleDateString()} · {p.imageUrls.length} slide
          {p.imageUrls.length === 1 ? '' : 's'}
        </p>
      </article>

      {/* Where the conversation will go. Marked out rather than hidden, so the
          page does not need rearranging when it arrives. */}
      <div className="flex items-center gap-2 rounded-wobble-sm border-2 border-dashed border-pencil px-4 py-3 text-ink-faint">
        <MessageCircle className="h-4 w-4" strokeWidth={2} />
        <span className="micro text-[0.6rem]">Comments are coming here.</span>
      </div>
    </div>
  );
}
