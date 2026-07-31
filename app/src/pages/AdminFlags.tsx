import { useMemo } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { ArrowLeft, Check, Flag, ShieldAlert } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import SketchButton from '@/components/sketch/SketchButton';
import SketchCard from '@/components/sketch/SketchCard';
import Chip from '@/components/sketch/Chip';
import AdminGate from '@/components/admin/AdminGate';
import SketchToaster from '@/components/admin/SketchToaster';
import { SkeletonBlock } from '@/components/admin/controls';
import { errMsg, formatRelative } from '@/components/admin/utils';
import { say } from '@/lib/i18n';

function FlagsBody() {
  const utils = trpc.useUtils();
  const dashboard = trpc.admin.dashboard.useQuery();

  const unflag = trpc.runs.setFlagged.useMutation({
    onSuccess: () => {
      toast.success(say("Flag dismissed ✓"));
      void utils.admin.dashboard.invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const data = dashboard.data;
  const flagged = useMemo(
    () => (data?.recentRuns ?? []).filter((r) => r.flagged),
    [data],
  );

  if (dashboard.isLoading) {
    return (
      <div className="mx-auto w-full max-w-content px-4 py-8 lg:px-8">
        <SkeletonBlock lines={4} status="Checking the flags…" />
      </div>
    );
  }

  if (dashboard.isError || !data) {
    return (
      <div className="mx-auto w-full max-w-content px-4 py-16 text-center lg:px-8">
        <p className="font-display text-3xl text-ink">{say("The flag list smudged itself.")}</p>
        <p className="mt-1 text-sm text-ink-soft">{errMsg(dashboard.error)}</p>
        <SketchButton className="mt-4" onClick={() => dashboard.refetch()}>
          
          {say("Try again")}
        </SketchButton>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-6 px-4 py-8 lg:px-8">
      <div>
        <Link
          to="/admin/controls"
          className="inline-flex items-center gap-1.5 font-heading text-sm font-semibold text-blue no-underline hover:underline"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />  {say("Controls")}
        </Link>
        <h2 className="mt-1 flex items-center gap-3 font-display text-4xl font-bold text-ink">
          <ShieldAlert className="h-8 w-8 text-red" strokeWidth={2} />
          
          {say("Flagged runs")}
          <Chip kind="neutral">{data.totals.flaggedRuns}</Chip>
        </h2>
        <p className="text-sm text-ink-soft">
          
          {say("Runs the graders marked for a second look. Review, then dismiss.")}
        </p>
      </div>

      {flagged.length === 0 ? (
        <div className="flex items-center gap-3 rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-3 px-4 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink bg-green-soft">
            <Check className="h-4 w-4 text-green" strokeWidth={2.5} />
          </span>
          <p className="font-heading text-ink">{say("Nothing flagged. Nice.")}</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {flagged.map((r, i) => (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06, duration: 0.3 }}
            >
              <SketchCard index={i} className="flex items-center gap-3 p-4">
                <Flag className="h-5 w-5 shrink-0 text-red" strokeWidth={2} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-heading font-semibold text-ink">{r.toolName}</p>
                  <p className="text-xs text-ink-soft">
                    {r.playerName}  {say("· score")} {r.scoreCorrect}/{r.scoreTotal} ·{' '}
                    <span className="font-mono">{formatRelative(r.completedAt)}</span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link to="/runs" className="no-underline">
                    <SketchButton variant="secondary" size="sm">
                      
                      {say("View")}
                    </SketchButton>
                  </Link>
                  <SketchButton
                    variant="ghost"
                    size="sm"
                    loading={unflag.isPending && unflag.variables?.runId === r.id}
                    onClick={() => unflag.mutate({ runId: r.id, flagged: false })}
                  >
                    
                    {say("Dismiss")}
                  </SketchButton>
                </div>
              </SketchCard>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminFlags() {
  return (
    <AdminGate minRole="moderator">
      <SketchToaster />
      <FlagsBody />
    </AdminGate>
  );
}
