import qrcode from 'qrcode-generator';

/* ------------------------------------------------------------------ */
/* QR codes for a payment card.                                         */
/* ------------------------------------------------------------------ */

/**
 * A QR code as a grid of true/false.
 *
 * Returned as a matrix rather than as an image because the card is drawn
 * twice — once as HTML for the preview and once onto a canvas for the print
 * file — and both have to agree exactly. One matrix, two renderers, no
 * chance of the downloaded card carrying a different code from the one on
 * screen.
 *
 * Error correction is M: a card gets handled, and a code that stops scanning
 * after a thumbprint is worse than one a few modules larger.
 */
export function qrMatrix(text: string): boolean[][] | null {
  const value = text.trim();
  if (!value) return null;
  try {
    // 0 = pick the smallest version the text fits in.
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    return Array.from({ length: n }, (_, r) =>
      Array.from({ length: n }, (_, c) => qr.isDark(r, c)),
    );
  } catch {
    // Too much text for even the largest version — no code rather than a
    // broken one.
    return null;
  }
}

/** The payment rails a card can carry, and how each one becomes a link. */
export const PAYMENT_KINDS = [
  { id: 'bitcoin', label: 'Bitcoin', hint: 'bc1… or 1… address', uri: (v: string) => `bitcoin:${v}` },
  { id: 'ethereum', label: 'Ethereum', hint: '0x… address', uri: (v: string) => `ethereum:${v}` },
  { id: 'litecoin', label: 'Litecoin', hint: 'L… or ltc1… address', uri: (v: string) => `litecoin:${v}` },
  { id: 'paypal', label: 'PayPal', hint: 'paypal.me/you, or your email', uri: link },
  { id: 'cashapp', label: 'Cash App', hint: '$cashtag', uri: (v: string) => `https://cash.app/${v.replace(/^\$?/, '$')}` },
  { id: 'revolut', label: 'Revolut', hint: 'revolut.me/you', uri: link },
  { id: 'link', label: 'Payment link', hint: 'any checkout or invoice URL', uri: link },
  { id: 'bank', label: 'Bank transfer', hint: 'IBAN or account details', uri: (v: string) => v },
] as const;

export type PaymentKindId = (typeof PAYMENT_KINDS)[number]['id'];

/** Anything that looks like a bare domain gets the scheme it is missing. */
function link(value: string): string {
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w.-]+@[\w.-]+\.\w+$/.test(v)) return `https://paypal.me/${v}`;
  return `https://${v.replace(/^\/+/, '')}`;
}

/** What a scanner should get when it reads this method's code. */
export function paymentUri(kind: string, value: string): string {
  const spec = PAYMENT_KINDS.find((k) => k.id === kind);
  const v = value.trim();
  if (!v) return '';
  return spec ? spec.uri(v) : v;
}

export function paymentLabel(kind: string): string {
  return PAYMENT_KINDS.find((k) => k.id === kind)?.label ?? kind;
}
