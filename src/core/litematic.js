// Export: an assembled building -> Litematica schematic (.litematic).
// Pure functions, no DOM, no three.js. Returns uncompressed NBT bytes;
// the caller gzips them before saving.
//
// Layout (Litematica's LitematicaSchematic, version 7; field names as written
// by Litematica and Litemapy):
//   MinecraftDataVersion, Version 7, SubVersion 1
//   Metadata   Name, Author, Description, RegionCount, TotalVolume, TotalBlocks,
//              TimeCreated, TimeModified, EnclosingSize {x,y,z}, PreviewImageData (optional)
//   Regions    one region: Position {x,y,z}, Size {x,y,z}, BlockStatePalette,
//              BlockStates (packed longs), TileEntities, Entities,
//              PendingBlockTicks, PendingFluidTicks
// Blocks run x fastest, then z, then y. Palette entry 0 is air. Each entry
// uses max(2, ceil(log2(palette size))) bits, packed tightly: unlike Minecraft
// chunks, an entry may run on from one long into the next.
//
// The region's Position is its lowest corner relative to the schematic's
// origin, which is the paste point (0, 0, 0) as for .schem and .bp.

import { parseState, fullState } from "./blocks.js";
import { unK } from "./facade.js";
import { assemble, buildingTitle } from "./assemble.js";
import { connectPanes, DATA_VERSIONS } from "./schem.js";
import { nbt, TAG, writeNbt } from "./nbt.js";

export const LITEMATIC_VERSION = 7;
export const LITEMATIC_SUBVERSION = 1;

/** Bits per palette entry, as Litematica uses: at least 2. */
export const litematicBits = (n) => Math.max(2, Math.ceil(Math.log2(Math.max(1, n))));

/**
 * Packs small numbers tightly into 64-bit longs, letting one run on into the next.
 * @param {number[]} values
 * @param {number} bits
 * @returns {bigint[]} signed 64-bit values, as NBT long arrays hold them
 */
export function packTight(values, bits) {
  const longs = new Array(Math.ceil((values.length * bits) / 64)).fill(0n);
  const B = BigInt(bits);
  values.forEach((v, i) => {
    const start = i * bits, li = start >> 6, off = start & 63;
    longs[li] |= BigInt(v) << BigInt(off);
    if (off + bits > 64) longs[li + 1] |= BigInt(v) >> BigInt(64 - off); // the rest of it
  });
  // Bits shifted past the top of a long belong to the next one (handled above): drop them here.
  return longs.map((l) => BigInt.asIntN(64, l));
}

/** Inverse of packTight (used by tests, and later by import). */
export function unpackTight(longs, bits, count) {
  const u = longs.map((l) => BigInt.asUintN(64, l));
  const mask = (1n << BigInt(bits)) - 1n;
  return Array.from({ length: count }, (_, i) => {
    const start = i * bits, li = start >> 6, off = start & 63;
    let v = u[li] >> BigInt(off);
    if (off + bits > 64) v |= u[li + 1] << BigInt(64 - off);
    return Number(v & mask);
  });
}

const xyz = (x, y, z) => nbt.compound({ x: nbt.int(x), y: nbt.int(y), z: nbt.int(z) });

/**
 * Builds the Litematica schematic for the building in p.assembly.
 * @param {any} p project
 * @param {number[]} [preview] optional square preview picture, one ARGB int per pixel
 * @returns {{bytes: Uint8Array, size: [number, number, number], offset: [number, number, number], blocks: number}}
 */
export function toLitematic(p, preview) {
  const dataVersion = DATA_VERSIONS[p.mcVersion];
  if (!dataVersion) throw new Error(`Unsupported Minecraft version ${p.mcVersion}`);
  const states = connectPanes(assemble(p).cells);
  if (!states.size) throw new Error("The building is empty, nothing to export.");

  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const k of states.keys()) {
    const [x, y, z] = unK(k);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); z0 = Math.min(z0, z);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y); z1 = Math.max(z1, z);
  }
  const W = x1 - x0 + 1, H = y1 - y0 + 1, L = z1 - z0 + 1;

  /** @type {Map<string, number>} */
  const palette = new Map([["minecraft:air", 0]]);
  const ids = new Array(W * H * L).fill(0);
  for (const [k, s] of states) {
    const [x, y, z] = unK(k);
    const full = fullState(s);
    if (!palette.has(full)) palette.set(full, palette.size);
    ids[(y - y0) * W * L + (z - z0) * W + (x - x0)] = palette.get(full);
  }

  const paletteTag = nbt.list(TAG.Compound, [...palette.keys()].map((s) => {
    const { id, props } = parseState(s);
    /** @type {Record<string, any>} */
    const e = { Name: nbt.string(id) };
    if (Object.keys(props).length)
      e.Properties = nbt.compound(Object.fromEntries(Object.entries(props).map(([k, v]) => [k, nbt.string(v)])));
    return nbt.compound(e);
  }));

  const now = Date.now();
  const title = buildingTitle(p);
  /** @type {Record<string, any>} */
  const meta = {
    Name: nbt.string(title),
    Author: nbt.string(""),
    Description: nbt.string("Made with Instrumentum Urbis"),
    RegionCount: nbt.int(1),
    TotalVolume: nbt.int(W * H * L),
    TotalBlocks: nbt.int(states.size),
    TimeCreated: nbt.long(now),
    TimeModified: nbt.long(now),
    EnclosingSize: xyz(W, H, L),
  };
  if (preview && preview.length) meta.PreviewImageData = nbt.intArray(preview);

  const root = nbt.compound({
    MinecraftDataVersion: nbt.int(dataVersion),
    Version: nbt.int(LITEMATIC_VERSION),
    SubVersion: nbt.int(LITEMATIC_SUBVERSION),
    Metadata: nbt.compound(meta),
    Regions: nbt.compound({
      [title]: nbt.compound({
        Position: xyz(x0, y0, z0),
        Size: xyz(W, H, L),
        BlockStatePalette: paletteTag,
        BlockStates: nbt.longArray(packTight(ids, litematicBits(palette.size))),
        TileEntities: nbt.list(TAG.Compound, []),
        Entities: nbt.list(TAG.Compound, []),
        PendingBlockTicks: nbt.list(TAG.Compound, []),
        PendingFluidTicks: nbt.list(TAG.Compound, []),
      }),
    }),
  });
  return { bytes: writeNbt(root), size: [W, H, L], offset: [x0, y0, z0], blocks: states.size };
}
