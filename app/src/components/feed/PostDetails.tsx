import { Link } from 'react-router';
import { MessageCircle, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TEMPLATE_META, VerifiedBadge } from '@/components/repo/shared';
import type { PostCategory, PostSummary } from '@contracts/post';

/* Everything about a post that is not the picture: who posted it, what they
 * said, when, and the room held for the conversation.
 *
 * One component for two places — the column beside the post in the feed, and
 * the same column on a post's own page — because they are the same panel and
 * were drifting apart as two copies. */

export default function PostDetails({
  post,
  onRemove,
  className,
}: {
  post: PostSummary;
  onRemove?: (slug: string) => void;
  className?: string;
}) {
  const meta = TEMPLATE_META[post.category as PostCategory] ?? TEMPLATE_META.course;
  const Icon = meta.icon;
  return (
    <div className={cn('flex min-h-0 min-w-0 flex-col', className)}>
      <header className="flex items-center gap-2 border-b-2 border-dashed border-pencil px-4 py-3">
        <Link
          to={`/users/${post.ownerId}`}
          className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-ink bg-paper-2 font-heading text-[0.75rem] font-bold text-ink"
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
        {onRemove && (
          <button
            type="button"
            onClick={() => onRemove(post.slug)}
            aria-label={`Delete ${post.slug}`}
            className="shrink-0 text-ink-faint hover:text-red"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {post.caption ? (
          <p className="whitespace-pre-wrap break-words text-[0.95rem] leading-relaxed text-ink">
            <Link to={`/users/${post.ownerId}`} className="font-bold hover:underline">
              {post.ownerName}
            </Link>{' '}
            {post.caption}
          </p>
        ) : (
          <p className="micro text-[0.6rem] text-ink-faint">No caption.</p>
        )}
      </div>

      <p className="micro border-t-2 border-dashed border-pencil px-4 py-2 text-[0.55rem] text-ink-faint">
        {new Date(post.createdAt).toLocaleDateString()} · {post.imageUrls.length} slide
        {post.imageUrls.length === 1 ? '' : 's'}
      </p>
      {/* Where the conversation will go. Marked out rather than hidden, so the
          panel does not need rearranging when it arrives. */}
      <div className="flex items-center gap-2 border-t-2 border-dashed border-pencil px-4 py-3 text-ink-faint">
        <MessageCircle className="h-4 w-4" strokeWidth={2} />
        <span className="micro text-[0.6rem]">Comments are coming here.</span>
      </div>
    </div>
  );
}
