import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import AuthWall from '@/components/AuthWall';
import SketchButton from '@/components/sketch/SketchButton';
import type { Role } from '@contracts/types';
import { say } from '@/lib/i18n';

/** Doodle padlock for the staff-only empty state */
function PadlockDoodle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 72 72" className={className} fill="none" aria-hidden="true">
      <path
        d="M22 32v-8a14 14 0 0 1 28 0v8"
        stroke="#2E2820"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <rect
        x="16"
        y="30"
        width="40"
        height="32"
        rx="8"
        fill="#FFC53D"
        stroke="#2E2820"
        strokeWidth="4"
      />
      <circle cx="36" cy="44" r="4.5" fill="#2E2820" />
      <path d="M36 47v7" stroke="#2E2820" strokeWidth="4" strokeLinecap="round" />
      <path d="M60 12l2.4 6 6 2.4-6 2.4-2.4 6-2.4-6-6-2.4 6-2.4z" fill="#8566D4" />
    </svg>
  );
}

/** Pencil-stroke skeleton rows used while auth/data loads */
export function GateSkeleton() {
  return (
    <div className="mx-auto w-full max-w-content px-4 py-10 lg:px-8" aria-busy="true">
      <p className="mb-6 font-heading text-ink-faint">{say("Sharpening pencils…")}</p>
      <div className="skeleton-stroke mb-4 h-12 w-2/3" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton-stroke h-32" />
        ))}
      </div>
      <div className="skeleton-stroke mt-4 h-56 w-full" />
    </div>
  );
}

/** Friendly role-gate empty state (design.md §7.12 spirit, but in-page) */
function StaffNotebookGate({ need }: { need: string }) {
  return (
    <div className="mx-auto flex min-h-[60dvh] w-full max-w-content flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <PadlockDoodle className="h-20 w-20" />
      <h2 className="font-display text-4xl text-ink">
        
        {say("This page lives in the staff notebook")}
      </h2>
      <p className="max-w-sm text-sm text-ink-soft">
        {need === 'admin'
          ? 'Only admins can peek at this page. Moderators: the Dashboard and Users pages are yours.'
          : 'This corner is for moderators and admins. Keep sketching — your own pages are back at the Coach.'}
      </p>
      <Link to={need === 'admin' ? '/admin' : '/'} className="no-underline">
        <SketchButton variant="secondary" className="mt-2">
          {need === 'admin' ? 'Back to the dashboard' : 'Back to the Coach'}
        </SketchButton>
      </Link>
    </div>
  );
}

export interface AdminGateProps {
  /** Minimum role required to view the children */
  minRole: 'moderator' | 'admin';
  children: ReactNode;
}

/**
 * Role gate for the admin suite. Guests → AuthWall modal; signed-in users
 * without the role → friendly staff-notebook empty state (never a crash).
 */
export default function AdminGate({ minRole, children }: AdminGateProps) {
  const { user, isLoading, isGuest, role } = useAuth();
  const [wallDismissed, setWallDismissed] = useState(false);

  if (isLoading) return <GateSkeleton />;

  if (isGuest || !user) {
    return (
      <>
        <GateSkeleton />
        <AuthWall
          open={!wallDismissed}
          onClose={() => setWallDismissed(true)}
          message="The staff notebook needs a signed-in moderator or admin. Sign in to continue."
        />
        {wallDismissed && <StaffNotebookGate need={minRole} />}
      </>
    );
  }

  const rank: Record<Role, number> = { user: 0, moderator: 1, admin: 2 };
  if (!role || rank[role] < rank[minRole]) {
    return <StaffNotebookGate need={minRole} />;
  }

  return <>{children}</>;
}
