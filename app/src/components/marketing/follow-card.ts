import { FONT, FONT_BODY, OUT_W, inkFor, wrapText } from '@/lib/caption-words';

/* The carousel's closing slide: the "follow us" profile card.
 *
 * Geometry lives here, once, and both renderers walk the same result — the
 * HTML preview positions divs at those coordinates scaled to the frame, the
 * canvas export draws at them directly. That is the only way the thing on
 * screen and the thing that downloads can be the same card. */

export interface FollowCard {
  /** include it as the last slide at all */
  on: boolean;
  headline: string;
  name: string;
  verified: boolean;
  /** an uploaded data URL or a stored /api/img/:id */
  logoUrl: string | null;
  logoPrompt: string;
  posts: string;
  followers: string;
  following: string;
  bio: string;
  bg: string;
}

export const emptyFollowCard = (): FollowCard => ({
  on: true,
  headline: '',
  name: '',
  verified: true,
  logoUrl: null,
  logoPrompt: '',
  posts: '0',
  followers: '0',
  following: '0',
  bio: '',
  bg: '#0B0B0B',
});

/** Base sizes in export pixels, before the fit-to-frame shrink. */
const BASE = {
  margin: 56,
  headline: 58,
  headlineLead: 1.2,
  gap: 48,
  pad: 44,
  name: 58,
  nameLead: 1.15,
  rowGap: 30,
  avatar: 92, // radius
  avatarGap: 44,
  statValue: 46,
  statLabel: 30,
  handle: 40,
  bio: 34,
  bioLead: 1.38,
};

export interface TextBlock {
  lines: string[];
  x: number;
  y: number;
  size: number;
  lead: number;
  weight: number;
  family: string;
  align: 'left' | 'center';
  width: number;
}

/** A block's face as canvas wants it. */
export const blockFont = (b: TextBlock): string => `${b.weight} ${b.size}px ${b.family}`;

export interface FollowLayout {
  bg: string;
  ink: string;
  /** ink at reading strength for the quieter lines */
  inkSoft: string;
  cardX: number;
  cardY: number;
  cardW: number;
  cardH: number;
  radius: number;
  headline: TextBlock;
  name: TextBlock;
  handle: TextBlock;
  bio: TextBlock;
  stats: { value: TextBlock; label: TextBlock }[];
  /** verified tick, placed after the name — null when it is switched off */
  tick: { cx: number; cy: number; r: number } | null;
  avatar: { cx: number; cy: number; r: number };
  badge: { cx: number; cy: number; r: number };
  scale: number;
}

const STAT_LABELS = ['posts', 'followers', 'following'] as const;

/**
 * Place every piece of the card for a 1080 × outH frame. The whole block is
 * centred vertically and shrinks together — never past 55% — when a long
 * headline or bio would otherwise push it off the slide.
 */
export function layoutFollow(
  card: FollowCard,
  measure: CanvasRenderingContext2D | null,
  outH: number,
): FollowLayout {
  const ink = inkFor(card.bg);
  const inkSoft = ink === '#FFFFFF' ? 'rgba(255,255,255,0.72)' : 'rgba(20,17,13,0.68)';

  const build = (s: number): FollowLayout => {
    const B = BASE;
    const margin = B.margin * s;
    const pad = B.pad * s;
    const cardX = margin;
    const cardW = OUT_W - margin * 2;
    const inner = cardW - pad * 2;

    const headlineSize = B.headline * s;
    const headlineLead = headlineSize * B.headlineLead;
    const headlineLines = card.headline.trim()
      ? wrapText(card.headline, `900 ${headlineSize}px ${FONT}`, OUT_W - margin * 2, measure)
      : [];

    const nameSize = B.name * s;
    const avatarR = B.avatar * s;
    const statValue = B.statValue * s;
    const statLabel = B.statLabel * s;
    const handleSize = B.handle * s;
    const bioSize = B.bio * s;
    const bioLead = bioSize * B.bioLead;
    const bioLines = card.bio.trim()
      ? wrapText(card.bio, `400 ${bioSize}px ${FONT_BODY}`, inner, measure)
      : [];

    // walk down the inside of the card
    let y = pad;
    const nameY = y;
    y += nameSize * B.nameLead + B.rowGap * s;
    const avatarTop = y;
    y += avatarR * 2 + B.rowGap * s;
    const handleY = y;
    y += handleSize * 1.25;
    const bioY = y;
    y += bioLines.length * bioLead;
    const cardH = y + pad;

    const totalH = (headlineLines.length ? headlineLines.length * headlineLead + B.gap * s : 0) + cardH;
    const top = Math.max(margin, (outH - totalH) / 2);
    const cardY = top + (headlineLines.length ? headlineLines.length * headlineLead + B.gap * s : 0);

    const avatarCx = cardX + pad + avatarR;
    const avatarCy = cardY + avatarTop + avatarR;
    const statsX = cardX + pad + avatarR * 2 + B.avatarGap * s;
    const statsW = cardX + cardW - pad - statsX;
    const colW = statsW / 3;
    const statsMid = avatarCy;
    const valueTop = statsMid - (statValue * 1.12 + statLabel * 1.2) / 2;

    const values = [card.posts, card.followers, card.following];
    const stats = STAT_LABELS.map((label, i) => ({
      value: {
        lines: [values[i] || '0'],
        x: statsX + colW * i,
        y: valueTop,
        size: statValue,
        lead: statValue * 1.12,
        weight: 900,
        family: FONT,
        align: 'center' as const,
        width: colW,
      },
      label: {
        lines: [label],
        x: statsX + colW * i,
        y: valueTop + statValue * 1.12,
        size: statLabel,
        lead: statLabel * 1.2,
        weight: 400,
        family: FONT_BODY,
        align: 'center' as const,
        width: colW,
      },
    }));

    let tick: FollowLayout['tick'] = null;
    if (card.verified && card.name.trim()) {
      const tickR = nameSize * 0.3;
      let nameW = 0;
      if (measure) {
        measure.font = `900 ${nameSize}px ${FONT}`;
        nameW = measure.measureText(card.name).width;
      }
      tick = {
        cx: cardX + pad + nameW + tickR + nameSize * 0.22,
        cy: cardY + nameY + nameSize * 0.55,
        r: tickR,
      };
    }

    return {
      bg: card.bg,
      ink,
      inkSoft,
      cardX,
      cardY,
      cardW,
      cardH,
      radius: 30 * s,
      headline: {
        lines: headlineLines,
        x: margin,
        y: top,
        size: headlineSize,
        lead: headlineLead,
        weight: 900,
        family: FONT,
        align: 'left',
        width: OUT_W - margin * 2,
      },
      name: {
        lines: card.name.trim() ? [card.name] : [],
        x: cardX + pad,
        y: cardY + nameY,
        size: nameSize,
        lead: nameSize * B.nameLead,
        weight: 900,
        family: FONT,
        align: 'left',
        width: inner,
      },
      handle: {
        lines: card.name.trim() ? [card.name] : [],
        x: cardX + pad,
        y: cardY + handleY,
        size: handleSize,
        lead: handleSize * 1.25,
        weight: 700,
        family: FONT_BODY,
        align: 'left',
        width: inner,
      },
      bio: {
        lines: bioLines,
        x: cardX + pad,
        y: cardY + bioY,
        size: bioSize,
        lead: bioLead,
        weight: 400,
        family: FONT_BODY,
        align: 'left',
        width: inner,
      },
      stats,
      tick,
      avatar: { cx: avatarCx, cy: avatarCy, r: avatarR },
      badge: {
        cx: avatarCx + avatarR * 0.72,
        cy: avatarCy + avatarR * 0.72,
        r: avatarR * 0.27,
      },
      scale: s,
    };
  };

  let s = 1;
  let out = build(s);
  while (s > 0.55 && out.cardY + out.cardH > outH - BASE.margin * s) {
    s -= 0.05;
    out = build(s);
  }
  return out;
}

/** Draw the finished card onto a canvas already sized to the export frame. */
export async function drawFollowCard(
  ctx: CanvasRenderingContext2D,
  card: FollowCard,
  layout: FollowLayout,
  outH: number,
): Promise<void> {
  ctx.fillStyle = card.bg;
  ctx.fillRect(0, 0, OUT_W, outH);
  // Middle baseline against a line box of `lead` — the same arithmetic the
  // HTML preview does with line-height, so the two land on the same pixels.
  ctx.textBaseline = 'middle';

  const run = (b: TextBlock, colour: string) => {
    if (b.lines.length === 0) return;
    ctx.font = blockFont(b);
    ctx.fillStyle = colour;
    b.lines.forEach((line, i) => {
      const x = b.align === 'center' ? b.x + (b.width - ctx.measureText(line).width) / 2 : b.x;
      ctx.fillText(line, x, b.y + i * b.lead + b.lead / 2);
    });
  };

  run(layout.headline, layout.ink);

  // card outline
  ctx.strokeStyle = layout.inkSoft;
  ctx.lineWidth = Math.max(2, 3 * layout.scale);
  ctx.beginPath();
  ctx.roundRect(layout.cardX, layout.cardY, layout.cardW, layout.cardH, layout.radius);
  ctx.stroke();

  run(layout.name, layout.ink);
  if (layout.tick) {
    const { cx, cy, r } = layout.tick;
    ctx.fillStyle = '#3897F0';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = Math.max(2, r * 0.22);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.42, cy);
    ctx.lineTo(cx - r * 0.1, cy + r * 0.34);
    ctx.lineTo(cx + r * 0.46, cy - r * 0.36);
    ctx.stroke();
  }

  // avatar
  const { cx, cy, r } = layout.avatar;
  if (card.logoUrl) {
    const img = new Image();
    img.src = card.logoUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("The logo couldn't be loaded"));
    });
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    const scale = Math.max((r * 2) / img.width, (r * 2) / img.height);
    ctx.drawImage(img, cx - (img.width * scale) / 2, cy - (img.height * scale) / 2, img.width * scale, img.height * scale);
    ctx.restore();
  }
  ctx.strokeStyle = layout.inkSoft;
  ctx.lineWidth = Math.max(2, 3 * layout.scale);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // "+" badge
  const b = layout.badge;
  ctx.fillStyle = layout.ink;
  ctx.beginPath();
  ctx.arc(b.cx, b.cy, b.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = card.bg;
  ctx.lineWidth = Math.max(2, b.r * 0.22);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(b.cx - b.r * 0.46, b.cy);
  ctx.lineTo(b.cx + b.r * 0.46, b.cy);
  ctx.moveTo(b.cx, b.cy - b.r * 0.46);
  ctx.lineTo(b.cx, b.cy + b.r * 0.46);
  ctx.stroke();

  for (const s of layout.stats) {
    run(s.value, layout.ink);
    run(s.label, layout.inkSoft);
  }
  run(layout.handle, layout.ink);
  run(layout.bio, layout.inkSoft);
}
