/* ------------------------------------------------------------------ */
/* A minimal ZIP writer.                                                */
/* ------------------------------------------------------------------ */

/**
 * Store-only (method 0, no compression) ZIP, built in the browser.
 *
 * No dependency, on purpose: everything we put in one of these is a PNG, and
 * a PNG is already deflated — running it through deflate again would cost a
 * library and some CPU to save roughly nothing. Store-only is a few dozen
 * lines: a local header per file, a central directory, and an end record.
 *
 * Every reader (Finder, Explorer, unzip, 7-Zip) opens these. Timestamps are
 * fixed rather than read from the clock so the same input always produces the
 * same bytes, which keeps the tests honest.
 */

/** CRC-32, the checksum the format requires, with a lazily built table. */
let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

/** A fixed MS-DOS date/time: 2020-01-01 00:00. */
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

class Writer {
  private parts: Uint8Array[] = [];
  length = 0;

  push(bytes: Uint8Array) {
    this.parts.push(bytes);
    this.length += bytes.length;
  }

  /** Little-endian fixed-width fields, which is all the format uses. */
  u16(n: number) {
    this.push(new Uint8Array([n & 0xff, (n >>> 8) & 0xff]));
  }

  u32(n: number) {
    this.push(new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]));
  }

  done(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

/** Build a ZIP archive holding the given files. */
export function makeZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const w = new Writer();
  const central: { name: Uint8Array; crc: number; size: number; offset: number }[] = [];

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.bytes);
    const offset = w.length;

    w.u32(0x04034b50); // local file header
    w.u16(20); // version needed
    w.u16(0); // flags
    w.u16(0); // method 0 — stored
    w.u16(DOS_TIME);
    w.u16(DOS_DATE);
    w.u32(crc);
    w.u32(entry.bytes.length); // compressed size == uncompressed
    w.u32(entry.bytes.length);
    w.u16(name.length);
    w.u16(0); // extra field length
    w.push(name);
    w.push(entry.bytes);

    central.push({ name, crc, size: entry.bytes.length, offset });
  }

  const dirStart = w.length;
  for (const c of central) {
    w.u32(0x02014b50); // central directory header
    w.u16(20); // version made by
    w.u16(20); // version needed
    w.u16(0);
    w.u16(0);
    w.u16(DOS_TIME);
    w.u16(DOS_DATE);
    w.u32(c.crc);
    w.u32(c.size);
    w.u32(c.size);
    w.u16(c.name.length);
    w.u16(0); // extra
    w.u16(0); // comment
    w.u16(0); // disk number
    w.u16(0); // internal attributes
    w.u32(0); // external attributes
    w.u32(c.offset);
    w.push(c.name);
  }
  const dirSize = w.length - dirStart;

  w.u32(0x06054b50); // end of central directory
  w.u16(0); // this disk
  w.u16(0); // disk with the directory
  w.u16(central.length);
  w.u16(central.length);
  w.u32(dirSize);
  w.u32(dirStart);
  w.u16(0); // comment length

  return w.done();
}

/** The bytes behind a canvas, ready to go into an archive. */
export async function canvasBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error("That slide couldn't be turned into a PNG");
  return new Uint8Array(await blob.arrayBuffer());
}
