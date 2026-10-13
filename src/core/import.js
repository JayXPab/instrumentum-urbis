// Import: reads WorldEdit .schem, Litematica .litematic and Axiom .bp files
// into plain blocks, then turns them into facade variants.
// Pure functions, no DOM, no three.js. Decompression is passed in, so the same
// code runs in the browser (DecompressionStream) and in tests (zlib).

import { makeState } from "./blocks.js";
import { K } from "./facade.js";
import { readNbt, readVarints } from "./nbt.js";
import { unpackBlueprint, sectionBits } from "./blueprint.js";
import { unpackTight, litematicBits } from "./litematic.js";

/** Blocks that mean "nothing here". */
const EMPTY = new Set(["minecraft:air", "minecraft:cave_air", "minecraft:void_air", "minecraft:structure_void"]);
const isEmpty = (s) => EMPTY.has(s.split("[")[0]);

/** A palette entry written as {Name, Properties} (Litematica, Axiom) -> "id[k=v,...]". */
const paletteState = (e) => {
  const props = e.value.Properties
    ? Object.fromEntries(Object.entries(e.value.Properties.value).map(([k, v]) => [k, String(v.value)]))
    : {};
  return makeState(e.value.Name.value, props);
};

/**
 * Imported blocks: "x,y,z" -> block state, in the file's own coordinates.
 * @typedef {{format:"schem"|"litematic"|"bp", name:string, blocks:Map<string,string>}} Imported
 */

/**
 * Reads any supported file.
 * @param {string} fileName used to tell .bp from the others
 * @param {Uint8Array} bytes the file as it is on disk
 * @param {(b: Uint8Array) => Promise<Uint8Array>|Uint8Array} gunzip decompresses gzip
 * @returns {Promise<Imported>}
 */
export async function readSchematicFile(fileName, bytes, gunzip) {
  const name = fileName.replace(/\.[^.]+$/, "");
  if (/\.bp$/i.test(fileName)) {
    const { gzBlocks } = unpackBlueprint(bytes);
    return { format: "bp", name, blocks: readBlueprintBlocks(readNbt(await gunzip(gzBlocks)).root) };
  }
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const root = readNbt(isGzip ? await gunzip(bytes) : bytes).root;
  if (root.value.Regions) return { format: "litematic", name, blocks: readLitematicBlocks(root) };
  if (root.value.Schematic || root.value.Palette || root.value.BlockData) return { format: "schem", name, blocks: readSchemBlocks(root) };
  throw new Error("This file isn't a WorldEdit, Litematica or Axiom schematic the editor can read.");
}

/**
 * WorldEdit / Sponge schematic, version 2 (Palette and BlockData at the top)
 * or version 3 (inside "Schematic", under "Blocks"). Positions include the
 * Offset, so an exported building comes back around its paste point.
 */
export function readSchemBlocks(root) {
  const S = root.value.Schematic ? root.value.Schematic.value : root.value;
  const W = S.Width.value, H = S.Height.value, L = S.Length.value;
  const container = S.Blocks ? S.Blocks.value : S; // v3 : v2
  const palette = container.Palette.value;
  const data = (container.Data || container.BlockData).value;
  const [ox, oy, oz] = S.Offset ? S.Offset.value : [0, 0, 0];
  const names = [];
  for (const [state, idx] of Object.entries(palette)) names[idx.value] = state;
  const ids = readVarints(data);
  const out = new Map();
  ids.forEach((id, i) => {
    const s = names[id];
    if (!s || isEmpty(s)) return;
    const y = Math.floor(i / (W * L)), z = Math.floor((i % (W * L)) / W), x = i % W;
    out.set(K(x + ox, y + oy, z + oz), s);
  });
  return out;
}

/**
 * Litematica: every region, each placed at its Position. A negative size
 * means the region runs from Position back toward smaller coordinates.
 */
export function readLitematicBlocks(root) {
  const out = new Map();
  for (const region of Object.values(root.value.Regions.value)) {
    const R = region.value;
    if (!R.BlockStates || !R.BlockStatePalette) continue;
    const pos = ["x", "y", "z"].map((k) => R.Position.value[k].value);
    const size = ["x", "y", "z"].map((k) => R.Size.value[k].value);
    const min = pos.map((p, i) => (size[i] < 0 ? p + size[i] + 1 : p));
    const [W, H, L] = size.map(Math.abs);
    const names = R.BlockStatePalette.value.map(paletteState);
    const ids = unpackTight(R.BlockStates.value, litematicBits(names.length), W * H * L);
    ids.forEach((id, i) => {
      const s = names[id];
      if (!s || isEmpty(s)) return;
      const y = Math.floor(i / (W * L)), z = Math.floor((i % (W * L)) / W), x = i % W;
      out.set(K(x + min[0], y + min[1], z + min[2]), s);
    });
  }
  return out;
}

/** Axiom: 16³ sections, each with its own palette and packed longs. */
export function readBlueprintBlocks(root) {
  const out = new Map();
  for (const r of root.value.BlockRegion?.value || []) {
    const { X, Y, Z, BlockStates } = r.value;
    const names = BlockStates.value.palette.value.map(paletteState);
    const data = BlockStates.value.data?.value;
    const bits = sectionBits(names.length);
    const perLong = bits ? Math.floor(64 / bits) : 0;
    const longs = data ? data.map((v) => BigInt.asUintN(64, v)) : null;
    const mask = (1n << BigInt(bits || 1)) - 1n;
    for (let i = 0; i < 4096; i++) {
      const id = !longs ? 0 : Number((longs[Math.floor(i / perLong)] >> BigInt((i % perLong) * bits)) & mask);
      const s = names[id];
      if (!s || isEmpty(s)) continue;
      out.set(K(X.value * 16 + (i & 15), Y.value * 16 + (i >> 8), Z.value * 16 + ((i >> 4) & 15)), s);
    }
  }
  return out;
}
