// A minimal .zip writer: files are stored as they are, without compression.
// .schem and .bp files are already gzipped, so compressing again gains little.
// Pure functions, no DOM, no three.js.
//
// Format: PKWARE APPNOTE.TXT (local headers, central directory, end record).
// All numbers are little-endian. No ZIP64, so at most 65 535 files and 4 GB.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 checksum, as zip (and gzip) use. */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Date and time in the old MS-DOS format zip uses (2-second steps, local time). */
function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

const utf8 = new TextEncoder();
const MAX_FILES = 0xffff;
const MAX_BYTES = 0xffffffff;

export class ZipWriter {
  /** @param {Date} [date] modification date stamped on every file */
  constructor(date = new Date()) {
    this.dt = dosDateTime(date);
    /** @type {Uint8Array[]} */
    this.parts = [];
    /** @type {Uint8Array[]} */
    this.central = [];
    this.offset = 0;
    this.count = 0;
    this.names = new Set();
  }

  /** Adds a file. @param {string} name path inside the zip, "/" between folders @param {Uint8Array|string} data */
  add(name, data) {
    if (typeof data === "string") data = utf8.encode(data);
    if (this.names.has(name)) throw new Error(`The zip already has a file called ${name}`);
    if (this.count >= MAX_FILES) throw new Error(`A zip can hold at most ${MAX_FILES.toLocaleString()} files`);
    const nm = utf8.encode(name);
    const crc = crc32(data);
    const size = data.length;

    const local = new Uint8Array(30 + nm.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed: 2.0
    lv.setUint16(6, 0x0800, true); // names are UTF-8
    lv.setUint16(8, 0, true); // stored, no compression
    lv.setUint16(10, this.dt.time, true);
    lv.setUint16(12, this.dt.date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nm.length, true);
    lv.setUint16(28, 0, true);
    local.set(nm, 30);

    const cen = new Uint8Array(46 + nm.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // made by
    cv.setUint16(6, 20, true); // needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, this.dt.time, true);
    cv.setUint16(14, this.dt.date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nm.length, true);
    // extra length, comment length, disk, internal and external attributes stay 0
    cv.setUint32(42, this.offset, true);
    cen.set(nm, 46);

    const next = this.offset + local.length + size;
    if (next > MAX_BYTES) throw new Error("The zip would be larger than 4 GB");
    this.parts.push(local, data);
    this.central.push(cen);
    this.offset = next;
    this.count++;
    this.names.add(name);
  }

  /**
   * Finishes the zip. Returns the pieces in order; join them (or pass them
   * to a Blob) to get the file.
   * @returns {Uint8Array[]}
   */
  finish() {
    const cdSize = this.central.reduce((s, c) => s + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, this.count, true);
    ev.setUint16(10, this.count, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, this.offset, true);
    return [...this.parts, ...this.central, end];
  }

  /** Bytes written so far (files and their headers). */
  get size() { return this.offset; }
}

/** Joins byte pieces into one array. */
export function concat(parts) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let n = 0;
  for (const p of parts) { out.set(p, n); n += p.length; }
  return out;
}

/**
 * Reads a stored (uncompressed) zip back into name -> bytes, checking every
 * checksum. Used by tests.
 * @returns {Map<string, Uint8Array>}
 */
export function readStoredZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const e = bytes.length - 22;
  if (dv.getUint32(e, true) !== 0x06054b50) throw new Error("No end record");
  const count = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const out = new Map();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Bad central directory entry");
    const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nl));
    if (dv.getUint32(off, true) !== 0x04034b50) throw new Error("Bad local header for " + name);
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    const data = bytes.slice(start, start + size);
    if (crc32(data) !== crc) throw new Error("Checksum mismatch for " + name);
    out.set(name, data);
    p += 46 + nl;
  }
  return out;
}
