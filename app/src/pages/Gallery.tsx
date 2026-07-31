import { useState } from 'react';
import { Images, Presentation, LibraryBig } from 'lucide-react';
import { cn } from '@/lib/utils';
import PostShelf from '@/components/feed/PostShelf';
import Slides from './Slides';
import Repos from './Repos';

/**
 * Community gallery — everything EVERYONE has made, in the same layouts as
 * the personal Slides and Repos shelves (those pages now show only your own
 * work). Browse, play, favorite freely, or narrow to the people you follow;
 * favorites marked here are yours, but the personal shelves list only what you
 * created.
 */
export default function Gallery() {
  const [tab, setTab] = useState<'slides' | 'repos' | 'posts'>('slides');

  return (
    <div>
      <div className="mx-auto w-full max-w-content px-4 pt-6 lg:px-8">
        <div className="flex items-center gap-2" role="tablist" aria-label="Gallery type">
          {(
            [
              { id: 'slides', label: 'Slides', icon: Presentation },
              { id: 'repos', label: 'Repos', icon: LibraryBig },
              { id: 'posts', label: 'Feed', icon: Images },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-wobble-sm border-2 px-4 py-2 font-heading text-sm font-bold transition-colors',
                tab === t.id
                  ? 'border-ink bg-yellow text-ink shadow-offset'
                  : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
              )}
            >
              <t.icon className="h-4 w-4" strokeWidth={2} />
              {t.label}
            </button>
          ))}
          <p className="micro ml-2 text-ink-faint">
            Everyone's work — filter to the people you follow; your own shelves stay just yours.
          </p>
        </div>
      </div>
      {tab === 'slides' && <Slides mine={false} />}
      {tab === 'repos' && <Repos mine={false} />}
      {/* Everybody's posts. The feed itself is deliberately narrow — the
          site's own posts and whatever was sent to you — so this is where the
          rest of the platform's work is read. */}
      {tab === 'posts' && (
        <div className="mx-auto w-full max-w-content px-4 py-6 lg:px-8">
          <PostShelf scope="all" emptyLine="Nobody has posted anything public yet." />
        </div>
      )}
    </div>
  );
}
