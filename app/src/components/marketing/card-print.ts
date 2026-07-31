import { CARD_H, CARD_W } from '@/components/marketing/business-card';
import { buildPdf, canvasImage, type PdfImage, type PdfLine, type PdfPage } from '@/lib/pdf';

/* Getting the card off the screen and onto paper.
 *
 * Two jobs, and they want different pages. A proof is one card — or a card
 * and its back, side by side — on a page trimmed to fit it, which is what
 * you send to someone to look at. A print sheet is as many as will fit on
 * US Letter, fronts on page one and backs on page two lined up so that a
 * duplex printer puts each back behind its own front. Get that alignment
 * wrong and you have fifty cards with somebody else's back on them. */

/** 3.5 × 2in in PDF points. The card's pixels are the same card at 300dpi. */
export const CARD_PT_W = 252;
export const CARD_PT_H = 144;

const LETTER_W = 612;
const LETTER_H = 792;
/** The unprintable strip most desktop printers keep for themselves. */
const SHEET_MARGIN = 18;
/** Gap between the two faces on a proof page. */
const PROOF_GAP = 18;

/** Which way the paper turns over between the two passes. */
export type FlipEdge = 'long' | 'short';

export interface SheetGrid {
  cols: number;
  rows: number;
  /** left/bottom of the block of cards, centred on the page */
  x0: number;
  y0: number;
}

/**
 * How many cards fit, and where the block sits.
 *
 * The cards butt against each other with no gutter: one cut with a guillotine
 * then serves two cards, and a gutter would only cost a row.
 */
export function sheetGrid(): SheetGrid {
  const cols = Math.floor((LETTER_W - SHEET_MARGIN * 2) / CARD_PT_W);
  const rows = Math.floor((LETTER_H - SHEET_MARGIN * 2) / CARD_PT_H);
  return {
    cols,
    rows,
    x0: (LETTER_W - cols * CARD_PT_W) / 2,
    y0: (LETTER_H - rows * CARD_PT_H) / 2,
  };
}

/** Cards on one sheet. */
export const perSheet = (): number => {
  const g = sheetGrid();
  return g.cols * g.rows;
};

/** Ticks in the margins, on every line a blade would follow. */
function cropMarks(g: SheetGrid): PdfLine[] {
  const marks: PdfLine[] = [];
  const top = g.y0 + g.rows * CARD_PT_H;
  const right = g.x0 + g.cols * CARD_PT_W;
  for (let c = 0; c <= g.cols; c++) {
    const x = g.x0 + c * CARD_PT_W;
    marks.push({ x1: x, y1: top + 5, x2: x, y2: top + 15 });
    marks.push({ x1: x, y1: g.y0 - 5, x2: x, y2: g.y0 - 15 });
  }
  for (let r = 0; r <= g.rows; r++) {
    const y = g.y0 + r * CARD_PT_H;
    marks.push({ x1: g.x0 - 5, y1: y, x2: g.x0 - 15, y2: y });
    marks.push({ x1: right + 5, y1: y, x2: right + 15, y2: y });
  }
  return marks;
}

/**
 * A page of one image repeated across the grid.
 *
 * `mirror` is what makes duplex work. Turning a portrait sheet over on its
 * long edge reverses left and right, so the back page has to be laid out
 * right-to-left for the backs to land on the fronts; turning it on the short
 * edge reverses top and bottom instead.
 */
function tiled(image: PdfImage, g: SheetGrid, mirror: FlipEdge | null): PdfPage {
  const items = [];
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const col = mirror === 'long' ? g.cols - 1 - c : c;
      const row = mirror === 'short' ? g.rows - 1 - r : r;
      items.push({
        image,
        x: g.x0 + col * CARD_PT_W,
        y: g.y0 + (g.rows - 1 - row) * CARD_PT_H,
        w: CARD_PT_W,
        h: CARD_PT_H,
      });
    }
  }
  return { width: LETTER_W, height: LETTER_H, items, lines: cropMarks(g) };
}

/**
 * One card as a PDF: the front, or the front and the back side by side.
 *
 * The page is trimmed to the card rather than being a sheet of paper with a
 * card in the corner — it opens at the size of the thing it shows.
 */
export async function cardProofPdf(
  front: HTMLCanvasElement,
  back: HTMLCanvasElement | null,
): Promise<Blob> {
  const faces = back ? [front, back] : [front];
  const images = await Promise.all(faces.map(canvasImage));
  const width = SHEET_MARGIN * 2 + CARD_PT_W * faces.length + PROOF_GAP * (faces.length - 1);
  return buildPdf([
    {
      width,
      height: SHEET_MARGIN * 2 + CARD_PT_H,
      items: images.map((image, i) => ({
        image,
        x: SHEET_MARGIN + i * (CARD_PT_W + PROOF_GAP),
        y: SHEET_MARGIN,
        w: CARD_PT_W,
        h: CARD_PT_H,
      })),
    },
  ]);
}

/**
 * A sheet to print and cut up: every card the page will hold.
 *
 * Two pages when the card has a back — print double-sided, and set the
 * printer to the same flip edge chosen here.
 */
export async function cardSheetPdf(
  front: HTMLCanvasElement,
  back: HTMLCanvasElement | null,
  flip: FlipEdge,
): Promise<Blob> {
  const g = sheetGrid();
  const frontImage = await canvasImage(front);
  const pages = [tiled(frontImage, g, null)];
  if (back) pages.push(tiled(await canvasImage(back), g, flip));
  return buildPdf(pages);
}

/**
 * The two faces as one picture, side by side.
 *
 * A gap rather than butting them together: two cards of the same colour with
 * no seam read as one very wide card.
 */
export function sideBySideCanvas(
  front: HTMLCanvasElement,
  back: HTMLCanvasElement | null,
): HTMLCanvasElement {
  if (!back) return front;
  const gap = 30;
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W * 2 + gap;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser has no canvas to draw on');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(front, 0, 0);
  ctx.drawImage(back, CARD_W + gap, 0);
  return canvas;
}
