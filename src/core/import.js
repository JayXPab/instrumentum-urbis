// Import: reads WorldEdit .schem, Litematica .litematic and Axiom .bp files
// into plain blocks, then turns them into facade variants.
// Pure functions, no DOM, no three.js. Decompression is passed in, so the same
// code runs in the browser (DecompressionStream) and in tests (zlib).

import { makeState, rotateState } from "./blocks.js";
import { K, unK, bounds, uid, STAGE_NAMES } from "./facade.js";
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

/* ---------- turning blocks into facade variants ---------- */
// Settings, in the import's own coordinates after turning:
//   turns        quarter turns anticlockwise (seen from above) so the street side faces +z
//   core         the z layer that is the Core Wall
//   left, right  the facade's edge columns (inclusive); their middle becomes x = 0
//   bottom, top  the lowest and highest rows to use
//   mode         "facade": split into base, body and capital
//                  baseH, bodyH, capH: rows in each (base from the bottom,
//                  body just above it, capital at the top)
//                "stage": one variant of `stage`, rows bottom..top

/** Turns blocks by quarter turns anticlockwise around the origin, states included. */
export function turnBlocks(blocks, turns) {
  const t = ((turns % 4) + 4) % 4;
  if (!t) return new Map(blocks);
  const out = new Map();
  for (const [k, s] of blocks) {
    let [x, y, z] = unK(k);
    for (let i = 0; i < t; i++) [x, z] = [z, -x]; // north (0,−1) -> west (−1,0)
    out.set(K(x, y, z), rotateState(s, t));
  }
  return out;
}

/** The smallest box around the blocks. */
export function extent(blocks) {
  const e = { xMin: Infinity, xMax: -Infinity, yMin: Infinity, yMax: -Infinity, zMin: Infinity, zMax: -Infinity };
  for (const k of blocks.keys()) {
    const [x, y, z] = unK(k);
    e.xMin = Math.min(e.xMin, x); e.xMax = Math.max(e.xMax, x);
    e.yMin = Math.min(e.yMin, y); e.yMax = Math.max(e.yMax, y);
    e.zMin = Math.min(e.zMin, z); e.zMax = Math.max(e.zMax, z);
  }
  return e;
}

/**
 * First guesses for the settings: the Core Wall is the z layer with the most
 * blocks, the edges and rows are everything imported, and a whole facade is
 * split using the project's floor heights where they fit.
 */
export function guessSettings(blocks, p, turns = 0) {
  const turned = turnBlocks(blocks, turns);
  const e = extent(turned);
  const perZ = new Map();
  for (const k of turned.keys()) { const z = unK(k)[2]; perZ.set(z, (perZ.get(z) || 0) + 1); }
  const core = [...perZ].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
  const H = e.yMax - e.yMin + 1;
  const fit = (want, room) => Math.max(1, Math.min(want, room));
  const baseH = fit(p.heights.base, H - 2), capH = fit(p.heights.capital, H - baseH - 1), bodyH = fit(p.heights.body, H - baseH - capH);
  return {
    turns, core, left: e.xMin, right: e.xMax, bottom: e.yMin, top: e.yMax,
    mode: H >= 3 ? "facade" : "stage", baseH, bodyH, capH, stage: "body",
  };
}

/** The rows each new variant takes: [{kind, y0, y1}]. */
export function importRows(s) {
  if (s.mode === "stage") return [{ kind: s.stage, y0: s.bottom, y1: s.top }];
  const b0 = s.bottom, b1 = b0 + s.baseH - 1;
  return [
    { kind: "base", y0: b0, y1: b1 },
    { kind: "body", y0: b1 + 1, y1: b1 + s.bodyH },
    { kind: "capital", y0: s.top - s.capH + 1, y1: s.top },
  ];
}

/**
 * Works out what an import would do, without changing the project.
 * @returns {{variants: {kind:string, name:string, height:number, blocks:Record<string,string>}[],
 *   depthFront:number, depthBack:number, messages:Array<["ok"|"warn"|"err", string]>,
 *   heightChanges:{kind:string, from:number, to:number}[]}}
 */
export function planImport(imported, s, p) {
  const blocks = turnBlocks(imported.blocks, s.turns);
  const b = bounds(p), W = p.width, limit = b.xMax; // depth rule: never deeper than half the width
  /** @type {Array<["ok"|"warn"|"err", string]>} */
  const messages = [];
  const rows = importRows(s);

  if (s.right < s.left) messages.push(["err", "The right edge is left of the left edge."]);
  if (s.top < s.bottom) messages.push(["err", "The top row is below the bottom row."]);
  if (s.mode === "facade" && rows[1].y1 >= rows[2].y0) messages.push(["err", "The body overlaps the capital: lower the base or body, or the capital's rows."]);
  for (const r of rows) if (r.y1 < r.y0) messages.push(["err", `${STAGE_NAMES[r.kind]} has no rows.`]);

  // Columns: the marked middle becomes the middle of the project's width.
  const w = s.right - s.left + 1;
  const shift = b.xMin - s.left + Math.floor((W - w) / 2);
  if (w > W) messages.push(["warn", `The facade is ${w} wide; the project is ${W}. ${w - W} column${w - W === 1 ? "" : "s"} trimmed (split between both sides).`]);
  if (w < W) messages.push(["warn", `The facade is ${w} wide; the project is ${W}. ${W - w} column${W - w === 1 ? "" : "s"} padded with the Core Wall block.`]);

  let front = 0, back = 0, cut = 0;
  const variants = rows.map((r) => {
    const out = {};
    for (const [k, st] of blocks) {
      const [x, y, z] = unK(k);
      if (x < s.left || x > s.right || y < r.y0 || y > r.y1) continue;
      const X = x + shift, Y = y - r.y0, Z = z - s.core;
      if (X < b.xMin || X > b.xMax) continue; // trimmed
      if (Z > limit || -Z > limit) { cut++; continue; }
      front = Math.max(front, Z);
      back = Math.max(back, -Z);
      out[K(X, Y, Z)] = st;
    }
    // Columns the import doesn't reach are filled with the Core Wall block.
    const h = r.y1 - r.y0 + 1;
    for (let X = b.xMin; X <= b.xMax; X++) {
      if (X - shift >= s.left && X - shift <= s.right) continue;
      for (let Y = 0; Y < h; Y++) out[K(X, Y, 0)] ??= p.coreBlock;
    }
    return { kind: r.kind, name: imported.name + (s.mode === "facade" ? " " + STAGE_NAMES[r.kind].toLowerCase() : ""), height: h, blocks: out };
  });
  if (cut) messages.push(["warn", `${cut} block${cut === 1 ? "" : "s"} deeper than the depth rule allows (${limit} at width ${W}) ${cut === 1 ? "was" : "were"} cut.`]);
  const depthFront = Math.max(p.depthFront, front), depthBack = Math.max(p.depthBack, back);
  if (depthFront > p.depthFront) messages.push(["ok", `Front depth will go from ${p.depthFront} to ${depthFront}.`]);
  if (depthBack > p.depthBack) messages.push(["ok", `Back depth will go from ${p.depthBack} to ${depthBack}.`]);

  // Stages that already have variants keep their height unless you choose otherwise.
  const heightChanges = variants
    .filter((v) => p.stages[v.kind].length && v.height !== p.heights[v.kind])
    .map((v) => ({ kind: v.kind, from: p.heights[v.kind], to: v.height }));
  for (const v of variants)
    if (!p.stages[v.kind].length && v.height !== p.heights[v.kind])
      messages.push(["ok", `${STAGE_NAMES[v.kind]} height will be ${v.height} (it has no variants yet).`]);
  if (!messages.some((m) => m[0] === "err"))
    messages.unshift(["ok", `Ready: ${variants.map((v) => `${STAGE_NAMES[v.kind]} “${v.name}” (${v.height} high)`).join(", ")}.`]);
  return { variants, depthFront, depthBack, messages, heightChanges };
}

/**
 * Adds the planned variants to the project.
 * @param {"stage"|"crop"} heights where a stage already has variants of another height:
 *   "stage" changes the stage height (other variants are trimmed, or get Core Wall rows on top);
 *   "crop" trims the new variant, or adds Core Wall rows on top of it.
 * @returns {string[]} the new variants' ids
 */
export function applyImport(p, plan, heights = "crop") {
  if (plan.messages.some((m) => m[0] === "err")) throw new Error("Fix the problems listed before importing.");
  p.depthFront = plan.depthFront;
  p.depthBack = plan.depthBack;
  const b = bounds(p);
  /** Trims a variant's blocks to h rows, or fills the Core Wall from row `from` up to h. */
  const fitRows = (blocks, from, h) => {
    for (const k of Object.keys(blocks)) if (unK(k)[1] >= h) delete blocks[k];
    for (let y = from; y < h; y++) for (let x = b.xMin; x <= b.xMax; x++) blocks[K(x, y, 0)] ??= p.coreBlock;
  };
  const ids = [];
  for (const v of plan.variants) {
    const blocks = { ...v.blocks };
    if (!p.stages[v.kind].length) p.heights[v.kind] = v.height;
    else if (v.height !== p.heights[v.kind]) {
      if (heights === "stage") {
        for (const other of p.stages[v.kind]) fitRows(other.blocks, p.heights[v.kind], v.height);
        p.heights[v.kind] = v.height;
      } else fitRows(blocks, v.height, p.heights[v.kind]);
    }
    const id = uid();
    p.stages[v.kind].push({ id, name: v.name, blocks });
    ids.push(id);
  }
  return ids;
}
