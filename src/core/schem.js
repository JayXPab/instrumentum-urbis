// Export: an assembled building -> Sponge Schematic v3 (WorldEdit .schem).
// Pure functions, no DOM, no three.js. Returns uncompressed NBT bytes;
// the caller gzips them before saving.
//
// Format: https://github.com/SpongePowered/Schematic-Specification (version 3)
// Our axes already match Minecraft's: +x east, +y up, +z south (the street).
// The paste point (where the player stands for //paste) is x = 0, y = 0, z = 0:
// the bottom of the centre column of the Core Wall.

import { BMAP, parseState, makeState } from "./blocks.js";
import { K, unK } from "./facade.js";
import { assemble, chosenDepth } from "./assemble.js";
import { cornerOf } from "./corner.js";
import { nbt, TAG, writeNbt, varints } from "./nbt.js";

/** Minecraft "data version" for each supported game version. */
export const DATA_VERSIONS = { "1.21.11": 4671 };

const SIDES = /** @type {const} */ ([["north", 0, -1], ["south", 0, 1], ["east", 1, 0], ["west", -1, 0]]);

/**
 * Glass panes store which sides they connect to. The editor saves bare panes,
 * so we work the connections out here: a pane joins a neighbouring pane or
 * full block, as it would in game.
 * @param {Map<string, {s:string}>} cells
 */
export function connectPanes(cells) {
  const joins = (k) => {
    const c = cells.get(k);
    const d = c && BMAP[parseState(c.s).id];
    return !!d && (d.shape === "pane" || d.shape === "cube");
  };
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const [k, c] of cells) {
    const { id, props } = parseState(c.s);
    if (BMAP[id]?.shape !== "pane") { out.set(k, c.s); continue; }
    const [x, y, z] = unK(k);
    for (const [side, dx, dz] of SIDES) props[side] = String(joins(K(x + dx, y, z + dz)));
    out.set(k, makeState(id, props));
  }
  return out;
}

/**
 * Builds the schematic for the building chosen in p.assembly.
 * @param {any} p project
 * @returns {{bytes: Uint8Array, size: [number, number, number], offset: [number, number, number], blocks: number}}
 */
export function toSchem(p) {
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

  // Palette: block state -> small number. Air is 0 and fills the gaps.
  /** @type {Map<string, number>} */
  const palette = new Map([["minecraft:air", 0]]);
  const ids = new Array(W * H * L).fill(0);
  for (const [k, s] of states) {
    const [x, y, z] = unK(k);
    if (!palette.has(s)) palette.set(s, palette.size);
    // The spec's block order: x fastest, then z, then y.
    ids[(x - x0) + (z - z0) * W + (y - y0) * W * L] = palette.get(s);
  }

  const paletteTag = {};
  for (const [s, i] of palette) paletteTag[s] = nbt.int(i);

  const root = nbt.compound({
    Schematic: nbt.compound({
      Version: nbt.int(3),
      DataVersion: nbt.int(dataVersion),
      Metadata: nbt.compound({
        Name: nbt.string(schemName(p)),
        Date: nbt.long(Date.now()),
        Generator: nbt.string("Instrumentum Urbis"),
      }),
      Width: nbt.short(W),
      Height: nbt.short(H),
      Length: nbt.short(L),
      // Where the lowest corner sits relative to the paste point.
      Offset: nbt.intArray([x0, y0, z0]),
      Blocks: nbt.compound({
        Palette: nbt.compound(paletteTag),
        Data: nbt.byteArray(varints(ids)),
        BlockEntities: nbt.list(TAG.Compound, []),
      }),
    }),
  });
  return { bytes: writeNbt(root), size: [W, H, L], offset: [x0, y0, z0], blocks: states.size };
}

/**
 * File name (without extension) for the building in p.assembly, e.g. "facade_b1-b2-c1-r2_5fl_12d".
 * The -rN part appears only with roof styles, the _Nd part only when the depth range has more
 * than one value. Corner buildings end in _c or _c-ch.
 */
export function schemName(p) {
  const a = p.assembly;
  const floors = Math.max(p.floorMin, Math.min(p.floorMax, a.floors));
  const roof = p.roofs?.length ? `-r${Math.min(a.roof ?? 0, p.roofs.length - 1) + 1}` : "";
  const corner = cornerOf(p);
  const deep = p.depthMax > p.depthMin ? `_${chosenDepth(p)}d` : "";
  const type = corner ? (corner.chamfer ? "_c-ch" : "_c") : "";
  return `facade_b${a.base + 1}-b${a.body + 1}-c${a.capital + 1}${roof}_${floors}fl${deep}${type}`;
}
