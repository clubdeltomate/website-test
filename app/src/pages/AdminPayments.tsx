import { useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { ArrowLeft, HandCoins, ExternalLink, Check, X as XIcon } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import SketchButton from '@/components/sketch/SketchButton';
import SketchCard from '@/components/sketch/SketchCard';
import Chip from '@/components/sketch/Chip';
import AdminGate from '@/components/admin/AdminGate';
import SketchToaster from '@/components/admin/SketchToaster';
import { SketchModal } from '@/components/admin/overlays';
import { LabeledField, SketchInput, SkeletonBlock } from '@/components/admin/controls';
import { errMsg, formatMoney, formatRelative } from '@/components/admin/utils';
import type { PaymentRow } from '@contracts/types';
import { say } from '@/lib/i18n';

function PaymentsQueue({
  payments,
  sheetUrl,
  onChanged,
}: {
  payments: PaymentRow[];
  sheetUrl: string;
  onChanged: () => void;
}) {
  const [rejecting, setRejecting] = useState<PaymentRow | null>(null);
  const [reason, setReason] = useState('');
  const [leaving, setLeaving] = useState<number[]>([]);

  const approve = trpc.payments.approve.useMutation({
    onSuccess: (_r, vars) => {
      const p = payments.find((x) => x.id === vars.paymentId);
      toast.success(`Credited ${p?.packTokens ?? ''} 🪙 to ${p?.userName ?? 'user'}`);
      animateOut(vars.paymentId);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const reject = trpc.payments.reject.useMutation({
    onSuccess: (_r, vars) => {
      toast.success(say("Payment rejected"));
      setRejecting(null);
      setReason('');
      animateOut(vars.paymentId);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const animateOut = (id: number) => {
    setLeaving((l) => [...l, id]);
    window.setTimeout(onChanged, 320);
  };

  const visible = payments.filter((p) => !leaving.includes(p.id));

  return (
    <SketchCard borderStyle="solid" className="relative overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-3 border-b-2 border-ink bg-yellow px-4 py-3">
        <HandCoins className="h-5 w-5 text-ink" strokeWidth={2} />
        <h3 className="font-heading text-lg font-semibold text-ink">
          
          {say("Pending payments — credit after checking the sheet")}
        </h3>
        <Chip kind="neutral" className="border-ink bg-paper-3">
          {visible.length}
        </Chip>
        {sheetUrl && (
          <a href={sheetUrl} target="_blank" rel="noreferrer" className="ml-auto no-underline">
            <SketchButton variant="secondary" size="sm">
              
              {say("Open payment sheet")} <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
            </SketchButton>
          </a>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <svg viewBox="0 0 48 48" className="h-12 w-12" fill="none" aria-hidden="true">
            <path
              d="M8 34c6-2 10-8 10-14 4 4 4 10 2 14m4-16c8-4 14-2 16 4M12 40h24"
              stroke="#C9BFA9"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <path d="M34 8l1.4 3.4L39 13l-3.6 1.6L34 18l-1.4-3.4L29 13l3.6-1.6z" fill="#8566D4" />
          </svg>
          <p className="font-display text-3xl text-ink">{say("All caught up ✓")}</p>
          <p className="text-sm text-ink-faint">{say("The pencil is sleeping. No payments waiting.")}</p>
        </div>
      ) : (
        <ul className="divide-y-2 divide-dashed divide-pencil">
          <AnimatePresence initial={false}>
            {visible.map((p) => (
              <motion.li
                key={p.id}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden border-l-4 border-orange"
              >
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-ink bg-blue-soft font-display text-lg text-ink">
                    {(p.userName ?? '?').charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-heading font-semibold text-ink">
                      {p.userName ?? 'Unknown'}
                      <span className="ml-2 font-mono text-xs font-normal text-ink-faint">
                        {p.userEmail}
                      </span>
                    </p>
                    <p className="text-xs text-ink-soft">
                      <span className="font-mono font-bold text-orange">
                        {p.packTokens} 🪙 · {formatMoney(p.amountCents)}
                      </span>
                      {' · '}
                      <span className="font-mono">{formatRelative(p.createdAt)}</span>
                      {p.note && (
                        <span className="block truncate italic" title={p.note}>
                          “{p.note.split('\n')[0]}”
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <SketchButton
                      variant="accent"
                      size="sm"
                      loading={approve.isPending && approve.variables?.paymentId === p.id}
                      onClick={() => approve.mutate({ paymentId: p.id })}
                    >
                      <Check className="h-4 w-4" strokeWidth={2.5} />  {say("Credit")}
                    </SketchButton>
                    <SketchButton
                      variant="ghost"
                      size="sm"
                      className="text-red hover:border-red"
                      onClick={() => {
                        setRejecting(p);
                        setReason('');
                      }}
                    >
                      <XIcon className="h-4 w-4" strokeWidth={2.5} />  {say("Reject")}
                    </SketchButton>
                  </div>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <SketchModal
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title={say("Reject this payment?")}
        maxWidth="max-w-[440px]"
      >
        <p className="mb-3 text-sm text-ink-soft">
          {rejecting?.userName}{say("'s note for")} {rejecting?.packTokens}  {say("🪙 will be marked Rejected in their history.")}
        </p>
        <LabeledField label="Reason (one line)">
          <SketchInput
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={say("Couldn't find this row in the sheet…")}
          />
        </LabeledField>
        <div className="mt-4 flex gap-2">
          <SketchButton
            variant="danger"
            loading={reject.isPending}
            onClick={() => rejecting && reject.mutate({ paymentId: rejecting.id })}
          >
            
            {say("Reject payment")}
          </SketchButton>
          <SketchButton variant="ghost" onClick={() => setRejecting(null)}>
            
            {say("Keep it pending")}
          </SketchButton>
        </div>
      </SketchModal>
    </SketchCard>
  );
}

function PaymentsBody() {
  const utils = trpc.useUtils();
  const dashboard = trpc.admin.dashboard.useQuery();
  const packs = trpc.tokens.packs.useQuery();
  const data = dashboard.data;

  if (dashboard.isLoading) {
    return (
      <div className="mx-auto w-full max-w-content px-4 py-8 lg:px-8">
        <SkeletonBlock lines={4} status="Counting the coins…" />
      </div>
    );
  }

  if (dashboard.isError || !data) {
    return (
      <div className="mx-auto w-full max-w-content px-4 py-16 text-center lg:px-8">
        <p className="font-display text-3xl text-ink">{say("The ledger smudged itself.")}</p>
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
        <h2 className="mt-1 font-display text-4xl font-bold text-ink">{say("Pending payments")}</h2>
        <p className="text-sm text-ink-soft">
          
          {say("Check the sheet, then credit or reject each note.")}
        </p>
      </div>

      <PaymentsQueue
        payments={data.pendingPayments}
        sheetUrl={packs.data?.googleSheetUrl ?? ''}
        onChanged={() => void utils.admin.dashboard.invalidate()}
      />
    </div>
  );
}

export default function AdminPayments() {
  return (
    <AdminGate minRole="moderator">
      <SketchToaster />
      <PaymentsBody />
    </AdminGate>
  );
}
