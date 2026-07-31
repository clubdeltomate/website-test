import { useMemo } from 'react';
import { measureCtx } from '@/lib/caption-words';
import {
  CARD_H,
  CARD_W,
  type BusinessCard,
  type CardText,
  layoutBusinessCard,
} from '@/components/marketing/business-card';

/* The card on screen, laid out by the same function that draws the print
 * file. Its own component now because three places show a card: the editor,
 * the profile popover, and whatever comes next. */

/** print px → a share of the frame's width, so the preview scales exactly */
const cq = (px: number) => `${(px / CARD_W) * 100}cqw`;

function Text({ t }: { t: CardText }) {
  return (
    <>
      {t.lines.map((line, i) => (
        <div
          key={i}
          className="absolute whitespace-pre"
          style={{
            left: cq(t.x),
            top: cq(t.y + i * t.lead),
            height: cq(t.lead),
            lineHeight: cq(t.lead),
            fontSize: cq(t.size),
            fontFamily: t.family,
            fontWeight: t.weight,
            color: t.colour,
          }}
        >
          {line}
        </div>
      ))}
    </>
  );
}

export default function CardPreview({ card }: { card: BusinessCard }) {
  const L = useMemo(() => layoutBusinessCard(card, measureCtx()), [card]);

  return (
    <div
      className="relative w-full overflow-hidden rounded-wobble-sm border-2 border-ink shadow-offset [container-type:inline-size]"
      style={{ aspectRatio: `${CARD_W} / ${CARD_H}`, background: L.bg }}
    >
      <div
        className="absolute"
        style={{ left: 0, top: 0, width: cq(L.stripe.w), height: '100%', background: L.accent }}
      />
      <Text t={L.company} />
      <Text t={L.name} />
      <Text t={L.title} />
      <Text t={L.tagline} />
      <Text t={L.methods} />
      <div
        className="absolute"
        style={{
          left: cq(L.rule.x),
          top: cq(L.rule.y),
          width: cq(L.rule.w),
          height: cq(L.rule.h),
          background: L.accent,
        }}
      />
      <Text t={L.details} />
      {L.qr && (
        /* The same matrix the canvas walks, drawn as an SVG so it stays crisp
           at whatever size the preview happens to be. */
        <div
          className="absolute bg-white"
          style={{ left: cq(L.qr.x), top: cq(L.qr.y), width: cq(L.qr.size), height: cq(L.qr.size) }}
        >
          <svg
            viewBox={`0 0 ${L.qr.modules.length + 8} ${L.qr.modules.length + 8}`}
            className="h-full w-full"
            aria-label="Payment QR code"
          >
            {L.qr.modules.map((row, r) =>
              row.map((on, c) =>
                on ? <rect key={`${r}-${c}`} x={c + 4} y={r + 4} width={1} height={1} /> : null,
              ),
            )}
          </svg>
        </div>
      )}
      {L.qr?.caption && (
        <div
          className="absolute text-center"
          style={{
            left: cq(L.qr.x),
            top: cq(L.qr.y + L.qr.size + 6),
            width: cq(L.qr.size),
            fontSize: cq(22),
            fontFamily: L.details.family,
            fontWeight: 700,
            color: L.inkSoft,
          }}
        >
          {L.qr.caption}
        </div>
      )}
      {L.logo && (
        <div
          className="absolute overflow-hidden rounded-full"
          style={{
            left: cq(L.logo.cx - L.logo.r),
            top: cq(L.logo.cy - L.logo.r),
            width: cq(L.logo.r * 2),
            height: cq(L.logo.r * 2),
            border: `${cq(4)} solid ${L.accent}`,
          }}
        >
          {card.logoUrl && <img src={card.logoUrl} alt="" className="h-full w-full object-cover" />}
        </div>
      )}
    </div>
  );
}
