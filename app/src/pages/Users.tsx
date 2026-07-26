import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { LibraryBig, Search, Star } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import Chip from '@/components/sketch/Chip';
import type { DirectoryUser, RepoTemplate } from '@contracts/types';

function useDebounced<T>(value: T, ms: number): T {
  const [d, setD] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setD(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return d;
}

/**
 * Public creator directory. Anyone can browse people who've published repos,
 * favorite them, and open their profile to see the lessons they've created.
 */
export default function Users() {
  const { isGuest } = useAuth();
  const [q, setQ] = useState('');
  const debouncedQ = useDebounced(q, 250);
  const [favsOnly, setFavsOnly] = useState(false);
  const [creatorsOnly, setCreatorsOnly] = useState(false);
  const [category, setCategory] = useState<RepoTemplate | 'all'>('all');
  const utils = trpc.useUtils();

  const list = trpc.users.directory.useQuery({ q: debouncedQ || undefined });

  const toggleFav = trpc.users.toggleFavorite.useMutation({
    onMutate: async ({ userId }) => {
      await utils.users.directory.cancel();
      const prev = utils.users.directory.getData({ q: debouncedQ || undefined });
      utils.users.directory.setData({ q: debouncedQ || undefined }, (old) =>
        old?.map((u) => (u.id === userId ? { ...u, favorite: !u.favorite } : u)),
      );
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) utils.users.directory.setData({ q: debouncedQ || undefined }, ctx.prev);
      toast.error(e.message);
    },
    onSettled: () => void utils.users.directory.invalidate(),
  });

  const rows = useMemo(() => {
    let all = list.data ?? [];
    if (favsOnly) all = all.filter((u) => u.favorite);
    if (creatorsOnly) all = all.filter((u) => u.repoCount > 0);
    if (category !== 'all') all = all.filter((u) => u.templates.includes(category));
    return all;
  }, [list.data, favsOnly, creatorsOnly, category]);

  const onFav = (u: DirectoryUser) => {
    if (isGuest) {
      toast.error('Sign in to favorite creators');
      return;
    }
    toggleFav.mutate({ userId: u.id });
  };

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-6 px-4 py-8 lg:px-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-4xl font-bold text-ink">Users</h2>
        <Chip kind="neutral">{rows.length}</Chip>
      </div>
      <p className="-mt-3 max-w-2xl text-ink-soft">
        Browse everyone on SketchLearn. Open a profile to see what they've published, request
        tickets or coins, and star the ones you want to follow.
      </p>

      {/* toolbar */}
      <div className="flex flex-col gap-3 rounded-wobble-2 border-2 border-ink bg-paper-3 p-3 shadow-offset">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" strokeWidth={2} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name…"
              aria-label="Search users"
              className="w-full rounded-wobble-sm border-2 border-ink bg-paper py-2 pl-9 pr-3 text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue"
            />
          </div>
          <button
            type="button"
            onClick={() => setCreatorsOnly((c) => !c)}
            className={cn(
              'flex items-center gap-1.5 rounded-wobble-sm border-2 px-3 py-2 text-sm font-bold transition-colors',
              creatorsOnly
                ? 'border-ink bg-yellow text-ink shadow-offset'
                : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
            )}
          >
            <LibraryBig className="h-4 w-4" strokeWidth={2} /> Has repos
          </button>
          <button
            type="button"
            onClick={() => setFavsOnly((f) => !f)}
            className={cn(
              'flex items-center gap-1.5 rounded-wobble-sm border-2 px-3 py-2 text-sm font-bold transition-colors',
              favsOnly
                ? 'border-ink bg-yellow text-ink shadow-offset'
                : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
            )}
          >
            <Star className={cn('h-4 w-4', favsOnly && 'fill-ink')} strokeWidth={2} /> Favorites
          </button>
        </div>
        {/* topic (category) chips */}
        <div className="flex flex-wrap gap-2 border-t-2 border-dashed border-pencil pt-2.5">
          {(['all', 'course', 'restaurant', 'service', 'shop', 'walkthrough', 'news'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setCategory(t)}
              className={cn(
                'rounded-wobble-sm border-2 px-3 py-1 text-xs font-bold uppercase tracking-wider transition-colors',
                category === t
                  ? 'border-ink bg-yellow text-ink shadow-offset'
                  : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* grid */}
      {list.isLoading ? (
        <div className="rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-2/50 p-10 text-center text-ink-faint">
          Gathering the class photo…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-2/50 p-10 text-center text-ink-faint">
          {favsOnly ? 'No favorited users yet — tap a star to add one ⭐' : 'No users match these filters.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((u, i) => (
            <motion.div
              key={u.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: (i % 12) * 0.03 }}
              className="relative rounded-wobble-2 border-2 border-ink bg-paper-3 p-4 shadow-offset"
            >
              <button
                type="button"
                onClick={() => onFav(u)}
                aria-label={u.favorite ? 'Unfavorite' : 'Favorite'}
                title={u.favorite ? 'Unfavorite' : 'Favorite'}
                className="absolute right-3 top-3 text-ink-faint transition-colors hover:text-yellow"
              >
                <Star className={cn('h-5 w-5', u.favorite && 'fill-yellow text-yellow')} strokeWidth={2} />
              </button>
              <Link to={`/users/${u.id}`} className="flex items-center gap-3 no-underline">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-blue-soft font-display text-2xl text-ink shadow-offset">
                  {u.name.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-heading text-lg font-bold text-ink">{u.name}</span>
                  <span className="mt-1 flex items-center gap-2">
                    <Chip kind={u.role}>{u.role}</Chip>
                    <span className="micro flex items-center gap-1 text-[0.62rem] text-ink-faint">
                      <LibraryBig className="h-3 w-3" /> {u.repoCount} repo{u.repoCount === 1 ? '' : 's'}
                    </span>
                  </span>
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
