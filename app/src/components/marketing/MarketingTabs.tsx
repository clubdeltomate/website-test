import { NavLink } from 'react-router';
import { CreditCard, Images } from 'lucide-react';
import { cn } from '@/lib/utils';

/* Marketing is a folder now, not a page: the carousel and the business card
 * are two things made out of the same parts, so they sit side by side. */

const TABS = [
  { to: '/admin/projects/marketing', label: 'Post', icon: Images, end: true },
  { to: '/admin/projects/marketing/card', label: 'Card', icon: CreditCard, end: false },
];

export default function MarketingTabs() {
  return (
    <div className="flex w-fit overflow-hidden rounded-wobble-sm border-2 border-ink shadow-offset">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            cn(
              'micro flex items-center gap-1.5 px-3 py-1.5 text-[0.62rem] font-bold transition-colors',
              isActive ? 'bg-yellow text-ink' : 'bg-paper-3 text-ink-soft hover:text-ink',
            )
          }
        >
          <t.icon className="h-3.5 w-3.5" strokeWidth={2} />
          {t.label}
        </NavLink>
      ))}
    </div>
  );
}
