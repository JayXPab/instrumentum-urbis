// Export: an assembled building -> Axiom blueprint (.bp).
// Pure functions, no DOM, no three.js. Compression and the thumbnail
// picture are done by the caller and passed in.
//
// File layout (from Axiom's open-source server plugin, BlueprintIo.java):
//   int     magic 0x0AE5BB36
//   int     header length, then the header as uncompressed NBT
//   int     thumbnail length, then a PNG picture
//   int     block data length, then the block data as gzipped NBT
// All ints are big-endian.
//
// Blocks are stored like Minecraft's own chunk sections: 16 × 16 × 16 cubes,
// each with a palette and a packed long array. Empty cells are void_air,
// which Axiom treats as "nothing": placing the blueprint leaves them untouched.

import { parseState, fullState } from "./blocks.js";
import { unK } from "./facade.js";
import { assemble } from "./assemble.js";
import { connectPanes, DATA_VERSIONS, schemName } from "./schem.js";
import { nbt, TAG, writeNbt } from "./nbt.js";

export const BP_MAGIC = 0x0ae5bb36;
/** Axiom's blueprint header version. Version 2 uses void_air for empty cells. */
const HEADER_VERSION = 2;
const EMPTY = "minecraft:void_air";

/** Bits per palette entry, as Minecraft writes block sections. */
export const sectionBits = (n) => (n <= 1 ? 0 : Math.max(4, Math.ceil(Math.log2(n))));

/**
 * Packs one 16³ section.
 * @param {string[]} cells 4096 block states, index (y * 16 + z) * 16 + x
 */
export function packSection(cells) {
  /** @type {Map<string, number>} */
  const palette = new Map();
  for (const s of cells) if (!palette.has(s)) palette.set(s, palette.size);

  const paletteTag = nbt.list(TAG.Compound, [...palette.keys()].map((s) => {
    const { id, props } = parseState(s);
    /** @type {Record<string, any>} */
    const e = { Name: nbt.string(id) };
    if (Object.keys(props).length)
      e.Properties = nbt.compound(Object.fromEntries(Object.entries(props).map(([k, v]) => [k, nbt.string(v)])));
    return nbt.compound(e);
  }));

  const bits = sectionBits(palette.size);
  if (!bits) return nbt.compound({ palette: paletteTag });

  // Entries never straddle two longs: each long holds floor(64 / bits) of them.
  const perLong = Math.floor(64 / bits);
  const longs = new Array(Math.ceil(4096 / perLong)).fill(0n);
  cells.forEach((s, i) => {
    const li = Math.floor(i / perLong);
    longs[li] |= BigInt(palette.get(s)) << BigInt((i % perLong) * bits);
  });
  return nbt.compound({ palette: paletteTag, data: nbt.longArray(longs.map((v) => BigInt.asIntN(64, v))) });
}

/**
 * Builds the header and the (uncompressed) block data for the building in p.assembly.
 * @returns {{header: Uint8Array, blocks: Uint8Array, count: number, sections: number}}
 */
export function blueprintParts(p) {
  const dataVersion = DATA_VERSIONS[p.mcVersion];
  if (!dataVersion) throw new Error(`Unsupported Minecraft version ${p.mcVersion}`);
  const states = connectPanes(assemble(p).cells);
  if (!states.size) throw new Error("The building is empty, nothing to export.");

  // Group the blocks by section. ">> 4" rounds toward −∞, so negative x and z work.
  /** @type {Map<string, string[]>} */
  const sections = new Map();
  for (const [k, s] of states) {
    const [x, y, z] = unK(k);
    const key = `${x >> 4},${y >> 4},${z >> 4}`;
    let cells = sections.get(key);
    if (!cells) sections.set(key, (cells = new Array(4096).fill(EMPTY)));
    cells[((y & 15) * 16 + (z & 15)) * 16 + (x & 15)] = fullState(s);
  }

  const regions = [...sections].map(([key, cells]) => {
    const [X, Y, Z] = key.split(",").map(Number);
    return nbt.compound({ X: nbt.int(X), Y: nbt.int(Y), Z: nbt.int(Z), BlockStates: packSection(cells) });
  });

  const header = nbt.compound({
    Version: nbt.int(HEADER_VERSION),
    Name: nbt.string(schemName(p)),
    Author: nbt.string(""),
    Tags: nbt.list(TAG.String, []),
    ThumbnailYaw: nbt.float(135),
    ThumbnailPitch: nbt.float(30),
    // We supply our own picture of the building, so Axiom keeps it.
    LockedThumbnail: nbt.byte(1),
    BlockCount: nbt.int(states.size),
    ContainsAir: nbt.byte(0),
  });
  const blocks = nbt.compound({
    BlockRegion: nbt.list(TAG.Compound, regions),
    BlockEntities: nbt.list(TAG.Compound, []),
    DataVersion: nbt.int(dataVersion),
  });
  return { header: writeNbt(header), blocks: writeNbt(blocks), count: states.size, sections: regions.length };
}

/**
 * Joins the parts into the final .bp file.
 * @param {Uint8Array} header uncompressed header NBT
 * @param {Uint8Array} thumbnail PNG bytes
 * @param {Uint8Array} gzBlocks gzipped block data NBT
 */
export function packBlueprint(header, thumbnail, gzBlocks) {
  const out = new Uint8Array(16 + header.length + thumbnail.length + gzBlocks.length);
  const dv = new DataView(out.buffer);
  let n = 0;
  dv.setInt32(n, BP_MAGIC); n += 4;
  for (const part of [header, thumbnail, gzBlocks]) {
    dv.setInt32(n, part.length); n += 4;
    out.set(part, n); n += part.length;
  }
  return out;
}

/** Splits a .bp file back into its parts (used by tests, and later by import). */
export function unpackBlueprint(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getInt32(0) !== BP_MAGIC) throw new Error("Not an Axiom blueprint");
  let n = 4;
  const next = () => { const len = dv.getInt32(n); n += 4; const b = bytes.subarray(n, n + len); n += len; return b; };
  return { header: next(), thumbnail: next(), gzBlocks: next() };
}
