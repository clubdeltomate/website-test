import { useState } from 'react';
import { Link } from 'react-router';
import { Download, Lock, MessageCircle, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { type ZipEntry, makeZip } from '@/lib/zip';
import { TEMPLATE_META, VerifiedBadge } from '@/components/repo/shared';
import type { PostCategory, PostSummary } from '@contracts/post';

/* Everything about a post that is not the picture: who posted it, what they
 * said, when, and the room held for the conversation.
 *
 * One component for two places — the column beside the post in the feed, and
 * the same column on a post's own page — because they are the same panel and
 * were drifting apart as two copies. */

/** Whatever the image route said it served, as a file extension. */
function extFor(mime: string | null): string {
  const type = (mime ?? '').split(';')[0].trim().toLowerCase();
  if (type === 'image/jpeg' || type === 'image/jpg') return 'jpg';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/gif') return 'gif';
  return 'png';
}

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
  const [zipping, setZipping] = useState(false);
  const when = new Date(post.createdAt);

  /* Every slide of the post in one archive. The pictures are already stored
     PNGs behind /api/img, so this is a fetch and a zip — nothing is redrawn,
     and what you get is exactly what was published. */
  const downloadZip = async () => {
    setZipping(true);
    try {
      const entries: ZipEntry[] = [];
      for (let i = 0; i < post.imageUrls.length; i++) {
        const res = await fetch(post.imageUrls[i]);
        if (!res.ok) throw new Error(`Slide ${i + 1} couldn't be fetched`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const n = String(i + 1).padStart(2, '0');
        entries.push({ name: `${post.slug}-${n}.${extFor(res.headers.get('content-type'))}`, bytes });
      }
      const blob = new Blob([makeZip(entries) as BlobPart], { type: 'application/zip' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${post.slug}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`${entries.length} slide${entries.length === 1 ? '' : 's'} zipped ✓`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Those images couldn't be downloaded");
    } finally {
      setZipping(false);
    }
  };

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
        {/* Only ever on a post that is not public, and only for someone who
            can already see it — so it tells you why this is on your feed
            rather than leaking that anything else exists. */}
        {post.who !== 'public' && (
          <span
            title={
              post.mine
                ? post.who === 'private'
                  ? 'Only you can see this'
                  : `Sent to ${post.assignedCount} ${post.assignedCount === 1 ? 'person' : 'people'}`
                : 'Sent to you'
            }
            className="micro ml-auto flex items-center gap-1 rounded-wobble-sm border-2 border-ink bg-yellow-soft px-1.5 py-0.5 text-[0.55rem] font-bold text-ink"
          >
            {post.who === 'private' ? (
              <Lock className="h-3 w-3" strokeWidth={2} />
            ) : (
              <Users className="h-3 w-3" strokeWidth={2} />
            )}
            {post.who === 'private'
              ? 'Private'
              : post.mine
                ? `${post.assignedCount} sent`
                : 'For you'}
          </span>
        )}
        <span
          title={meta.label}
          className={cn(
            'micro flex items-center gap-1 rounded-wobble-sm border-2 border-dashed border-pencil px-1.5 py-0.5 text-[0.55rem] font-bold text-ink-soft',
            post.who === 'public' && 'ml-auto',
          )}
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

      <div className="flex items-center gap-2 border-t-2 border-dashed border-pencil px-4 py-2">
        <p className="micro min-w-0 flex-1 text-[0.55rem] text-ink-faint">
          {when.toLocaleDateString()} ·{' '}
          {when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} ·{' '}
          {post.imageUrls.length} slide{post.imageUrls.length === 1 ? '' : 's'}
        </p>
        <button
          type="button"
          onClick={() => void downloadZip()}
          disabled={zipping || post.imageUrls.length === 0}
          aria-label="Download the images as a zip"
          title="Download the images as a zip"
          className="micro flex shrink-0 items-center gap-1 rounded-wobble-sm border-2 border-dashed border-pencil px-1.5 py-0.5 text-[0.55rem] font-bold text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-40"
        >
          <Download className="h-3 w-3" strokeWidth={2} />
          {zipping ? 'Zipping…' : 'Zip'}
        </button>
      </div>
      {/* Where the conversation will go. Marked out rather than hidden, so the
          panel does not need rearranging when it arrives. */}
      <div className="flex items-center gap-2 border-t-2 border-dashed border-pencil px-4 py-3 text-ink-faint">
        <MessageCircle className="h-4 w-4" strokeWidth={2} />
        <span className="micro text-[0.6rem]">Comments are coming here.</span>
      </div>
    </div>
  );
}
