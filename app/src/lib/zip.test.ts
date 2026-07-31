import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeZip } from "./zip";

const bytes = (s: string) => new TextEncoder().encode(s);
const u32 = (b: Uint8Array, at: number) =>
  b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24);
const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);

describe("makeZip", () => {
  it("writes the signatures a reader looks for", () => {
    const zip = makeZip([{ name: "a.txt", bytes: bytes("hello") }]);
    expect(u32(zip, 0)).toBe(0x04034b50); // local file header
    // end-of-central-directory is the last 22 bytes when there is no comment
    expect(u32(zip, zip.length - 22)).toBe(0x06054b50);
  });

  it("records one central directory entry per file, and points at it", () => {
    const zip = makeZip([
      { name: "one.png", bytes: bytes("first") },
      { name: "two.png", bytes: bytes("second") },
      { name: "three.png", bytes: bytes("third") },
    ]);
    const end = zip.length - 22;
    expect(u16(zip, end + 8)).toBe(3); // entries on this disk
    expect(u16(zip, end + 10)).toBe(3); // entries total
    const dirStart = u32(zip, end + 16);
    expect(u32(zip, dirStart)).toBe(0x02014b50); // the directory really is there
    expect(u32(zip, end + 12)).toBe(end - dirStart); // and the size matches
  });

  it("stores the payload uncompressed, so the bytes are findable verbatim", () => {
    const zip = makeZip([{ name: "a.txt", bytes: bytes("sketchlearn") }]);
    expect(u16(zip, 8)).toBe(0); // method 0 = stored
    expect(new TextDecoder().decode(zip)).toContain("sketchlearn");
  });

  it("is byte-for-byte stable, so nothing depends on the clock", () => {
    const once = makeZip([{ name: "a.txt", bytes: bytes("x") }]);
    const twice = makeZip([{ name: "a.txt", bytes: bytes("x") }]);
    expect(Array.from(once)).toEqual(Array.from(twice));
  });

  it("makes a valid empty archive", () => {
    const zip = makeZip([]);
    expect(zip.length).toBe(22);
    expect(u32(zip, 0)).toBe(0x06054b50);
  });

  it("survives non-ASCII names and binary payloads", () => {
    const payload = new Uint8Array([0, 255, 13, 10, 26, 137]);
    const zip = makeZip([{ name: "café–01.png", bytes: payload }]);
    expect(u32(zip, 0)).toBe(0x04034b50);
    // the UTF-8 name is longer than its character count; the header must agree
    expect(u16(zip, 26)).toBe(new TextEncoder().encode("café–01.png").length);
  });

  it("produces an archive the system unzip accepts and can extract", () => {
    // The point of hand-rolling the format is that real readers open it, so
    // check against one instead of only against our own parsing.
    const dir = mkdtempSync(join(tmpdir(), "zip-"));
    const file = join(dir, "t.zip");
    writeFileSync(
      file,
      makeZip([
        { name: "one.txt", bytes: bytes("first file") },
        { name: "two.txt", bytes: bytes("second file") },
      ]),
    );
    expect(execFileSync("unzip", ["-t", file]).toString()).toContain("No errors detected");
    execFileSync("unzip", ["-o", "-q", file, "-d", dir]);
    expect(readFileSync(join(dir, "one.txt"), "utf8")).toBe("first file");
    expect(readFileSync(join(dir, "two.txt"), "utf8")).toBe("second file");
  });
});
