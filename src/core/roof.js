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

import { uid } from "./facade.js";
import { plot, chosenDepth } from "./assemble.js";
import { MMAP, MATERIALS, makeState } from "./blocks.js";
import { cornerOf, outsideChamfer, stairFromQuarters, halfOf } from "./corner.js";

export const ROOF_TYPES = /** @type {const} */ (["gable", "sloped", "mansard", "convex", "flat", "garden"]);
export const ROOF_NAMES = {
  gable: "Gable", sloped: "Sloped", mansard: "Mansard", convex: "Convex mansard", flat: "Flat", garden: "Garden",
};
/** Types whose shape comes from the outline (the rest are flat). */
export const SLOPED = new Set(["gable", "sloped", "mansard", "convex"]);
/** Edge slider range: negative = inset, positive = overhang. */
export const EDGE_MIN = -3, EDGE_MAX = 2;

/**
 * @typedef {{x:number, y:number, z:number, part:string, facing?:string, shape?:string, p:number}} Piece
 *   y is the level above the top of the building (0 = first roof layer).
 *   part: block | stairs | slab | gable | party | parapet | soil | plant
 *   p: 0 at the eaves .. 1 at the ridge, for the material gradient
 */

/** The roof's footprint: the building's plot, from the Core Wall back, side wall to side wall. */
export const footprint = (p) => plot(p);

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
  const corner = cornerOf(p);
  if (corner) return cornerRoofShape(p, style, corner);
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
function flatShape(f, style, skip = () => false) {
  const cells = new Set();
  for (let x = f.xMin; x <= f.xMax; x++)
    for (let z = f.zMin; z <= f.zMax; z++) if (!skip(x, z)) cells.add(x + "," + z);
  return flatCells(cells, style);
}

/** A flat or garden roof over any set of cells ("x,z"); edge cells have a missing neighbour. */
function flatCells(cells, style) {
  /** @type {Piece[]} */
  const out = [];
  const garden = style.type === "garden";
  const walled = garden || !!style.parapet;
  const has = (x, z) => cells.has(x + "," + z);
  for (const key of cells) {
    const [x, z] = key.split(",").map(Number);
    const edge = !has(x + 1, z) || !has(x - 1, z) || !has(x, z + 1) || !has(x, z - 1);
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
      case "stairs": {
        const props = { facing: c.facing, half: "bottom" };
        if (c.shape && c.shape !== "straight") props.shape = c.shape;
        s = makeState(pickMaterial(st, c.p, rnd).stairs, props);
        break;
      }
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

/* ---------- corner roofs ---------- */
// A corner roof joins the mid-row roofs on both streets. It is L-shaped: one
// wing carries on the roof of the buildings along the front street (an
// outline across z), the other the roof along the side street (across x).
// Both wings use the mid-row outline for the chosen depth and edge, so they
// line up exactly. Where they cross, the outer corner gets a hip and the
// inner corner a valley:
//   front wing  min(f(a), r(b))     a: blocks back from the front eave
//   side wing   min(f(b), r(a))     b: blocks in from the side-street eave
//   roof        the higher of the two
// f is the mid-row outline; r is its rising half, held at the top beyond the
// ridge. A plot deeper than both wings gets a flat patch in the inner back corner.

function cornerRoofShape(p, style, corner) {
  return lRoof(p, style, corner.chamfer);
}

const DIRS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const DIAG = { NE: [1, -1], NW: [-1, -1], SE: [1, 1], SW: [-1, 1] };

function lRoof(p, style, chamfer) {
  const f = footprint(p);
  const cut = (x, z) => outsideChamfer(p, chamfer, x, z);
  if (style.type === "flat" || style.type === "garden") return flatShape(f, style, cut);
  if (!SLOPED.has(style.type)) return [];

  const e = Math.max(EDGE_MIN, Math.min(EDGE_MAX, Math.round(style.edge || 0)));
  const D = chosenDepth(p); // the mid-row depth this corner joins
  const n = D + 2 * e; // a wing's width, eave to eave, as on a mid-row building
  if (n < 1) return [];
  const H = Math.max(1, style.height || 1);

  // The mid-row outline, indexed by distance from the street eave (mid-row
  // buildings count from the back, so read it the other way round).
  const fa = Array.from({ length: n }, (_, a) => outline(style.type, n - 1 - a, n, H, !!style.flip));
  const peak = fa.indexOf(Math.max(...fa));
  const rise = (t) => (t < peak ? fa[t] : fa[peak]);

  /** Top of the roof in each column, to the half block. */
  const q = new Map();
  for (let x = f.xMin; x <= f.xMax + e; x++)
    for (let z = f.zMin; z <= f.zMax + e; z++) {
      if (cut(x, z)) continue;
      const a = e - z, b = f.xMax + e - x;
      if (a < 0 || b < 0) continue; // inset: the roof starts inside the walls
      const front = a < n ? Math.min(fa[a], rise(b)) : -1;
      const side = b < n ? Math.min(fa[b], rise(a)) : -1;
      const h = Math.max(front, side);
      if (h >= 0) q.set(x + "," + z, half(h));
      // Deeper than the mid-row buildings on both streets (a plot wider than the
      // depth): a flat patch at the eaves. An inset ledge stays open, as on mid-row.
      else if (-z >= D && f.xMax - x >= D) q.set(x + "," + z, 0.5);
    }
  const Q = (x, z) => q.get(x + "," + z) ?? 0;
  // Beyond the inner side and back walls are the neighbours: count them as level with
  // the roof, so a high edge there is closed with party wall rather than roof blocks.
  const beyond = (x, z) => x < f.xMin || z < f.zMin;
  const around = (x, z, h) => Object.entries(DIRS).map(([d, [dx, dz]]) => [d, beyond(x + dx, z + dz) ? h : Q(x + dx, z + dz)]);
  const top = Math.max(...[...q.values()].map((t) => Math.ceil(t) - 1)) || 1;

  /** @type {Piece[]} */
  const out = [];
  const piece = (x, y, z, part, extra = {}) => out.push({ x, y, z, part, p: Math.min(1, y / top), ...extra });
  for (const [key, h] of q) {
    const [x, z] = key.split(",").map(Number);
    const k = Math.ceil(h) - 1;
    const near = around(x, z, h);
    const from = Math.min(k, Math.floor(Math.min(...near.map(([, t]) => t))));
    for (let y = from; y < k; y++) piece(x, y, z, "block");
    if (h - k === 0.5) { piece(x, k, z, "slab"); continue; }
    const higher = near.filter(([, t]) => t > h).map(([d]) => d);
    const lower = near.some(([, t]) => t < h);
    // In a valley the sides are level or higher; only the diagonal between them drops.
    const lowerDiag = Object.values(DIAG).some(([dx, dz]) => !beyond(x + dx, z + dz) && Q(x + dx, z + dz) < h);
    let st = null;
    if ((lower || lowerDiag) && higher.length) st = stairFromQuarters(new Set(higher.flatMap(halfOf)));
    else if (lower) {
      // On a hip line: no side is higher, but a diagonal is. That's an outer corner.
      const up = Object.entries(DIAG).filter(([, [dx, dz]]) => Q(x + dx, z + dz) > h).map(([qd]) => qd);
      if (up.length === 1) st = stairFromQuarters(new Set(up));
    }
    if (st) piece(x, k, z, "stairs", { facing: st.facing, ...(st.shape !== "straight" ? { shape: st.shape } : {}) });
    else piece(x, k, z, "block");
  }

  // The inner side wall and the back wall are party walls: close the space under the roof there,
  // as on the gable end of a mid-row building.
  for (const [key, h] of q) {
    const [x, z] = key.split(",").map(Number);
    if (!(x === f.xMin || z === f.zMin) || x > f.xMax || z > f.zMax) continue;
    const near = around(x, z, h).map(([, t]) => t);
    const from = Math.min(Math.ceil(h) - 1, Math.floor(Math.min(...near)));
    for (let y = 0; y < from; y++) piece(x, y, z, "party");
  }
  return out;
}
