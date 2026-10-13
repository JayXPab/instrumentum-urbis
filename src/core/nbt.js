// NBT: Minecraft's binary data format, used inside .schem files.
// Pure functions, no DOM, no three.js. The output is uncompressed;
// .schem files are gzipped afterwards.
//
// Values are wrapped with a tag type so the writer knows how to encode them:
//   nbt.compound({ Width: nbt.short(7), Name: nbt.string("Facade") })
// Everything is big-endian, as Minecraft Java expects.

export const TAG = /** @type {const} */ ({
  End: 0, Byte: 1, Short: 2, Int: 3, Long: 4, Float: 5, Double: 6,
  ByteArray: 7, String: 8, List: 9, Compound: 10, IntArray: 11, LongArray: 12,
});

/** @typedef {{type:number, value:any, itemType?:number}} Tag */

export const nbt = {
  byte: (v) => ({ type: TAG.Byte, value: v }),
  short: (v) => ({ type: TAG.Short, value: v }),
  int: (v) => ({ type: TAG.Int, value: v }),
  long: (v) => ({ type: TAG.Long, value: BigInt(v) }),
  float: (v) => ({ type: TAG.Float, value: v }),
  double: (v) => ({ type: TAG.Double, value: v }),
  string: (v) => ({ type: TAG.String, value: v }),
  byteArray: (v) => ({ type: TAG.ByteArray, value: Uint8Array.from(v) }),
  intArray: (v) => ({ type: TAG.IntArray, value: Array.from(v) }),
  longArray: (v) => ({ type: TAG.LongArray, value: Array.from(v, BigInt) }),
  /** @param {number} itemType one of TAG @param {Tag[]} items */
  list: (itemType, items) => ({ type: TAG.List, itemType: items.length ? itemType : TAG.End, value: items }),
  /** @param {Record<string, Tag>} entries */
  compound: (entries) => ({ type: TAG.Compound, value: entries }),
};

const utf8 = new TextEncoder();
const utf8d = new TextDecoder();

/** Growable byte buffer with big-endian writers. */
class Out {
  constructor() { this.buf = new Uint8Array(1024); this.dv = new DataView(this.buf.buffer); this.n = 0; }
  need(k) {
    if (this.n + k <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.n + k) size *= 2;
    const b = new Uint8Array(size);
    b.set(this.buf.subarray(0, this.n));
    this.buf = b;
    this.dv = new DataView(b.buffer);
  }
  i8(v) { this.need(1); this.dv.setInt8(this.n, v); this.n += 1; }
  i16(v) { this.need(2); this.dv.setInt16(this.n, v); this.n += 2; }
  u16(v) { this.need(2); this.dv.setUint16(this.n, v); this.n += 2; }
  i32(v) { this.need(4); this.dv.setInt32(this.n, v); this.n += 4; }
  i64(v) { this.need(8); this.dv.setBigInt64(this.n, v); this.n += 8; }
  f32(v) { this.need(4); this.dv.setFloat32(this.n, v); this.n += 4; }
  f64(v) { this.need(8); this.dv.setFloat64(this.n, v); this.n += 8; }
  bytes(b) { this.need(b.length); this.buf.set(b, this.n); this.n += b.length; }
  str(s) { const b = utf8.encode(s); this.u16(b.length); this.bytes(b); }
}

function writePayload(o, t) {
  switch (t.type) {
    case TAG.Byte: return o.i8(t.value);
    case TAG.Short: return o.i16(t.value);
    case TAG.Int: return o.i32(t.value);
    case TAG.Long: return o.i64(t.value);
    case TAG.Float: return o.f32(t.value);
    case TAG.Double: return o.f64(t.value);
    case TAG.ByteArray: o.i32(t.value.length); return o.bytes(t.value);
    case TAG.String: return o.str(t.value);
    case TAG.List:
      o.i8(t.itemType);
      o.i32(t.value.length);
      for (const item of t.value) {
        if (item.type !== t.itemType) throw new Error("NBT list items must all be the same type");
        writePayload(o, item);
      }
      return;
    case TAG.Compound:
      for (const [name, child] of Object.entries(t.value)) {
        o.i8(child.type);
        o.str(name);
        writePayload(o, child);
      }
      return o.i8(TAG.End);
    case TAG.IntArray: o.i32(t.value.length); for (const v of t.value) o.i32(v); return;
    case TAG.LongArray: o.i32(t.value.length); for (const v of t.value) o.i64(v); return;
    default: throw new Error("Unknown NBT tag type " + t.type);
  }
}

/**
 * Encodes a root compound as uncompressed NBT bytes.
 * @param {Tag} root a compound tag
 * @param {string} [name] name of the root tag (usually empty)
 */
export function writeNbt(root, name = "") {
  if (root.type !== TAG.Compound) throw new Error("NBT root must be a compound");
  const o = new Out();
  o.i8(TAG.Compound);
  o.str(name);
  writePayload(o, root);
  return o.buf.slice(0, o.n);
}

/**
 * Decodes uncompressed NBT bytes back into tags (used by tests, and later by import).
 * @param {Uint8Array} bytes
 * @returns {{name:string, root:Tag}}
 */
export function readNbt(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let n = 0;
  const str = () => { const len = dv.getUint16(n); n += 2; const s = utf8d.decode(bytes.subarray(n, n + len)); n += len; return s; };
  const payload = (type) => {
    let v, len;
    switch (type) {
      case TAG.Byte: v = dv.getInt8(n); n += 1; return nbt.byte(v);
      case TAG.Short: v = dv.getInt16(n); n += 2; return nbt.short(v);
      case TAG.Int: v = dv.getInt32(n); n += 4; return nbt.int(v);
      case TAG.Long: v = dv.getBigInt64(n); n += 8; return nbt.long(v);
      case TAG.Float: v = dv.getFloat32(n); n += 4; return nbt.float(v);
      case TAG.Double: v = dv.getFloat64(n); n += 8; return nbt.double(v);
      case TAG.ByteArray: len = dv.getInt32(n); n += 4; v = bytes.slice(n, n + len); n += len; return nbt.byteArray(v);
      case TAG.String: return nbt.string(str());
      case TAG.List: {
        const it = dv.getInt8(n); n += 1;
        len = dv.getInt32(n); n += 4;
        const items = [];
        for (let i = 0; i < len; i++) items.push(payload(it));
        return { type: TAG.List, itemType: it, value: items };
      }
      case TAG.Compound: {
        const e = {};
        for (;;) {
          const t = dv.getInt8(n); n += 1;
          if (t === TAG.End) return nbt.compound(e);
          const name = str();
          e[name] = payload(t);
        }
      }
      case TAG.IntArray: len = dv.getInt32(n); n += 4; v = []; for (let i = 0; i < len; i++, n += 4) v.push(dv.getInt32(n)); return nbt.intArray(v);
      case TAG.LongArray: len = dv.getInt32(n); n += 4; v = []; for (let i = 0; i < len; i++, n += 8) v.push(dv.getBigInt64(n)); return { type: TAG.LongArray, value: v };
      default: throw new Error("Unknown NBT tag type " + type + " at byte " + (n - 1));
    }
  };
  const t = dv.getInt8(n); n += 1;
  if (t !== TAG.Compound) throw new Error("NBT root must be a compound");
  const name = str();
  return { name, root: payload(TAG.Compound) };
}

/** Encodes non-negative integers as varints (7 bits per byte), as .schem block data uses. */
export function varints(values) {
  const out = [];
  for (let v of values) {
    while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
    out.push(v);
  }
  return Uint8Array.from(out);
}

/** Inverse of varints. */
export function readVarints(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; ) {
    let v = 0, shift = 0, b;
    do { b = bytes[i++]; v |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    out.push(v);
  }
  return out;
}
