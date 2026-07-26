import { useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import type { RepoTemplate } from '@contracts/types';
import { TemplateIcon } from '@/components/repo/shared';
import SketchButton from '../sketch/SketchButton';
import WashiTape from '../sketch/WashiTape';

export interface CreateToolModalProps {
  open: boolean;
  onClose: () => void;
}

const CATEGORIES: { id: RepoTemplate; label: string; hint: string }[] = [
  { id: 'course', label: 'Lesson', hint: 'Teach a topic — quizzes allowed' },
  { id: 'walkthrough', label: 'Walkthrough', hint: 'Explain a topic — no quizzes' },
  { id: 'news', label: 'Time Travel News', hint: 'News from any era — no quizzes' },
  { id: 'restaurant', label: 'Menu item', hint: 'Showcase a dish — no evaluations' },
  { id: 'service', label: 'Service', hint: 'Showcase a service — no evaluations' },
  { id: 'shop', label: 'Product', hint: 'Marketplace display — no evaluations' },
];

/**
 * "New slide tool" — kept deliberately tiny: just a name and what kind of
 * presentation it is. Everything else (prompt, level, images, per-slide
 * templates) is set on the tool page itself, where the title stays editable.
 */
export default function CreateToolModal({ open, onClose }: CreateToolModalProps) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<RepoTemplate>('course');

  const create = trpc.slideTools.create.useMutation({
    onSuccess: async ({ slug }) => {
      await utils.slideTools.list.invalidate();
      onClose();
      navigate(`/slides/${slug}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    if (name.trim().length < 3) {
      toast.error('Give your tool a name (3+ characters).');
      return;
    }
    create.mutate({ name: name.trim(), template });
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-ink/30" onClick={onClose} aria-hidden="true" />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="New slide tool"
            className="relative w-full max-w-[480px] rounded-wobble-2 border-2 border-ink bg-paper-3 p-6 pt-9 shadow-offset sm:p-8 sm:pt-10"
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
          >
            <WashiTape rotate={-4} className="left-8" />
            <WashiTape rotate={3} color="blue" className="left-auto right-8" />

            <h2 className="font-display text-4xl font-bold text-ink">New slide tool</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Name it and pick what it's for — you'll set the prompt and everything else on the next
              page.
            </p>

            <div className="mt-5 flex flex-col gap-4">
              <label className="block">
                <span className="micro mb-1 block text-ink-soft">Name</span>
                <input
                  className="w-full rounded-wobble-sm border-2 border-ink bg-paper-3 px-3.5 py-2.5 text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue focus:shadow-[4px_4px_0_#DDE9FB]"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                  placeholder="e.g. Aura Ring"
                  maxLength={120}
                  autoFocus
                />
              </label>

              <div>
                <span className="micro mb-1.5 block text-ink-soft">What is it?</span>
                <div className="grid grid-cols-2 gap-2">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setTemplate(c.id)}
                      title={c.hint}
                      className={cn(
                        'flex items-center gap-2 rounded-wobble-sm border-2 px-3 py-2.5 text-left transition-all',
                        template === c.id
                          ? 'border-ink bg-yellow shadow-offset'
                          : 'border-dashed border-pencil hover:border-ink',
                      )}
                    >
                      <TemplateIcon template={c.id} className="h-4 w-4 shrink-0 text-ink" />
                      <span className="min-w-0">
                        <span className="block font-heading text-sm font-bold text-ink">{c.label}</span>
                        <span className="micro block truncate text-[0.56rem] text-ink-faint">{c.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <SketchButton variant="ghost" onClick={onClose}>
                Cancel
              </SketchButton>
              <SketchButton variant="accent" loading={create.isPending} onClick={submit}>
                Create &amp; open
              </SketchButton>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
