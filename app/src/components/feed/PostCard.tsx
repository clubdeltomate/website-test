import { Link } from 'react-router';
import { Heart, Layers, Lock, Users, Volume2 } from 'lucide-react';
import { TEMPLATE_META } from '@/components/repo/shared';
import PostAudience from '@/components/feed/PostAudience';
import type { PostCategory, PostSummary } from '@contracts/post';
import { say } from '@/lib/i18n';

/**
 * One post as a card: the first slide, what it says, who posted it.
 *
 * The index view of a post, as opposed to the reading view — used by the
 * feed's grid, by a profile, and by the gallery, which are three places
 * asking the same question ("what has been posted?") and should not answer
 * it three different ways.
 */
export default function PostCard({ post }: { post: PostSummary }) {
  const meta = TEMPLATE_META[post.category as PostCategory] ?? TEMPLATE_META.course;
  const Icon = meta.icon;
  return (
    /* No overflow-hidden and no hover transform on the card: the first would
       clip the audience panel and the second would trap it in a stacking
       context of its own. The picture keeps its own clip, and focus-within
       raises the card so the panel opens over its neighbours. */
    <div className="group relative flex flex-col rounded-wobble-sm border-2 border-ink bg-paper-3 shadow-offset transition-colors focus-within:z-40 hover:bg-paper-2">
      <Link
        to={`/feed/${post.slug}`}
        aria-label={`Open ${post.slug}`}
        className="relative aspect-square overflow-hidden rounded-t-wobble-sm bg-paper-2"
      >
        <img
          src={post.imageUrls[0]}
          alt=""
          className="h-full w-full object-cover"
        />
        {post.imageUrls.length > 1 && (
          <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full border-2 border-ink bg-paper-3/90 px-1.5 font-mono text-[0.6rem] text-ink">
            <Layers className="h-3 w-3" strokeWidth={2} />
            {post.imageUrls.length}
          </span>
        )}
        <span className="absolute left-1.5 top-1.5 flex gap-1">
          {post.audioUrl && (
            <span
              title={say("Has music")}
              className="rounded-full border-2 border-ink bg-paper-3/90 p-1 text-ink"
            >
              <Volume2 className="h-3 w-3" strokeWidth={2} />
            </span>
          )}
          {post.saved && (
            <span
              title={say("Saved")}
              className="rounded-full border-2 border-ink bg-paper-3/90 p-1 text-red"
            >
              <Heart className="h-3 w-3" strokeWidth={2} fill="currentColor" />
            </span>
          )}
          {post.who === 'private' && (
            <span
              title={say("Off the feed")}
              className="rounded-full border-2 border-ink bg-yellow-soft p-1 text-ink"
            >
              <Lock className="h-3 w-3" strokeWidth={2} />
            </span>
          )}
          {post.assignedCount > 0 && (
            <span
              title={`Sent to ${post.assignedCount}`}
              className="flex items-center gap-0.5 rounded-full border-2 border-ink bg-yellow-soft px-1 py-1 font-mono text-[0.55rem] text-ink"
            >
              <Users className="h-3 w-3" strokeWidth={2} />
              {post.assignedCount}
            </span>
          )}
        </span>
      </Link>
      <div className="flex min-w-0 flex-col gap-1 border-t-2 border-ink px-2 py-1.5">
        <Link to={`/feed/${post.slug}`} className="min-w-0">
          <p className="line-clamp-2 break-words text-[0.72rem] leading-snug text-ink">
            {post.caption || <span className="text-ink-faint">{say("No caption.")}</span>}
          </p>
        </Link>
        <div className="flex items-center gap-1">
          <span className="micro flex min-w-0 flex-1 items-center gap-1 truncate text-[0.52rem] text-ink-faint">
            <Icon className="h-2.5 w-2.5 shrink-0" strokeWidth={2} />
            {meta.label} · {post.ownerName}
          </span>
          {/* Changing who a post is for, where the post is — you should not
              have to open it, let alone go back to the tool that made it. */}
          <PostAudience post={post} compact />
        </div>
      </div>
    </div>
  );
}
