import { FONT, FONT_BODY, inkFor, wrapText } from '@/lib/caption-words';
import {
  paymentBrand,
  paymentFilled,
  paymentLabel,
  paymentLines,
  paymentUri,
  qrMatrix,
} from '@/lib/qr';

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

/**
 * One way to be paid: which rail, and the address on it.
 *
 * A list rather than named fields, because the list is open — somebody will
 * want a rail nobody thought of, and "Payment link" with a URL covers it
 * without a schema change.
 */
export interface PaymentMethod {
  id: string;
  /** a PAYMENT_KINDS id */
  kind: string;
  /** field key → what was typed; the keys a rail has are its own business */
  values: Record<string, string>;
  /**
   * A QR photographed or downloaded from somewhere else.
   *
   * Binance's in-app code is a link only Binance can mint, so a generated
   * one cannot stand in for it. When this is set it IS the code — the card
   * shows exactly what the exchange showed you.
   */
  qrImage?: string | null;
}

/** Which face is being laid out. */
export type CardSide = 'front' | 'back';

/**
 * What the back is FOR.
 *
 * A back is a whole second face and there is no one right thing to put on
 * it, so it is a choice rather than a fixed slot: a line worth quoting, the
 * ways to reach you, every way to pay you, or just the mark. Each is the
 * same card — same colours, same stripe, same fonts — arranged for a
 * different job.
 */
export type BackLayout = 'quote' | 'contact' | 'payments' | 'badge';

/**
 * What a payment card puts in its front's top-right corner.
 *
 * The code is for a phone in the room; the mark is for everything else. Only
 * one of them fits, and which one is worth more depends entirely on how the
 * card gets handed over, so it is asked rather than assumed.
 */
export type FrontMark = 'logo' | 'qr';

export const BACK_LAYOUTS: { id: BackLayout; label: string; blurb: string }[] = [
  { id: 'quote', label: 'Quote', blurb: 'One line worth reading, big.' },
  { id: 'contact', label: 'Contact', blurb: 'Name, role and every way to reach you.' },
  { id: 'payments', label: 'Ways to pay', blurb: 'Every way to pay you, in two columns.' },
  { id: 'badge', label: 'Big logo', blurb: 'The mark, centred, with the company under it.' },
];

export interface BusinessCard {
  /** which card this is: the one you hand over, or the one you get paid by */
  kind: 'business' | 'payment';
  /** the back is optional — a one-sided card is a perfectly good card */
  backOn: boolean;
  /** what the back is arranged for */
  backLayout: BackLayout;
  /** the back's big line: a quote, a promise, a menu, whatever it is for */
  quote: string;
  /** the small line under it */
  backNote: string;
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
  /** payment card only */
  payments: PaymentMethod[];
  /** which method the QR encodes; falls back to the first with a value */
  qrOf: string;
  /** payment card only: the code or the logo in the front's corner */
  frontMark: FrontMark;
  /** the payment card is visible on your profile */
  shared: boolean;
}

export const emptyBusinessCard = (): BusinessCard => ({
  kind: 'business',
  backOn: false,
  backLayout: 'quote',
  quote: '',
  backNote: '',
  payments: [],
  qrOf: '',
  frontMark: 'logo',
  shared: false,
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


/**
 * The two cards an account keeps, side by side.
 *
 * They used to be one object with a `kind` on it, which meant switching to
 * the payment card inherited whatever colours, logo and back the business
 * card had — change one and you changed the other. They are two different
 * things handed to two different people, so they are two records.
 */
export interface CardPair {
  business: BusinessCard;
  payment: BusinessCard;
}

export const emptyCardPair = (): CardPair => ({
  business: { ...emptyBusinessCard(), kind: 'business' },
  payment: { ...emptyBusinessCard(), kind: 'payment' },
});

/**
 * A saved blob, read as a pair.
 *
 * Older accounts hold ONE card with a `kind`, from before the two were
 * separate. That card is kept as whichever kind it says it was, and the other
 * side starts blank rather than inheriting it — inheriting is the bug this
 * split exists to fix.
 */
export function splitSavedCards(
  saved: Record<string, unknown> | null | undefined,
  seed?: { name: string; company: string; details: string },
): CardPair {
  const pair = emptyCardPair();
  if (seed) {
    for (const k of ['business', 'payment'] as const) {
      pair[k] = { ...pair[k], name: seed.name, company: seed.company, details: seed.details };
    }
  }
  if (!saved) return pair;

  const twoSided = saved.business != null || saved.payment != null;
  if (twoSided) {
    if (saved.business) {
      pair.business = { ...pair.business, ...(saved.business as Partial<BusinessCard>) };
    }
    if (saved.payment) {
      pair.payment = { ...pair.payment, ...(saved.payment as Partial<BusinessCard>) };
    }
    pair.business.kind = 'business';
    pair.payment.kind = 'payment';
    return pair;
  }

  const legacy = saved as Partial<BusinessCard>;
  const which = legacy.kind === 'payment' ? 'payment' : 'business';
  pair[which] = { ...pair[which], ...legacy, kind: which };
  return pair;
}

export interface CardText {
  lines: string[];
  x: number;
  y: number;
  /** the box the lines sit in — what centring is measured against */
  w: number;
  align: 'left' | 'center';
  size: number;
  lead: number;
  weight: number;
  family: string;
  colour: string;
}

/** The QR block on a payment card: where it sits and what it says. */
export interface QrBlock {
  x: number;
  y: number;
  size: number;
  modules: boolean[][];
  /** a code the user supplied instead of one we generated */
  image: string | null;
  /** what a scanner will read, for the line printed under it */
  caption: string;
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
  /** payment card only: the code and the lines beside it */
  qr: QrBlock | null;
  /** the written payment list — one run per method, so each can be marked */
  methods: CardText[];
  /**
   * A coloured stripe beside each method's block, in that rail's own colour.
   *
   * Parallel to `methods`: one rule per run. Four rails stacked as plain text
   * is a wall you have to read to parse; a Binance-yellow bar beside one and
   * a PayPal-blue bar beside the next is answered before you have read a
   * word.
   */
  methodRules: { x: number; y: number; w: number; h: number; colour: string }[];
}

const PAD = 74;
const STRIPE = 18;

/**
 * Break one line to a width, splitting a word if the word is the problem.
 *
 * A wallet address is forty characters with nowhere to break, so ordinary
 * word wrapping leaves it hanging off the edge of the card. It used to be
 * abbreviated to its ends instead, which reads fine and is useless: nobody
 * can pay an address they cannot copy. So it is printed in full and broken
 * mid-token when it must be — a card is something people read off, and half
 * an address is not an address.
 */
function fitLines(
  line: string,
  font: string,
  maxW: number,
  measure: CanvasRenderingContext2D | null,
): string[] {
  if (!measure || !line) return [line];
  measure.font = font;
  if (measure.measureText(line).width <= maxW) return [line];
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (cur && measure.measureText(cur + ch).width > maxW) {
      out.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** The id of the method the code is for, so the back can skip it. */
function chosenId(card: BusinessCard): string {
  return qrMethod(card)?.id ?? '';
}

/** The lines one method contributes to the written list. */
function methodBlock(m: PaymentMethod): string[] {
  return [paymentLabel(m.kind), ...paymentLines(m.kind, m.values), ''];
}

/**
 * The back's layout, defaulted for cards saved before there was a choice.
 *
 * A payment card with methods on it wants the list; everything else wants
 * the quote, which is what the only back used to be.
 */
export function backLayoutOf(card: BusinessCard): BackLayout {
  return card.backLayout ?? 'quote';
}

/** The corner of a payment card's front, defaulted for older saved cards. */
export function frontMarkOf(card: BusinessCard): FrontMark {
  return card.frontMark ?? 'qr';
}

/**
 * Place the card. Text shrinks together — never past 60% — when someone types
 * more contact lines than the height allows, so a long card stays a card
 * rather than overflowing off the edge.
 */
export function layoutBusinessCard(
  card: BusinessCard,
  measure: CanvasRenderingContext2D | null,
  side: CardSide = 'front',
): CardLayout {
  const ink = inkFor(card.bg);
  const inkSoft = ink === '#FFFFFF' ? 'rgba(255,255,255,0.68)' : 'rgba(20,17,13,0.62)';
  const left = STRIPE + PAD;
  const back = side === 'back';
  const pay = card.kind === 'payment';
  const plan = back ? backLayoutOf(card) : 'quote';

  /* The badge back is not the same frame rearranged — it is centred, and
     centred geometry has nothing in common with a left-aligned one. It gets
     its own function rather than a thicket of conditionals in this one. */
  if (back && plan === 'badge') return badgeBack(card, measure, ink, inkSoft);

  /* Every other face is the same frame with different words in it. Which
     words is the whole of the layout choice: the quote back gives the big
     line to the quote, the contact back repeats who you are and how to
     reach you, the payments back keeps its middle clear for the list. */
  const text = !back
    ? {
        company: card.company,
        name: card.name,
        title: card.title,
        tagline: card.tagline,
        details: card.details,
      }
    : plan === 'contact'
      ? {
          company: card.company,
          name: card.name,
          title: card.title,
          tagline: card.backNote,
          details: card.details,
        }
      : {
          company: card.company,
          name: '',
          title: '',
          tagline: card.quote,
          details: card.backNote,
        };
  const hasTitleOut = !pay && text.title.trim().length > 0;
  /* The front's top-right corner belongs to the code on a payment card and
     to the logo on a business one. The back has room for both. */
  /* What sits in the front's top-right corner of a PAYMENT card is a choice:
     the scannable code, or the logo. A business card has never had the code
     and the back has room for the mark either way. */
  const wantsQr = pay && !back && frontMarkOf(card) === 'qr';
  const hasLogo = card.logoUrl !== null && (back || !pay || !wantsQr);
  const logoR = 64;
  /* A payment card gives its right-hand third to the QR; the words get what
     is left. On a business card that space is the logo's, or nobody's. */
  const qrSize = wantsQr ? 250 : 0;
  const textRight =
    CARD_W - PAD - (qrSize ? qrSize + 40 : hasLogo ? logoR * 2 + 34 : 0);
  const textW = textRight - left;

  /* The code and the written list are the payment card's whole point, so
     they are built from the same methods — what a phone scans and what a
     person reads off the card say the same thing. */
  const chosen = pay && !back ? qrMethod(card) : null;
  const uri = chosen ? paymentUri(chosen.kind, chosen.values) : '';
  const modules = chosen && !chosen.qrImage ? qrMatrix(uri) : null;
  /* An uploaded code takes the same box — the card cannot tell the
     difference and neither can a phone. */
  const qrHere = wantsQr && (modules != null || chosen?.qrImage);
  const qr: QrBlock | null = qrHere
    ? {
        x: CARD_W - PAD - qrSize,
        y: (CARD_H - qrSize) / 2,
        size: qrSize,
        modules: modules ?? [],
        image: chosen?.qrImage ?? null,
        caption: chosen ? paymentLabel(chosen.kind) : '',
      }
    : null;

  /* The front carries the one method the code is for. The list of the rest
     is the payments back's job and nobody else's — a quote back that also
     dumped four wallet addresses under the quote would be neither. */
  const shown = !pay
    ? back && plan === 'payments'
      ? card.payments.filter((m) => paymentFilled(m.values))
      : []
    : back
      ? plan === 'payments'
        ? card.payments.filter((m) => paymentFilled(m.values) && m.id !== chosenId(card))
        : []
      : chosen
        ? [chosen]
        : card.payments.filter((m) => paymentFilled(m.values)).slice(0, 1);

  /* Two columns once the list outgrows one, because "add another way to pay"
     should keep working past the fourth one instead of running off the card.
     The count is taken before wrapping — how many columns there are decides
     how wide they are, which decides where the lines wrap, so it cannot be
     the wrapped count without going round in a circle. */
  const raw = shown.map(methodBlock);
  const columns =
    back && (shown.length > 2 || raw.reduce((n, b2) => n + b2.length, 0) > 9) ? 2 : 1;
  const colGap = 30;
  const colW = (textW - colGap * (columns - 1)) / columns;
  /* Wrapped at full size even when the card later shrinks to fit: a line
     that fits at 24px fits at 21px too, and a name that runs off the right
     edge is worse than one that breaks a word early. */
  const methodFont = `700 24px ${FONT_BODY}`;
  const blocks = raw.map((lines) =>
    lines.flatMap((line) =>
      line
        ? wrapText(line, methodFont, colW, measure).flatMap((w) =>
            fitLines(w, methodFont, colW, measure),
          )
        : [''],
    ),
  );
  const totalLines = blocks.reduce((n, b2) => n + b2.length, 0);
  const perCol = Math.ceil(totalLines / columns);
  const methodCap = back ? 15 : 5;
  /* Placed one method at a time rather than as two flat columns of text, so
     each block knows where it starts and how tall it is — which is what the
     coloured stripe beside it needs. */
  const placed: { lines: string[]; col: number; row: number; colour: string | null }[] = [];
  {
    const used = Array.from({ length: columns }, () => 0);
    let col = 0;
    blocks.forEach((blk, i) => {
      // Keep a method's own lines together: a label in one column with its
      // address in the next is worse than a slightly uneven split.
      if (col < columns - 1 && used[col] + blk.length > perCol + 1) col++;
      if (used[col] < methodCap) {
        placed.push({
          lines: blk.slice(0, methodCap - used[col]),
          col,
          row: used[col],
          colour: paymentBrand(shown[i].kind),
        });
      }
      used[col] += blk.length;
    });
  }
  const colLines = Array.from({ length: columns }, (_, c) =>
    placed.filter((b2) => b2.col === c).reduce((n, b2) => n + b2.lines.length, 0),
  );
  /* The stripe sits at the column's left edge and the words step in past it,
     so the rail's colour reads as a margin marker rather than as underlining
     the first word. */
  const RULE_W = 5;
  const RULE_STEP = 16;

  const build = (s: number) => {
    const companySize = 30 * s;
    const nameSize = 62 * s;
    const titleSize = 30 * s;
    const taglineSize = 26 * s;
    const detailSize = 26 * s;
    const detailLead = detailSize * 1.5;
    const methodSize = 24 * s;
    const methodLead = methodSize * 1.5;

    const taglineLines = (back || !pay) && text.tagline.trim()
      ? wrapText(text.tagline, `400 ${taglineSize}px ${FONT_BODY}`, textW, measure)
      : [];
    const detailLines = text.details.trim()
      ? wrapText(text.details, `400 ${detailSize}px ${FONT_BODY}`, textW, measure)
      : [];

    // Top block grows down from the padding; contact details hang off the
    // bottom edge, which is where a reader's eye goes for them.
    const detailsH = detailLines.length * detailLead;
    let y = PAD;
    const companyY = text.company.trim() ? y : y - companySize * 1.3;
    if (text.company.trim()) y += companySize * 1.35;
    const nameY = y;
    // An empty name takes no room. The back leaves it out on purpose and
    // sixty-nine points of nothing at the top is how a back ends up looking
    // like a mistake.
    if (text.name.trim()) y += nameSize * 1.12;
    const titleY = y;
    if (hasTitleOut) y += titleSize * 1.5;
    const taglineY = y;
    y += taglineLines.length * taglineSize * 1.4;
    const methodsY = y + (taglineLines.length ? 8 : 0);
    y = methodsY + Math.min(methodCap, Math.max(...colLines, 0)) * methodLead;

    const detailsY = CARD_H - PAD - detailsH;
    return { companySize, nameSize, titleSize, taglineSize, detailSize, detailLead, methodSize, methodLead, taglineLines, detailLines, companyY, nameY, titleY, taglineY, methodsY, detailsY, bottom: y };
  };

  let s = 1;
  let b = build(s);
  while (s > 0.6 && b.bottom > b.detailsY - 12) {
    s -= 0.05;
    b = build(s);
  }

  const run = (over: Partial<CardText> & { lines: string[] }): CardText => ({
    x: left,
    y: 0,
    w: textW,
    align: 'left',
    size: 26,
    lead: 26,
    weight: 400,
    family: FONT_BODY,
    colour: ink,
    ...over,
  });

  return {
    bg: card.bg,
    ink,
    inkSoft,
    accent: card.accent,
    stripe: { x: 0, y: 0, w: STRIPE, h: CARD_H },
    rule: { x: left, y: b.detailsY - 26, w: Math.min(120, textW), h: Math.max(3, 4 * s) },
    logo: hasLogo ? { cx: CARD_W - PAD - logoR, cy: PAD + logoR, r: logoR } : null,
    company: run({
      lines: text.company.trim() ? [text.company.toUpperCase()] : [],
      y: b.companyY,
      size: b.companySize,
      lead: b.companySize * 1.35,
      weight: 900,
      family: FONT,
      /* Accent on the front, ink on the back. The back's company line is
         often the only thing on that face, and an accent chosen to be a
         highlight beside black text is not a colour to read a whole card
         in — on pale paper it disappears. */
      colour: back ? ink : card.accent,
    }),
    name: run({
      lines: text.name.trim() ? [text.name] : [],
      y: b.nameY,
      size: b.nameSize,
      lead: b.nameSize * 1.12,
      weight: 900,
      family: FONT,
      colour: ink,
    }),
    title: run({
      lines: hasTitleOut ? [text.title] : [],
      y: b.titleY,
      size: b.titleSize,
      lead: b.titleSize * 1.5,
      weight: 700,
      family: FONT_BODY,
      colour: inkSoft,
    }),
    tagline: run({
      lines: b.taglineLines,
      y: b.taglineY,
      size: b.taglineSize,
      lead: b.taglineSize * 1.4,
      colour: inkSoft,
    }),
    details: run({
      lines: b.detailLines,
      y: b.detailsY,
      size: b.detailSize,
      lead: b.detailLead,
    }),
    qr,
    methods: placed.map((blk) =>
      run({
        lines: blk.lines,
        x: left + blk.col * (colW + colGap) + RULE_STEP,
        w: colW - RULE_STEP,
        y: b.methodsY + blk.row * b.methodLead,
        size: b.methodSize,
        lead: b.methodLead,
        weight: 700,
      }),
    ),
    methodRules: placed.map((blk) => ({
      x: left + blk.col * (colW + colGap),
      y: b.methodsY + blk.row * b.methodLead,
      /* Down to the last line with words on it: every block ends in a blank
         spacer line, and a stripe running through the gap to the next rail
         would join the two it is there to separate. */
      h:
        Math.max(1, blk.lines.filter((l) => l.trim()).length) * b.methodLead,
      w: RULE_W,
      colour: blk.colour ?? card.accent,
    })),
  };
}

/**
 * The badge back: the mark in the middle, the company under it.
 *
 * Everything is centred on the card's own axis rather than on the text
 * column, so the stripe does not pull the eye off-centre — the stripe is a
 * margin, not part of the composition.
 */
function badgeBack(
  card: BusinessCard,
  measure: CanvasRenderingContext2D | null,
  ink: string,
  inkSoft: string,
): CardLayout {
  const x = STRIPE + PAD;
  const w = CARD_W - PAD - x;
  const hasLogo = card.logoUrl !== null;
  const r = 118;
  const companySize = 46;
  const quoteSize = 27;
  const noteSize = 24;
  const quoteLines = card.quote.trim()
    ? wrapText(card.quote, `400 ${quoteSize}px ${FONT_BODY}`, w, measure)
    : [];
  const noteLines = card.backNote.trim()
    ? wrapText(card.backNote, `400 ${noteSize}px ${FONT_BODY}`, w, measure)
    : [];
  const notesH = noteLines.length * noteSize * 1.5;
  const hasNote = noteLines.length > 0;
  /* Everything is stacked and the stack is centred, rather than pinning the
     note to the bottom edge: a centred composition with one element nailed
     to the floor leaves the rule stranded against whatever is above it. */
  const RULE_GAP = 22;
  const RULE_H = 4;
  const total =
    (hasLogo ? r * 2 + 26 : 0) +
    (card.company.trim() ? companySize * 1.3 : 0) +
    quoteLines.length * quoteSize * 1.4 +
    (hasNote ? RULE_GAP * 2 + RULE_H + notesH : 0);
  let y = Math.max(PAD * 0.5, (CARD_H - total) / 2);
  const cy = y + r;
  if (hasLogo) y += r * 2 + 26;
  const companyY = y;
  if (card.company.trim()) y += companySize * 1.3;
  const quoteY = y;
  y += quoteLines.length * quoteSize * 1.4;
  const ruleY = y + RULE_GAP;
  const notesY = ruleY + RULE_H + RULE_GAP;

  const run = (over: Partial<CardText> & { lines: string[] }): CardText => ({
    x,
    y: 0,
    w,
    align: 'center',
    size: 26,
    lead: 26,
    weight: 400,
    family: FONT_BODY,
    colour: ink,
    ...over,
  });

  return {
    bg: card.bg,
    ink,
    inkSoft,
    accent: card.accent,
    stripe: { x: 0, y: 0, w: STRIPE, h: CARD_H },
    rule: { x: x + (w - 120) / 2, y: ruleY, w: hasNote ? 120 : 0, h: RULE_H },
    logo: hasLogo ? { cx: STRIPE / 2 + CARD_W / 2, cy, r } : null,
    company: run({
      lines: card.company.trim() ? [card.company.toUpperCase()] : [],
      y: companyY,
      size: companySize,
      lead: companySize * 1.3,
      weight: 900,
      family: FONT,
      colour: ink,
    }),
    name: run({ lines: [] }),
    title: run({ lines: [] }),
    tagline: run({
      lines: quoteLines,
      y: quoteY,
      size: quoteSize,
      lead: quoteSize * 1.4,
      colour: inkSoft,
    }),
    details: run({
      lines: noteLines,
      y: notesY,
      size: noteSize,
      lead: noteSize * 1.5,
    }),
    qr: null,
    methods: [],
    methodRules: [],
  };
}

/** The method the QR encodes: the one chosen, or the first that has a value. */
export function qrMethod(card: BusinessCard): PaymentMethod | null {
  const filled = card.payments.filter((m) => paymentFilled(m.values) || m.qrImage);
  return filled.find((m) => m.id === card.qrOf) ?? filled[0] ?? null;
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
    t.lines.forEach((line, i) => {
      const x = t.align === 'center' ? t.x + (t.w - ctx.measureText(line).width) / 2 : t.x;
      ctx.fillText(line, x, t.y + i * t.lead + t.lead / 2);
    });
  };

  run(L.company);
  run(L.name);
  run(L.title);
  run(L.tagline);

  ctx.fillStyle = L.accent;
  ctx.fillRect(L.rule.x, L.rule.y, L.rule.w, L.rule.h);
  run(L.details);
  for (const r of L.methodRules) {
    ctx.fillStyle = r.colour;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  L.methods.forEach(run);

  if (L.qr?.image) {
    // A code the user brought with them: drawn as the picture it is.
    const img = new Image();
    img.src = L.qr.image;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("That QR image couldn't be loaded"));
    });
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(L.qr.x, L.qr.y, L.qr.size, L.qr.size);
    const inset = L.qr.size * 0.06;
    ctx.drawImage(img, L.qr.x + inset, L.qr.y + inset, L.qr.size - inset * 2, L.qr.size - inset * 2);
    if (L.qr.caption) {
      ctx.font = `700 22px ${FONT_BODY}`;
      ctx.fillStyle = L.inkSoft;
      const w = ctx.measureText(L.qr.caption).width;
      ctx.fillText(L.qr.caption, L.qr.x + (L.qr.size - w) / 2, L.qr.y + L.qr.size + 20);
    }
  } else if (L.qr && L.qr.modules.length > 0) {
    /* Drawn module by module rather than as an image: the same matrix the
       preview walks, so the printed code and the one on screen are the same
       code. The quiet zone is part of the spec — without it scanners miss. */
    const n = L.qr.modules.length;
    const quiet = 4;
    const cell = L.qr.size / (n + quiet * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(L.qr.x, L.qr.y, L.qr.size, L.qr.size);
    ctx.fillStyle = '#000000';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!L.qr.modules[r][c]) continue;
        ctx.fillRect(
          L.qr.x + (c + quiet) * cell,
          L.qr.y + (r + quiet) * cell,
          Math.ceil(cell),
          Math.ceil(cell),
        );
      }
    }
    if (L.qr.caption) {
      ctx.font = `700 22px ${FONT_BODY}`;
      ctx.fillStyle = L.inkSoft;
      const w = ctx.measureText(L.qr.caption).width;
      ctx.fillText(L.qr.caption, L.qr.x + (L.qr.size - w) / 2, L.qr.y + L.qr.size + 20);
    }
  }

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
