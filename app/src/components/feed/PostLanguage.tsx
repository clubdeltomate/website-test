import { toast } from 'sonner';
import { LANGUAGES } from '@contracts/languages';
import type { PostSummary } from '@contracts/post';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import { say } from '@/lib/i18n';
import { shortCode } from '@/lib/content-language';

/**
 * Change what language a post is in, from the post itself.
 *
 * The language is guessed once, at publish, from the setting the carousel was
 * generated under. That is right most of the time and wrong sometimes — and
 * when it is wrong the post vanishes from the shelf of the people it was
 * written for, which is not a mistake anyone should have to republish to fix.
 * Owners and admins only; everybody else just sees the sticker.
 */
export default function PostLanguage({ post }: { post: PostSummary }) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const set = trpc.posts.setLanguage.useMutation({
    onSuccess: () => {
      void utils.posts.list.invalidate();
      void utils.posts.bySlug.invalidate();
      toast.success(say('Language updated'));
    },
    onError: (e) => toast.error(say(e.message)),
  });

  const mayEdit = post.mine || user?.role === 'admin';
  if (!mayEdit) return null;

  return (
    <label className="flex shrink-0 items-center gap-1">
      <span className="sr-only">{say('Language of this post')}</span>
      <select
        value={post.contentLanguage}
        disabled={set.isPending}
        onChange={(e) => set.mutate({ slug: post.slug, contentLanguage: e.target.value })}
        aria-label={say('Language of this post')}
        className="micro rounded-wobble-sm border-2 border-dashed border-pencil bg-transparent px-1 py-0.5 text-[0.58rem] font-bold text-ink-soft outline-none hover:border-ink hover:text-ink"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {shortCode(l.code)} · {l.endonym}
          </option>
        ))}
      </select>
    </label>
  );
}
