import { useState } from 'react';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { TEMPLATE_META } from '@/components/repo/shared';
import PostCard from '@/components/feed/PostCard';
import { POST_CATEGORIES, type PostCategory, type PostScope } from '@contracts/post';
import { say } from '@/lib/i18n';

/**
 * A shelf of posts under the same category filter the notebooks use.
 *
 * One component for the two places that show posts as a list rather than as
 * a feed: somebody's profile, and the gallery. They differ only in which
 * posts they ask for, which is what `ownerId` and `scope` say.
 */
export default function PostShelf({
  scope = 'all',
  ownerId,
  emptyLine,
}: {
  scope?: PostScope;
  ownerId?: number;
  emptyLine: string;
}) {
  const [category, setCategory] = useState<PostCategory | null>(null);
  const list = trpc.posts.list.useQuery({
    scope,
    ownerId,
    category: category ?? undefined,
    limit: 60,
  });
  const posts = list.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setCategory(null)}
          aria-pressed={category === null}
          className={cn(
            'micro rounded-wobble-sm border-2 px-2.5 py-1.5 text-[0.6rem] font-bold transition-colors',
            category === null
              ? 'border-ink bg-yellow text-ink shadow-offset'
              : 'border-dashed border-pencil bg-paper-3/80 text-ink-soft hover:border-ink hover:text-ink',
          )}
        >
          
          {say("All")}
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
      </div>

      {list.isLoading ? (
        <p className="micro text-[0.62rem] text-ink-faint">{say("Loading…")}</p>
      ) : posts.length === 0 ? (
        <div className="rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-3 px-4 py-6 text-center">
          <p className="micro text-[0.62rem] text-ink-faint">
            {category ? 'Nothing filed under that.' : emptyLine}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
          {posts.map((p) => (
            <PostCard key={p.slug} post={p} />
          ))}
        </div>
      )}
    </div>
  );
}
