import { FONT, FONT_BODY, inkFor, wrapText } from '@/lib/caption-words';

/* A business card, laid out the same way the follow card is: geometry
 * computed once, walked by both the on-screen preview and the canvas export.
 *
 * The layout is deliberately fixed. Everything on it is yours to change —
 * the words, the colours, the logo, the accent — but where those things sit
 * is not, because the point of a card is that yours and the next one look
 * like they came from the same company. A free-form canvas would produce
 * twenty cards that share nothing. */

/** Standard 3.5 × 2in at 300dpi, the size a printer expects. */
export const CARD_W = 1050;
export const CARD_H = 600;

export interface BusinessCard {
  name: string;
  title: string;
  company: string;
  tagline: string;
  /** one per line: phone, email, site, whatever matters */
  details: string;
  logoUrl: string | null;
  logoPrompt: string;
  bg: string;
  accent: string;
}

export const emptyBusinessCard = (): BusinessCard => ({
  name: '',
  title: '',
  company: '',
  tagline: '',
  details: '',
  logoUrl: null,
  logoPrompt: '',
  bg: '#FFFDF6',
  accent: '#B4471F',
});

export interface CardText {
  lines: string[];
  x: number;
  y: number;
  size: number;
  lead: number;
  weight: number;
  family: string;
  colour: string;
}

export interface CardLayout {
  bg: string;
  ink: string;
  inkSoft: string;
  accent: string;
  /** the accent stripe down the left edge */
  stripe: { x: number; y: number; w: number; h: number };
  rule: { x: number; y: number; w: number; h: number };
  logo: { cx: number; cy: number; r: number } | null;
  company: CardText;
  name: CardText;
  title: CardText;
  tagline: CardText;
  details: CardText;
}

const PAD = 74;
const STRIPE = 18;

/**
 * Place the card. Text shrinks together — never past 60% — when someone types
 * more contact lines than the height allows, so a long card stays a card
 * rather than overflowing off the edge.
 */
export function layoutBusinessCard(
  card: BusinessCard,
  measure: CanvasRenderingContext2D | null,
): CardLayout {
  const ink = inkFor(card.bg);
  const inkSoft = ink === '#FFFFFF' ? 'rgba(255,255,255,0.68)' : 'rgba(20,17,13,0.62)';
  const left = STRIPE + PAD;
  const hasLogo = card.logoUrl !== null;
  const logoR = 64;
  const textRight = CARD_W - PAD - (hasLogo ? logoR * 2 + 34 : 0);
  const textW = textRight - left;

  const build = (s: number) => {
    const companySize = 30 * s;
    const nameSize = 62 * s;
    const titleSize = 30 * s;
    const taglineSize = 26 * s;
    const detailSize = 26 * s;
    const detailLead = detailSize * 1.5;

    const taglineLines = card.tagline.trim()
      ? wrapText(card.tagline, `400 ${taglineSize}px ${FONT_BODY}`, textW, measure)
      : [];
    const detailLines = card.details.trim()
      ? wrapText(card.details, `400 ${detailSize}px ${FONT_BODY}`, textW, measure)
      : [];

    // Top block grows down from the padding; contact details hang off the
    // bottom edge, which is where a reader's eye goes for them.
    const detailsH = detailLines.length * detailLead;
    let y = PAD;
    const companyY = card.company.trim() ? y : y - companySize * 1.3;
    if (card.company.trim()) y += companySize * 1.35;
    const nameY = y;
    y += nameSize * 1.12;
    const titleY = y;
    if (card.title.trim()) y += titleSize * 1.5;
    const taglineY = y;
    y += taglineLines.length * taglineSize * 1.4;

    const detailsY = CARD_H - PAD - detailsH;
    return { companySize, nameSize, titleSize, taglineSize, detailSize, detailLead, taglineLines, detailLines, companyY, nameY, titleY, taglineY, detailsY, bottom: y };
  };

  let s = 1;
  let b = build(s);
  while (s > 0.6 && b.bottom > b.detailsY - 12) {
    s -= 0.05;
    b = build(s);
  }

  return {
    bg: card.bg,
    ink,
    inkSoft,
    accent: card.accent,
    stripe: { x: 0, y: 0, w: STRIPE, h: CARD_H },
    rule: { x: left, y: b.detailsY - 26, w: Math.min(120, textW), h: Math.max(3, 4 * s) },
    logo: hasLogo ? { cx: CARD_W - PAD - logoR, cy: PAD + logoR, r: logoR } : null,
    company: {
      lines: card.company.trim() ? [card.company.toUpperCase()] : [],
      x: left,
      y: b.companyY,
      size: b.companySize,
      lead: b.companySize * 1.35,
      weight: 900,
      family: FONT,
      colour: card.accent,
    },
    name: {
      lines: card.name.trim() ? [card.name] : [],
      x: left,
      y: b.nameY,
      size: b.nameSize,
      lead: b.nameSize * 1.12,
      weight: 900,
      family: FONT,
      colour: ink,
    },
    title: {
      lines: card.title.trim() ? [card.title] : [],
      x: left,
      y: b.titleY,
      size: b.titleSize,
      lead: b.titleSize * 1.5,
      weight: 700,
      family: FONT_BODY,
      colour: inkSoft,
    },
    tagline: {
      lines: b.taglineLines,
      x: left,
      y: b.taglineY,
      size: b.taglineSize,
      lead: b.taglineSize * 1.4,
      weight: 400,
      family: FONT_BODY,
      colour: inkSoft,
    },
    details: {
      lines: b.detailLines,
      x: left,
      y: b.detailsY,
      size: b.detailSize,
      lead: b.detailLead,
      weight: 400,
      family: FONT_BODY,
      colour: ink,
    },
  };
}

/** Draw the card at print size. */
export async function drawBusinessCard(
  ctx: CanvasRenderingContext2D,
  card: BusinessCard,
  L: CardLayout,
): Promise<void> {
  ctx.fillStyle = L.bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = L.accent;
  ctx.fillRect(L.stripe.x, L.stripe.y, L.stripe.w, L.stripe.h);
  ctx.textBaseline = 'middle';

  const run = (t: CardText) => {
    if (t.lines.length === 0) return;
    ctx.font = `${t.weight} ${t.size}px ${t.family}`;
    ctx.fillStyle = t.colour;
    t.lines.forEach((line, i) => ctx.fillText(line, t.x, t.y + i * t.lead + t.lead / 2));
  };

  run(L.company);
  run(L.name);
  run(L.title);
  run(L.tagline);

  ctx.fillStyle = L.accent;
  ctx.fillRect(L.rule.x, L.rule.y, L.rule.w, L.rule.h);
  run(L.details);

  if (L.logo && card.logoUrl) {
    const img = new Image();
    img.src = card.logoUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("The logo couldn't be loaded"));
    });
    ctx.save();
    ctx.beginPath();
    ctx.arc(L.logo.cx, L.logo.cy, L.logo.r, 0, Math.PI * 2);
    ctx.clip();
    const scale = Math.max((L.logo.r * 2) / img.width, (L.logo.r * 2) / img.height);
    ctx.drawImage(
      img,
      L.logo.cx - (img.width * scale) / 2,
      L.logo.cy - (img.height * scale) / 2,
      img.width * scale,
      img.height * scale,
    );
    ctx.restore();
    ctx.strokeStyle = L.accent;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(L.logo.cx, L.logo.cy, L.logo.r, 0, Math.PI * 2);
    ctx.stroke();
  }
}
