// Roofs: turns a roof style's settings into blocks on top of the building.
// Pure functions, no DOM, no three.js.
//
// A sloped roof is a side-on outline (height across the roof, from one eave
// to the other) pushed along the ridge. Two axes:
//   u  across the slope (eave to eave)
//   v  along the ridge
// Ridge "parallel" to the street: u = z (front to back), v = x.
// Ridge facing the "street" (gable end at the front): u = x, v = z.
//
// Heights are worked out to the half block, then each column becomes:
//   half step at the top  -> bottom slab
//   full step, one side higher -> stair, tall half toward the higher side
//   peak or level         -> full block
// with full blocks underneath down to the lower neighbour, so the roof
// has no holes. The triangular ends are filled ("gable" / "party").

import { bounds, uid } from "./facade.js";
import { buildingDepth } from "./assemble.js";
import { MMAP, MATERIALS, makeState } from "./blocks.js";

export const ROOF_TYPES = /** @type {const} */ (["gable", "sloped", "mansard", "convex", "flat", "garden"]);
export const ROOF_NAMES = {
  gable: "Gable", sloped: "Sloped", mansard: "Mansard", convex: "Convex mansard", flat: "Flat", garden: "Garden",
};
/** Types whose shape comes from the outline (the rest are flat). */
export const SLOPED = new Set(["gable", "sloped", "mansard", "convex"]);
/** Edge slider range: negative = inset, positive = overhang. */
export const EDGE_MIN = -3, EDGE_MAX = 2;

/**
 * @typedef {{x:number, y:number, z:number, part:string, facing?:string, p:number}} Piece
 *   y is the level above the top of the building (0 = first roof layer).
 *   part: block | stairs | slab | gable | party | parapet | soil | plant
 *   p: 0 at the eaves .. 1 at the ridge, for the material gradient
 */

/** The roof's footprint: the building from the Core Wall back, side wall to side wall. */
export function footprint(p) {
  const b = bounds(p);
  return { xMin: b.xMin, xMax: b.xMax, zMin: -(buildingDepth(p) - 1), zMax: 0 };
}

/**
 * Height of the outline at a cell, before rounding.
 * @param {string} type
 * @param {number} i cell index across the slope, 0 .. n − 1
 * @param {number} n cells across the slope
 * @param {number} H roof height in blocks
 * @param {boolean} flip sloped roofs: high side at the front (or right) instead of the back (or left)
 */
export function outline(type, i, n, H, flip = false) {
  const dl = i + 0.5, dr = n - i - 0.5; // distance to each eave, from the cell centre
  if (type === "sloped") return (H * (flip ? dl : dr)) / (n - 0.5); // i = 0 is the back (or left)
  const d = Math.min(dl, dr);
  const D = Math.max(0.5, Math.min(Math.ceil(n / 2) - 0.5, n / 2)); // d at the ridge
  if (type === "gable") return (H * d) / D;
  // Mansard: a steep lower slope to 3/4 of the height, then a shallow top.
  const a = Math.max(0.5, D * 0.35), low = H * 0.75;
  if (d <= a) {
    const t = d / a;
    // Convex mansard: the lower slope bulges outward (a quarter circle).
    return type === "convex" ? low * Math.sqrt(1 - (1 - t) * (1 - t)) : low * t;
  }
  return D > a ? low + ((H - low) * (d - a)) / (D - a) : H;
}

/** Rounds to the half block, never below a slab. */
const half = (h) => Math.max(0.5, Math.round(h * 2) / 2);

/**
 * The shape of a roof style on project p, as pieces relative to the top of the building.
 * @returns {Piece[]}
 */
export function roofShape(p, style) {
  const f = footprint(p);
  if (style.type === "flat" || style.type === "garden") return flatShape(f, style);
  if (!SLOPED.has(style.type)) return [];

  const street = style.ridge === "street";
  // u: across the slope; v: along the ridge.
  const [uMin, uMax, vMin, vMax] = street ? [f.xMin, f.xMax, f.zMin, f.zMax] : [f.zMin, f.zMax, f.xMin, f.xMax];
  const e = Math.max(EDGE_MIN, Math.min(EDGE_MAX, Math.round(style.edge || 0)));
  const u0 = uMin - e, n = uMax - uMin + 1 + 2 * e;
  if (n < 1) return [];
  const H = Math.max(1, style.height || 1);

  const q = Array.from({ length: n }, (_, i) => half(outline(style.type, i, n, H, !!style.flip)));
  const top = Math.max(...q.map((t) => Math.ceil(t) - 1)) || 1;
  // Stair facing toward +u / −u in Minecraft directions.
  const [up, down] = street ? ["east", "west"] : ["south", "north"];
  const at = (u, v, y, part, extra = {}) => {
    const [x, z] = street ? [u, v] : [v, u];
    return { x, y, z, part, p: Math.min(1, y / top), ...extra };
  };

  /** @type {Piece[]} */
  const out = [];
  /** Lowest roof level in each column, for filling the gable ends. */
  const base = new Array(n);
  for (let i = 0; i < n; i++) {
    const left = i > 0 ? q[i - 1] : 0, right = i < n - 1 ? q[i + 1] : 0;
    const k = Math.ceil(q[i]) - 1; // level of the top piece
    const from = Math.min(k, Math.floor(Math.min(left, right)));
    base[i] = from;
    const u = u0 + i;
    for (let v = vMin; v <= vMax; v++) {
      for (let y = from; y < k; y++) out.push(at(u, v, y, "block"));
      let piece = "block", facing;
      if (q[i] - k === 0.5) piece = "slab";
      else if (Math.max(left, right) >= q[i] && Math.min(left, right) < q[i]) {
        piece = "stairs";
        facing = right >= left ? up : down;
      }
      out.push(at(u, v, k, piece, facing ? { facing } : {}));
    }
  }

  // Gable ends: fill under the roof within the walls (not under an overhang).
  // Ends on party walls take party-wall blocks; a street-facing front end takes the gable block.
  for (const [v, front] of [[vMin, false], [vMax, street]]) {
    for (let u = Math.max(uMin, u0); u <= Math.min(uMax, u0 + n - 1); u++)
      for (let y = 0; y < base[u - u0]; y++) out.push(at(u, v, y, front ? "gable" : "party"));
  }
  return out;
}

/** Flat and garden roofs: one layer over the footprint, with a wall round the edge. */
function flatShape(f, style) {
  /** @type {Piece[]} */
  const out = [];
  const garden = style.type === "garden";
  const walled = garden || !!style.parapet;
  for (let x = f.xMin; x <= f.xMax; x++)
    for (let z = f.zMin; z <= f.zMax; z++) {
      const edge = x === f.xMin || x === f.xMax || z === f.zMin || z === f.zMax;
      if (walled && edge) {
        out.push({ x, y: 0, z, part: garden ? "parapet" : "block", p: 0 });
        out.push({ x, y: 1, z, part: "parapet", p: 0 });
      } else {
        out.push({ x, y: 0, z, part: garden ? "soil" : "block", p: 0 });
        if (garden) out.push({ x, y: 1, z, part: "plant", p: 0 });
      }
    }
  return out;
}

/* ---------- materials ---------- */

/**
 * A roof style with every setting filled in.
 * bands: eaves (first) to ridge (last); each band is a weighted mix of materials.
 * blend: how far bands mix into each other, 0 (sharp line) .. 1 (one band wide).
 */
export const roofDefaults = (o = {}) => ({
  id: uid(),
  name: "Roof",
  type: "gable",
  ridge: "parallel",
  height: 4,
  edge: 0,
  flip: false,
  bands: [{ mix: [{ material: "deepslate_tiles", weight: 1 }] }],
  blend: 0.6,
  gableBlock: null, // null = the project's Core Wall block
  parapet: false,
  parapetBlock: "minecraft:stone_bricks",
  density: 0.4,
  ...o,
});

/** Picks one entry from [{..., weight}] by weight. */
function weighted(list, rnd) {
  const tot = list.reduce((s, e) => s + Math.max(0, e.weight), 0);
  if (tot <= 0) return list[0];
  let r = rnd() * tot;
  for (const e of list) {
    r -= Math.max(0, e.weight);
    if (r < 0) return e;
  }
  return list[list.length - 1];
}

/**
 * Which material a piece gets: its band by height (with a soft, random
 * edge between bands), then a weighted pick within the band.
 * @param {number} pos 0 at the eaves .. 1 at the ridge
 */
export function pickMaterial(style, pos, rnd) {
  const bands = (style.bands || []).filter((b) => b.mix && b.mix.some((m) => MMAP[m.material] && m.weight > 0));
  if (!bands.length) return MATERIALS[0];
  const t = pos * bands.length + (rnd() - 0.5) * (style.blend ?? 0.6);
  const band = bands[Math.max(0, Math.min(bands.length - 1, Math.floor(t)))];
  return MMAP[weighted(band.mix.filter((m) => MMAP[m.material]), rnd).material];
}

/** What grows on a garden roof, by weight. Tall grass takes two blocks. */
export const PLANTS = [
  ["short_grass", 50], ["tall_grass", 8],
  ["poppy", 5], ["dandelion", 5], ["cornflower", 4], ["oxeye_daisy", 4], ["allium", 3],
  ["azure_bluet", 4], ["red_tulip", 3], ["white_tulip", 3], ["lily_of_the_valley", 3],
  ["azalea", 4], ["flowering_azalea", 3],
].map(([id, weight]) => ({ id: "minecraft:" + id, weight }));

/**
 * The roof's blocks, placed on top of a building whose top is at y0.
 * @param {any} p project
 * @param {any} style roof style
 * @param {number} y0 height of the building (the roof starts here)
 * @param {() => number} rnd seeded random numbers
 * @param {(() => string|null)} [party] picks a party-wall block, or null if there are none
 * @returns {Array<{x:number, y:number, z:number, s:string}>}
 */
export function roofBlocks(p, style, y0, rnd, party = () => null) {
  const st = roofDefaults(style);
  const gable = st.gableBlock || p.coreBlock;
  const out = [];
  for (const c of roofShape(p, st)) {
    let s = null;
    switch (c.part) {
      case "block": s = pickMaterial(st, c.p, rnd).block; break;
      case "slab": s = makeState(pickMaterial(st, c.p, rnd).slab, { type: "bottom" }); break;
      case "stairs": s = makeState(pickMaterial(st, c.p, rnd).stairs, { facing: c.facing, half: "bottom" }); break;
      case "gable": s = gable; break;
      case "party": s = party() || gable; break;
      case "parapet": s = st.parapetBlock; break;
      case "soil": s = "minecraft:grass_block"; break;
      case "plant": {
        if (rnd() >= st.density) break;
        const plant = weighted(PLANTS, rnd).id;
        if (plant === "minecraft:tall_grass") {
          out.push({ x: c.x, y: y0 + c.y + 1, z: c.z, s: plant + "[half=upper]" });
          s = plant + "[half=lower]";
        } else s = plant;
        break;
      }
    }
    if (s) out.push({ x: c.x, y: y0 + c.y, z: c.z, s });
  }
  return out;
}
