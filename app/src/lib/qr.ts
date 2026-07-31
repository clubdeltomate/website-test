import qrcode from 'qrcode-generator';

/* ------------------------------------------------------------------ */
/* Payment rails, and the QR codes that point at them.                  */
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

/**
 * One field on a payment method.
 *
 * Rails are not all "an address". A Venezuelan Pago Móvil needs a name, a
 * cédula, a phone and the bank; a Colombian bank transfer needs the account
 * holder and the number; Zinli needs an email. Printing all of that into one
 * box and hoping is how a card ends up unusable, so each rail declares the
 * fields it actually has.
 */
export interface FieldSpec {
  key: string;
  label: string;
  hint?: string;
  /** shown on the card face; the rest are in the panel and the popup */
  onCard?: boolean;
}

export interface PaymentKind {
  id: string;
  label: string;
  /** grouping for the picker */
  group: 'crypto' | 'wallet' | 'bank';
  fields: FieldSpec[];
  /** what a scanner should get, if this rail can be scanned at all */
  uri?: (v: Record<string, string>) => string;
  note?: string;
}

/** Anything that looks like a bare domain gets the scheme it is missing. */
function link(v: string): string {
  const s = v.trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w.-]+@[\w.-]+\.\w+$/.test(s)) return `mailto:${s}`;
  return `https://${s.replace(/^\/+/, '')}`;
}

const ADDRESS: FieldSpec = { key: 'address', label: 'Address', hint: 'the wallet address', onCard: true };
const HOLDER: FieldSpec = { key: 'holder', label: 'Account holder', onCard: true };
const ID_DOC: FieldSpec = { key: 'idNumber', label: 'ID number', hint: 'cédula, DNI, tax id', onCard: true };

/**
 * The rails a card can carry.
 *
 * Ordered by how they are usually reached for, not alphabetically: crypto
 * first because that is what the QR is for, then the wallets, then the banks.
 */
export const PAYMENT_KINDS: PaymentKind[] = [
  {
    id: 'binance',
    label: 'Binance',
    group: 'crypto',
    fields: [
      { key: 'coin', label: 'Coin', hint: 'BTC, USDT, BNB…', onCard: true },
      { key: 'network', label: 'Network', hint: 'BTC, TRC20, BEP20…', onCard: true },
      ADDRESS,
      { key: 'payId', label: 'Binance Pay ID', hint: 'optional — the numeric ID' },
    ],
    // A Binance deposit address IS a plain chain address, so a wallet-style
    // URI is what a phone can act on. Binance's own in-app QR is a link only
    // Binance can mint, which is why the editor also takes an uploaded code.
    uri: (v) => (v.address ? cryptoUri(v.coin, v.address) : ''),
    note: 'Deposit address from Binance → Depositar activo. Paste it, or upload the QR they show you.',
  },
  {
    id: 'bitcoin',
    label: 'Bitcoin',
    group: 'crypto',
    fields: [ADDRESS],
    uri: (v) => (v.address ? `bitcoin:${v.address.trim()}` : ''),
  },
  {
    id: 'ethereum',
    label: 'Ethereum / USDT (ERC20)',
    group: 'crypto',
    fields: [ADDRESS],
    uri: (v) => (v.address ? `ethereum:${v.address.trim()}` : ''),
  },
  {
    id: 'usdt-trc20',
    label: 'USDT (TRC20)',
    group: 'crypto',
    fields: [ADDRESS],
    uri: (v) => (v.address ? `tron:${v.address.trim()}` : ''),
  },
  {
    id: 'paypal',
    label: 'PayPal',
    group: 'wallet',
    fields: [{ key: 'handle', label: 'PayPal', hint: 'paypal.me/you, or your email', onCard: true }],
    uri: (v) => {
      const s = (v.handle ?? '').trim();
      if (!s) return '';
      if (/^[\w.-]+@[\w.-]+\.\w+$/.test(s)) return `https://paypal.me/${s.split('@')[0]}`;
      return link(s);
    },
  },
  {
    id: 'zinli',
    label: 'Zinli',
    group: 'wallet',
    fields: [
      { key: 'email', label: 'Correo electrónico', onCard: true },
      { key: 'holder', label: 'Nombre', onCard: true },
    ],
  },
  {
    id: 'pagomovil',
    label: 'Pago Móvil',
    group: 'bank',
    fields: [
      { key: 'holder', label: 'Nombre completo del receptor', onCard: true },
      { key: 'idNumber', label: 'Número de cédula', onCard: true },
      { key: 'phone', label: 'Teléfono', onCard: true },
      { key: 'bank', label: 'Banco', onCard: true },
    ],
  },
  {
    id: 'bank-ve',
    label: 'Cuenta bancaria (Venezuela)',
    group: 'bank',
    fields: [
      { key: 'bank', label: 'Banco', hint: 'Mercantil, Banesco…', onCard: true },
      HOLDER,
      ID_DOC,
      { key: 'account', label: 'Número de cuenta', onCard: true },
    ],
  },
  {
    id: 'bank',
    label: 'Bank transfer',
    group: 'bank',
    fields: [
      { key: 'bank', label: 'Bank', hint: 'Bancolombia, Chase…', onCard: true },
      HOLDER,
      { key: 'account', label: 'Account number', onCard: true },
    ],
  },
  {
    id: 'cashapp',
    label: 'Cash App',
    group: 'wallet',
    fields: [{ key: 'handle', label: 'Cashtag', hint: '$you', onCard: true }],
    uri: (v) => (v.handle ? `https://cash.app/${v.handle.trim().replace(/^\$?/, '$')}` : ''),
  },
  {
    id: 'link',
    label: 'Payment link',
    group: 'wallet',
    fields: [{ key: 'url', label: 'Link', hint: 'any checkout or invoice URL', onCard: true }],
    uri: (v) => link(v.url ?? ''),
  },
];

/** A coin's wallet URI scheme, for the chains that have one. */
function cryptoUri(coin: string, address: string): string {
  const c = (coin || '').trim().toUpperCase();
  const a = address.trim();
  if (c === 'BTC' || c === 'BITCOIN') return `bitcoin:${a}`;
  if (c === 'ETH' || c === 'ETHEREUM') return `ethereum:${a}`;
  if (c === 'LTC') return `litecoin:${a}`;
  // Everything else — USDT, BNB, a chain nobody agreed a scheme for — is the
  // bare address, which every exchange app accepts from a scan.
  return a;
}

export function kindSpec(kind: string): PaymentKind | undefined {
  return PAYMENT_KINDS.find((k) => k.id === kind);
}

export function paymentLabel(kind: string): string {
  return kindSpec(kind)?.label ?? kind;
}

/** What a scanner should get for this method, or "" when it cannot be scanned. */
export function paymentUri(kind: string, values: Record<string, string>): string {
  const spec = kindSpec(kind);
  return spec?.uri ? spec.uri(values ?? {}) : '';
}

/** The lines this method puts on the card face. */
export function paymentLines(kind: string, values: Record<string, string>): string[] {
  const spec = kindSpec(kind);
  if (!spec || !values) return [];
  return spec.fields
    .filter((f) => f.onCard && (values[f.key] ?? '').trim())
    .map((f) => `${f.label}: ${values[f.key].trim()}`);
}

/**
 * Whether this method has anything in it at all.
 *
 * Tolerant of a method saved before rails had named fields — a card in the
 * database is older than the code reading it, always.
 */
export function paymentFilled(values: Record<string, string> | undefined | null): boolean {
  if (!values) return false;
  return Object.values(values).some((v) => (v ?? '').trim());
}
