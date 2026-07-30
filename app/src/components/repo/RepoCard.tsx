import { memo } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { ChevronRight, Star, Trash2, UserRoundPlus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import Chip from '@/components/sketch/Chip';
import { trpc } from '@/providers/trpc';
import type { RepoSummary } from '@contracts/types';
import { CardBanner, OwnerAvatar, ProgressStrip, SourceBadge, VerifiedBadge, relTime } from './shared';

export interface RepoCardProps {
  repo: RepoSummary;
  index: number;
  onToggleFavorite: (repo: RepoSummary) => void;
  /** admin or the repo's owner — shows a trash icon to delete from the gallery */
  canDelete?: boolean;
  onDelete?: (repo: RepoSummary) => void;
  /** owner/moderator/admin — shows the Assign button that opens the popup */
  onAssign?: (repo: RepoSummary) => void;
}

/**
 * Repo card (design.md §7.3 + repos.md §2): wobble rotation per index, category
 * doodle in a yellow-soft circle, repo-ref chip, favorite doodle-star, progress
 * strip. Hover lifts the card and prefetches the detail payload.
 */
function RepoCardInner({ repo, index, onToggleFavorite, canDelete, onDelete, onAssign }: RepoCardProps) {
  const utils = trpc.useUtils();
  // progress strip shows the viewer's OWN completed UNITS, not global runs
  const played = Math.min(repo.myCompletedUnits, repo.unitCount);
  const banner = trpc.repos.generateBanner.useMutation({
    onSuccess: (r) => {
      toast.success(`Banner drawn — ${r.cost} 🪙`);
      void utils.repos.list.invalidate();
      void utils.auth.me.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: (index % 12) * 0.05 }}
    >
      <Link
        to={`/repos/${repo.slug}`}
        onMouseEnter={() => void utils.repos.getBySlug.prefetch({ slug: repo.slug })}
        onFocus={() => void utils.repos.getBySlug.prefetch({ slug: repo.slug })}
        className={cn(
          'group relative block bg-paper-3 p-5 no-underline shadow-offset',
          'border-2 border-solid border-ink transition-all duration-150',
          'hover:-translate-y-[3px] hover:-rotate-[0.4deg] hover:shadow-offset-hover',
          index % 4 === 0 && 'rounded-wobble-1',
          index % 4 === 1 && 'rounded-wobble-2',
          index % 4 === 2 && 'rounded-wobble-3',
          index % 4 === 3 && 'rounded-wobble-4',
        )}
      >
        {/* top row: category doodle + owner + favorite star — the author's
            name leads the card, same as on slide tool cards */}
        <div className="flex items-start justify-between">
          <span className="flex min-w-0 items-center gap-2">
            <OwnerAvatar
              ownerId={repo.ownerId}
              ownerName={repo.ownerName}
              avatarUrl={repo.ownerAvatarUrl}
              template={repo.template}
            />
            {repo.ownerName && (
              <span className="micro flex min-w-0 items-center gap-1 truncate text-ink-faint">
                by {repo.ownerName}
                {repo.ownerVerified && <VerifiedBadge />}
              </span>
            )}
          </span>
          <span className="flex items-center gap-0.5">
            <button
              type="button"
              aria-label={repo.favorite ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={repo.favorite}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleFavorite(repo);
              }}
              className="rounded-full p-1.5 text-ink transition-transform duration-200 hover:scale-125 hover:rotate-6"
            >
              <Star
                className={cn(
                  'h-5 w-5 transition-colors',
                  repo.favorite ? 'fill-yellow text-ink' : 'text-ink-faint',
                )}
                strokeWidth={2}
              />
            </button>
            {canDelete && (
              <button
                type="button"
                aria-label="Delete repository"
                title="Delete this repository"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDelete?.(repo);
                }}
                className="rounded-wobble-sm p-1.5 text-ink-faint transition-colors hover:bg-red-soft hover:text-red"
              >
                <Trash2 className="h-4 w-4" strokeWidth={2} />
              </button>
            )}
          </span>
        </div>

        {/* thin AI banner strip between the top row and the title */}
        <CardBanner
          url={repo.bannerUrl}
          canEdit={!!canDelete}
          busy={banner.isPending}
          onDraw={() => banner.mutate({ slug: repo.slug })}
          className="mt-3"
        />

        {/* title + slug */}
        <h3 className="mt-3 line-clamp-2 font-heading text-lg font-semibold leading-snug text-ink">
          {repo.title}
        </h3>
        <p className="mt-0.5 truncate font-mono text-xs text-ink-faint">{repo.slug}</p>

        {/* ref chip */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Chip kind="repo-ref">#{repo.ref}</Chip>
          <Chip kind="neutral" className="normal-case">
            {repo.template}
          </Chip>
          <SourceBadge source={repo.source} />
          {repo.assigned && (
            <Chip kind="neutral" className="border-blue bg-blue-soft" title="A moderator put this on your shelf">
              assigned
            </Chip>
          )}
          {onAssign && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onAssign(repo);
              }}
              aria-label="Assign to a user"
              title="Assign — put this notebook on another user's shelf"
              className="ml-auto rounded-wobble-sm border-2 border-dashed border-pencil p-1 text-ink-faint transition-colors hover:border-ink hover:text-ink"
            >
              <UserRoundPlus className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          )}
        </div>

        {/* meta row */}
        <p className="micro mt-3 text-[0.65rem] text-ink-soft">
          {repo.unitCount} units · {repo.lessonCount} lessons · {repo.runCount} runs
        </p>

        {/* progress strip */}
        <ProgressStrip
          played={played}
          total={repo.unitCount}
          noun="units"
          label="units done"
          className="mt-2"
        />

        {/* footer */}
        <div className="mt-3 flex items-center justify-between border-t-2 border-dashed border-pencil pt-2.5">
          <span className="flex items-center gap-1 text-xs text-ink-faint">
            sketched {relTime(repo.createdAt)}
            {repo.ownerName ? ` · by ${repo.ownerName}` : ''}
            {repo.ownerName && repo.ownerVerified && <VerifiedBadge />}
          </span>
          <ChevronRight className="h-4 w-4 text-ink-faint transition-transform duration-150 group-hover:translate-x-1 group-hover:text-ink" />
        </div>
      </Link>
    </motion.div>
  );
}

const RepoCard = memo(RepoCardInner);
export default RepoCard;
