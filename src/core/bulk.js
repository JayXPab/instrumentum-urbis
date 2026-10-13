// Combination generator: lists the buildings a project can make and picks
// which ones a bulk export includes. Pure functions, no DOM, no three.js.
//
// A combination is one base, one body and one capital variant and one roof
// style (by index), a floor count, and a building type (mid-row or a corner)
// with a depth (mid-row only: corner buildings are square). With no roof styles, roof is 0 and the
// building has a flat top. Each gets its own party-wall seed, worked out from the
// project's bulk seed, so exporting again gives exactly the same buildings.

import { comboCount, mulberry32, buildingDepth } from "./assemble.js";
import { typeList, TYPE_NAMES } from "./corner.js";

/** @typedef {{base:number, body:number, capital:number, roof:number, floors:number, depth:number, type:string}} Combo */

/** Bulk export settings saved with the project. amount null = all combinations. */
export const bulkDefaults = () => ({ format: "bp", amount: null, random: false, seed: 1, limit: 200 });

/**
 * The i-th combination, counting floors fastest, then type-and-depth, roof, capital, body, base.
 * Type-and-depth runs through every mid-row depth first, then each corner type.
 * @returns {Combo}
 */
export function comboAt(p, i) {
  const r = p.floorMax - p.floorMin + 1;
  const nc = p.stages.capital.length, nb = p.stages.body.length;
  const nr = Math.max(1, (p.roofs || []).length);
  const types = typeList(p);
  const midDepths = types.includes("mid") ? Math.max(0, p.depthMax - p.depthMin + 1) : 0;
  const corners = types.filter((t) => t !== "mid");
  const ns = Math.max(1, midDepths + corners.length);
  const floors = p.floorMin + (i % r); i = Math.floor(i / r);
  const slot = i % ns; i = Math.floor(i / ns);
  const type = slot < midDepths ? "mid" : corners[slot - midDepths];
  const depth = slot < midDepths ? p.depthMin + slot : p.depthMin;
  const roof = i % nr; i = Math.floor(i / nr);
  const capital = i % nc; i = Math.floor(i / nc);
  const body = i % nb; i = Math.floor(i / nb);
  return { base: i, body, capital, roof, floors, depth, type };
}

/** Mixes numbers into one well-spread 32-bit seed. */
export function hash32(...xs) {
  let h = 0x811c9dc5;
  for (const x of xs) {
    h = Math.imul(h ^ (x | 0), 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  return h >>> 0;
}

/**
 * Party-wall seed for one combination in a bulk run. Roof and depth are left
 * out on purpose: the same building with a different roof or depth keeps the
 * same wall pattern.
 */
export const buildingSeed = (seed, c) => hash32(seed, c.base, c.body, c.capital, c.floors);

/** A copy of the project set up to build combination c (the original is untouched). */
export const forCombo = (p, c) => ({ ...p, assembly: { ...c, seed: buildingSeed(p.bulk.seed, c) } });

/**
 * How many buildings the bulk settings ask for, out of how many possible.
 * @returns {{n:number, total:number}}
 */
export function bulkCount(p) {
  const total = comboCount(p).n;
  const a = p.bulk.amount;
  return { n: a == null || a >= total ? total : Math.max(0, Math.floor(a)), total };
}

/**
 * The combinations a bulk export includes, in order.
 * All of them; or the first N; or, with random on, N different ones picked
 * at random (seeded, so the same settings give the same pick).
 * @returns {Combo[]}
 */
export function chooseCombos(p) {
  const { n, total } = bulkCount(p);
  /** @type {number[]} */
  let idx;
  if (n === total || !p.bulk.random) idx = Array.from({ length: n }, (_, i) => i);
  else {
    // Floyd's algorithm: n distinct numbers below total without listing them all.
    const rnd = mulberry32(hash32(p.bulk.seed, 0x5eed));
    const picked = new Set();
    for (let j = total - n; j < total; j++) {
      const t = Math.floor(rnd() * (j + 1));
      picked.add(picked.has(t) ? j : t);
    }
    idx = [...picked].sort((a, b) => a - b);
  }
  return idx.map((i) => comboAt(p, i));
}

/** Escapes one CSV field. */
const csv = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/**
 * The index.csv that goes in the zip: one row per building.
 * @param {Array<{file:string, p:any, blocks:number}>} rows p is the project from forCombo
 */
export function indexCsv(rows) {
  const head = ["file", "type", "base", "body", "capital", "roof", "floors", "depth", "seed", "blocks"];
  const lines = rows.map(({ file, p, blocks }) => {
    const a = p.assembly;
    const roof = p.roofs?.length ? p.roofs[a.roof].name : "";
    return [file, TYPE_NAMES[a.type || "mid"], p.stages.base[a.base].name, p.stages.body[a.body].name, p.stages.capital[a.capital].name, roof, a.floors, buildingDepth(p), a.seed, blocks]
      .map(csv).join(",");
  });
  return [head.join(","), ...lines].join("\r\n") + "\r\n";
}
