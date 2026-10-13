// Assembly: stacks Base + Body × (floors − 2) + Capital into one building,
// then fills party walls. Pure functions, no DOM, no three.js.

import { BMAP } from "./blocks.js";
import { K, unK, bounds, clamp } from "./facade.js";

/** Small seeded random generator so a building can be regenerated exactly. */
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Depth of the whole building in blocks, never shallower than the facade itself. */
export const buildingDepth = (p) => Math.max(p.buildingDepth, -bounds(p).zMin + 2);

/**
 * @typedef {{s:string, kind:"base"|"body"|"capital"|"party", copy?:number}} Cell
 * @typedef {{kind:string, copy:number, total:number, y0:number, h:number, name:string}} Segment
 */

/**
 * Builds the building chosen in p.assembly.
 * @returns {{cells: Map<string, Cell>, segs: Segment[], height:number, floors:number}}
 */
export function assemble(p) {
  const a = p.assembly;
  const b = bounds(p);
  const floors = clamp(a.floors, p.floorMin, p.floorMax);
  /** @type {Map<string, Cell>} */
  const cells = new Map();
  /** @type {Segment[]} */
  const segs = [];
  let y0 = 0;

  const put = (v, kind, copy, total) => {
    if (!v) return;
    for (const [k, s] of Object.entries(v.blocks)) {
      const [x, y, z] = unK(k);
      cells.set(K(x, y + y0, z), { s, kind, copy });
    }
    segs.push({ kind, copy, total, y0, h: p.heights[kind], name: v.name });
    y0 += p.heights[kind];
  };

  put(p.stages.base[a.base], "base", 0, 1);
  // Every body floor in one building is the same variant; variety comes between buildings.
  const nb = floors - 2;
  const body = p.stages.body[a.body];
  for (let i = 0; i < nb; i++) put(body, "body", i, nb);
  put(p.stages.capital[a.capital], "capital", 0, 1);

  // Party walls: side walls at the outer columns and a back wall,
  // filling only cells the facade left empty.
  const pal = (p.partyWall || []).filter((e) => BMAP[e.block] && e.weight > 0);
  const tot = pal.reduce((s, e) => s + e.weight, 0);
  if (tot > 0) {
    const rnd = mulberry32(a.seed);
    const pick = () => {
      let r = rnd() * tot;
      for (const e of pal) {
        r -= e.weight;
        if (r < 0) return e.block;
      }
      return pal[pal.length - 1].block;
    };
    const zBack = -(buildingDepth(p) - 1);
    for (let y = 0; y < y0; y++) {
      for (let z = -1; z >= zBack; z--)
        for (const x of [b.xMin, b.xMax]) {
          const k = K(x, y, z);
          if (!cells.has(k)) cells.set(k, { s: pick(), kind: "party" });
        }
      for (let x = b.xMin + 1; x < b.xMax; x++) {
        const k = K(x, y, zBack);
        if (!cells.has(k)) cells.set(k, { s: pick(), kind: "party" });
      }
    }
  }
  return { cells, segs, height: y0, floors };
}

/** Number of distinct buildings the current variants and floor range can make. */
export function comboCount(p) {
  const r = Math.max(0, p.floorMax - p.floorMin + 1);
  return { n: p.stages.base.length * p.stages.body.length * p.stages.capital.length * r, r };
}
