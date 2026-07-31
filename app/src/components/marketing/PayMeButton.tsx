import { useState } from 'react';
import { QrCode, X } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import CardPreview from '@/components/marketing/CardPreview';
import { emptyBusinessCard, type BusinessCard } from '@/components/marketing/business-card';
import { kindSpec, paymentFilled, paymentUri } from '@/lib/qr';

/**
 * "How to pay me" on somebody's profile.
 *
 * Shown only when they made a payment card and ticked "show it on my
 * profile"; there is nothing to press otherwise. The panel is the card
 * itself, plus the addresses as text — a QR is for a phone in the room, and
 * somebody reading this on the same screen needs to be able to copy the
 * address instead.
 */
export default function PayMeButton({ userId, name }: { userId: number; name: string }) {
  const [open, setOpen] = useState(false);
  const card = trpc.users.paymentCard.useQuery({ userId });
  const data = card.data as Partial<BusinessCard> | null | undefined;
  if (!data) return null;
  const full: BusinessCard = { ...emptyBusinessCard(), ...data, kind: 'payment' };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-wobble-sm border-2 border-dashed border-pencil px-3 py-1.5 font-heading text-sm font-bold text-ink-soft transition-colors hover:border-ink hover:text-ink"
      >
        <QrCode className="h-4 w-4" strokeWidth={2} /> How to pay {name}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`How to pay ${name}`}
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[90dvh] w-full max-w-[520px] flex-col gap-3 overflow-y-auto rounded-wobble-2 border-2 border-ink bg-paper-3 p-4 shadow-offset"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl text-ink">How to pay {name}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-ink-faint hover:text-ink"
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>

            <CardPreview card={full} />

            <div className="flex flex-col gap-1.5">
              {(full.payments ?? [])
                .filter((m) => paymentFilled(m.values))
                .map((m) => {
                  const spec = kindSpec(m.kind);
                  const uri = paymentUri(m.kind, m.values);
                  return (
                    <div
                      key={m.id}
                      className="flex flex-col gap-1 rounded-wobble-sm border-2 border-dashed border-pencil px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-heading text-sm font-bold text-ink">
                          {spec?.label ?? m.kind}
                        </span>
                        {uri && /^https?:/i.test(uri) && (
                          <a
                            href={uri}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="micro ml-auto rounded-wobble-sm border-2 border-ink bg-yellow px-2 py-0.5 text-[0.55rem] font-bold text-ink"
                          >
                            Open
                          </a>
                        )}
                      </div>
                      {(spec?.fields ?? [])
                        .filter((f) => (m.values[f.key] ?? '').trim())
                        .map((f) => (
                          <div key={f.key} className="flex flex-wrap items-center gap-2">
                            <span className="micro w-32 shrink-0 text-[0.55rem] text-ink-soft">
                              {f.label}
                            </span>
                            <span className="min-w-0 flex-1 break-all font-mono text-[0.78rem] text-ink">
                              {m.values[f.key].trim()}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                void navigator.clipboard?.writeText(m.values[f.key].trim())
                              }
                              className="micro rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-0.5 text-[0.55rem] font-bold text-ink-soft hover:border-ink hover:text-ink"
                            >
                              Copy
                            </button>
                          </div>
                        ))}
                    </div>
                  );
                })}
            </div>

            {full.details.trim() && (
              <div className="border-t-2 border-dashed border-pencil pt-2">
                <p className="micro text-[0.58rem] font-bold text-ink-soft">Contact</p>
                <p className="whitespace-pre-wrap text-sm text-ink">{full.details.trim()}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
