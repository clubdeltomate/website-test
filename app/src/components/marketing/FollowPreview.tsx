import { Check } from 'lucide-react';
import { OUT_W } from '@/lib/caption-words';
import type { FollowCard, FollowLayout, TextBlock } from './follow-card';

/* The on-screen twin of drawFollowCard. It walks the same layout object and
 * expresses every coordinate as a share of the frame's width, so the preview
 * is the export at a smaller size rather than an approximation of it. */

/** export px → a share of the container's width */
const cq = (px: number) => `${(px / OUT_W) * 100}cqw`;

function Block({ block, colour }: { block: TextBlock; colour: string }) {
  return (
    <>
      {block.lines.map((line, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            left: cq(block.x),
            top: cq(block.y + i * block.lead),
            width: cq(block.width),
            height: cq(block.lead),
            lineHeight: cq(block.lead),
            fontSize: cq(block.size),
            fontFamily: block.family,
            fontWeight: block.weight,
            textAlign: block.align,
            color: colour,
            whiteSpace: 'pre',
          }}
        >
          {line}
        </div>
      ))}
    </>
  );
}

export default function FollowPreview({
  card,
  layout,
}: {
  card: FollowCard;
  layout: FollowLayout;
}) {
  const stroke = `${cq(Math.max(2, 3 * layout.scale))} solid ${layout.inkSoft}`;
  return (
    <div className="absolute inset-0" style={{ background: card.bg }}>
      <Block block={layout.headline} colour={layout.ink} />

      {/* the profile card */}
      <div
        className="absolute"
        style={{
          left: cq(layout.cardX),
          top: cq(layout.cardY),
          width: cq(layout.cardW),
          height: cq(layout.cardH),
          border: stroke,
          borderRadius: cq(layout.radius),
        }}
      />

      <Block block={layout.name} colour={layout.ink} />
      {layout.tick && (
        <div
          className="absolute flex items-center justify-center rounded-full bg-[#3897F0] text-white"
          style={{
            left: cq(layout.tick.cx - layout.tick.r),
            top: cq(layout.tick.cy - layout.tick.r),
            width: cq(layout.tick.r * 2),
            height: cq(layout.tick.r * 2),
          }}
        >
          <Check
            style={{ width: cq(layout.tick.r * 1.2), height: cq(layout.tick.r * 1.2) }}
            strokeWidth={4}
          />
        </div>
      )}

      {/* logo */}
      <div
        className="absolute overflow-hidden rounded-full"
        style={{
          left: cq(layout.avatar.cx - layout.avatar.r),
          top: cq(layout.avatar.cy - layout.avatar.r),
          width: cq(layout.avatar.r * 2),
          height: cq(layout.avatar.r * 2),
          border: stroke,
        }}
      >
        {card.logoUrl && <img src={card.logoUrl} alt="" className="h-full w-full object-cover" />}
      </div>
      <div
        className="absolute flex items-center justify-center rounded-full"
        style={{
          left: cq(layout.badge.cx - layout.badge.r),
          top: cq(layout.badge.cy - layout.badge.r),
          width: cq(layout.badge.r * 2),
          height: cq(layout.badge.r * 2),
          background: layout.ink,
          color: card.bg,
          fontSize: cq(layout.badge.r * 1.7),
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        <span style={{ marginTop: cq(-layout.badge.r * 0.14) }}>+</span>
      </div>

      {layout.stats.map((s, i) => (
        <div key={i}>
          <Block block={s.value} colour={layout.ink} />
          <Block block={s.label} colour={layout.inkSoft} />
        </div>
      ))}
      <Block block={layout.handle} colour={layout.ink} />
      <Block block={layout.bio} colour={layout.inkSoft} />
    </div>
  );
}
