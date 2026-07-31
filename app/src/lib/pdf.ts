/* A PDF, written by hand.
 *
 * The same reasoning as src/lib/zip.ts: the file format we need is a small
 * corner of a large spec — pages, and pictures placed on them — and a
 * library that draws text, embeds fonts and parses SVG would be two hundred
 * kilobytes to do what forty lines of it can. The cards are already drawn
 * onto a canvas at print resolution by the same code that draws the preview;
 * all a PDF has to do here is say where on the paper each of those pixels
 * goes, at what size, in points.
 *
 * PDF's coordinate origin is the BOTTOM-left of the page and its unit is
 * 1/72 inch. Every y in this file is measured from the bottom, which is the
 * one thing worth remembering when reading the callers.
 */

/** A picture, already compressed, ready to be an XObject. */
export interface PdfImage {
  bytes: Uint8Array;
  pxW: number;
  pxH: number;
  /** how `bytes` is encoded: a JPEG stream, or raw RGB run through zlib */
  filter: 'DCTDecode' | 'FlateDecode';
}

/** Where a picture goes on a page, in points from the bottom-left. */
export interface PdfPlacement {
  image: PdfImage;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A hairline, for crop marks. */
export interface PdfLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PdfPage {
  width: number;
  height: number;
  items: PdfPlacement[];
  lines?: PdfLine[];
}

/** Bytes of a `data:` URL, whatever it holds. */
export function dataUrlBytes(url: string): Uint8Array {
  const binary = atob(url.slice(url.indexOf(',') + 1));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * A canvas as a picture a PDF can hold.
 *
 * Lossless where the browser will do it: the card is flat colour and hard
 * edges, exactly what JPEG is worst at and what deflate is best at, and a
 * printed card with ringing around every letter is not worth the smaller
 * file. `CompressionStream` produces a zlib stream, which is what PDF's
 * FlateDecode reads. Where it is missing, JPEG at 95 is the fallback.
 */
export async function canvasImage(canvas: HTMLCanvasElement): Promise<PdfImage> {
  const ctx = canvas.getContext('2d');
  if (ctx && typeof CompressionStream !== 'undefined') {
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // PDF wants RGB triples; the canvas hands back RGBA, and the card is
    // opaque, so the alpha byte is simply dropped.
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; i < data.length; i += 4) {
      rgb[j++] = data[i];
      rgb[j++] = data[i + 1];
      rgb[j++] = data[i + 2];
    }
    const stream = new Blob([rgb]).stream().pipeThrough(new CompressionStream('deflate'));
    const packed = new Uint8Array(await new Response(stream).arrayBuffer());
    return { bytes: packed, pxW: width, pxH: height, filter: 'FlateDecode' };
  }
  const jpeg = dataUrlBytes(canvas.toDataURL('image/jpeg', 0.95));
  return { bytes: jpeg, pxW: canvas.width, pxH: canvas.height, filter: 'DCTDecode' };
}

/** Points, trimmed — PDF does not want "252.00000000000003". */
const pt = (n: number): string => (Math.round(n * 100) / 100).toString();

function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/**
 * Assemble the pages into a PDF.
 *
 * Objects are numbered up front — catalog, page tree, one per distinct
 * image, then a page and a content stream for each page — because the
 * cross-reference table at the end needs every object's byte offset and the
 * page dictionaries need the image numbers before either is written.
 */
export function buildPdf(pages: PdfPage[]): Blob {
  const images: PdfImage[] = [];
  for (const page of pages) {
    for (const item of page.items) if (!images.includes(item.image)) images.push(item.image);
  }

  const chunks: Uint8Array[] = [];
  let at = 0;
  const push = (part: Uint8Array | string) => {
    const bytes = typeof part === 'string' ? latin1(part) : part;
    chunks.push(bytes);
    at += bytes.length;
  };
  const offsets: number[] = [];
  const obj = (n: number, dict: string, stream?: Uint8Array) => {
    offsets[n] = at;
    push(`${n} 0 obj\n${dict}\n`);
    if (stream) {
      push('stream\n');
      push(stream);
      push('\nendstream\n');
    }
    push('endobj\n');
  };

  const imageNo = (img: PdfImage) => 3 + images.indexOf(img);
  const pageNo = (i: number) => 3 + images.length + i * 2;
  const contentNo = (i: number) => pageNo(i) + 1;
  const count = 2 + images.length + pages.length * 2;

  push('%PDF-1.4\n');
  // A comment of high bytes is the convention that tells anything moving the
  // file that it is binary and must not be line-ending-mangled.
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(
    2,
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageNo(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );

  for (const img of images) {
    obj(
      imageNo(img),
      `<< /Type /XObject /Subtype /Image /Width ${img.pxW} /Height ${img.pxH}` +
        ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${img.filter}` +
        ` /Length ${img.bytes.length} >>`,
      img.bytes,
    );
  }

  pages.forEach((page, i) => {
    const used = images.filter((img) => page.items.some((it) => it.image === img));
    const body: string[] = [];
    for (const it of page.items) {
      // "w 0 0 h x y cm" scales the unit square the image is drawn into up to
      // the size it should print at, and moves it into place.
      body.push(
        `q ${pt(it.w)} 0 0 ${pt(it.h)} ${pt(it.x)} ${pt(it.y)} cm /Im${imageNo(it.image)} Do Q`,
      );
    }
    if (page.lines?.length) {
      body.push('0.4 w 0.55 G');
      for (const l of page.lines) {
        body.push(`${pt(l.x1)} ${pt(l.y1)} m ${pt(l.x2)} ${pt(l.y2)} l S`);
      }
    }
    const content = latin1(body.join('\n'));
    obj(
      pageNo(i),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pt(page.width)} ${pt(page.height)}]` +
        ` /Resources << /XObject << ${used.map((img) => `/Im${imageNo(img)} ${imageNo(img)} 0 R`).join(' ')} >> >>` +
        ` /Contents ${contentNo(i)} 0 R >>`,
    );
    obj(contentNo(i), `<< /Length ${content.length} >>`, content);
  });

  const xref = at;
  push(`xref\n0 ${count + 1}\n`);
  push('0000000000 65535 f \n');
  for (let n = 1; n <= count; n++) {
    push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}

/** Hand a built file to the browser as a download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Revoked on the next turn of the loop: Safari has not started the
  // download by the time click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
