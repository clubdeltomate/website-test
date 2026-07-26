import { Link } from 'react-router';
import { SquiggleDivider } from './sketch/Squiggle';

/** App footer (design.md §7.1): squiggle divider + tagline + links */
export default function Footer() {
  return (
    <footer className="mx-auto w-full max-w-content px-6 pb-8 pt-4 lg:px-8">
      <SquiggleDivider />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-ink-soft">
        <span className="font-heading">
          SketchLearn — made with ✏️ and a good notebook
        </span>
        <nav className="flex items-center gap-4">
          <Link to="/about" className="hover:squiggle no-underline">
            About
          </Link>
          <span className="text-ink-faint">Terms</span>
          <span className="text-ink-faint">Privacy</span>
        </nav>
      </div>
    </footer>
  );
}
