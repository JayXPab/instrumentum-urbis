// Assembly: stacks Base + Body × (floors − 2) + Capital into one building,
// fills party walls, then puts the chosen roof on top. Pure functions, no DOM, no three.js.

import { BMAP, recolour, colourName } from "./blocks.js";
import { colourFor, colourLists, buildingColours } from "./colour.js";
import { K, unK, bounds, clamp } from "./facade.js";
import { roofBlocks } from "./roof.js";
import { cornerOf, buildCorner, typeList } from "./corner.js";

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

/** Shallowest building the facade allows: its recesses plus a back wall. */
export const minDepth = (p) => -bounds(p).zMin + 2;

/** The chosen depth: assembly.depth within the depth range, never shallower than the facade allows. */
export const chosenDepth = (p) => Math.max(clamp(p.assembly.depth ?? p.depthMin, p.depthMin, p.depthMax), minDepth(p));

/**
 * Depth of the building in blocks, Core Wall to back wall. A corner plot is as
 * deep as its mid-row neighbours on both streets, and never narrower than the facade.
 */
export const buildingDepth = (p) => (cornerOf(p) ? Math.max(chosenDepth(p), p.width) : chosenDepth(p));

/**
 * The building's plot, x and z. Mid-row: the facade's width. A corner plot is
 * square and reaches inward (−x) from the corner column at xMax.
 */
export function plot(p) {
  const b = bounds(p), d = buildingDepth(p);
  return { xMin: cornerOf(p) ? b.xMax - d + 1 : b.xMin, xMax: b.xMax, zMin: -(d - 1), zMax: 0 };
}

/**
 * @typedef {{s:string, kind:"base"|"body"|"capital"|"party"|"roof", copy?:number}} Cell
 * @typedef {{kind:string, copy:number, total:number, y0:number, h:number, name:string}} Segment
 */

/**
 * Builds the building chosen in p.assembly.
 * height is the top of the capital; top is the top of everything, roof included.
 * @returns {{cells: Map<string, Cell>, segs: Segment[], height:number, top:number, floors:number}}
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
    const colour = colourFor(p, kind); // white slot blocks take this colour
    for (const [k, s] of Object.entries(v.blocks)) {
      const [x, y, z] = unK(k);
      cells.set(K(x, y + y0, z), { s: colour ? recolour(s, colour) : s, kind, copy });
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

  // Corner buildings: the same facade turned to face the side street as well.
  const corner = cornerOf(p);
  if (corner) {
    const both = buildCorner(cells, p, corner, buildingDepth(p));
    cells.clear();
    for (const [k, c] of both) cells.set(k, c);
  }

  // Party walls: side walls at the outer columns and a back wall,
  // filling only cells the facade left empty.
  const pal = (p.partyWall || []).filter((e) => BMAP[e.block] && e.weight > 0);
  const tot = pal.reduce((s, e) => s + e.weight, 0);
  const rnd = mulberry32(a.seed);
  const pickFrom = (r) => () => {
    if (tot <= 0) return null;
    let x = r() * tot;
    for (const e of pal) {
      x -= e.weight;
      if (x < 0) return e.block;
    }
    return pal[pal.length - 1].block;
  };
  if (tot > 0) {
    const pick = pickFrom(rnd);
    const lot = plot(p), zBack = lot.zMin;
    for (let y = 0; y < y0; y++) {
      for (let z = -1; z >= zBack; z--)
        for (const x of [lot.xMin, lot.xMax]) {
          // A corner building has its side facade here instead of a party wall.
          if (corner && x === lot.xMax) continue;
          const k = K(x, y, z);
          if (!cells.has(k)) cells.set(k, { s: pick(), kind: "party" });
        }
      for (let x = lot.xMin + 1; x < lot.xMax; x++) {
        const k = K(x, y, zBack);
        if (!cells.has(k)) cells.set(k, { s: pick(), kind: "party" });
      }
    }
  }

  // Roof: its own random numbers, so choosing a roof never changes the party walls.
  let top = y0;
  const roof = roofOf(p);
  if (roof) {
    const rr = mulberry32((a.seed ^ 0x9e3779b9) >>> 0);
    for (const c of roofBlocks(p, roof, y0, rr, pickFrom(rr))) {
      const k = K(c.x, c.y, c.z);
      if (!cells.has(k)) cells.set(k, { s: c.s, kind: "roof" });
      top = Math.max(top, c.y + 1);
    }
    segs.push({ kind: "roof", copy: 0, total: 1, y0, h: top - y0, name: roof.name });
  }
  return { cells, segs, height: y0, top, floors };
}

/** The roof style chosen in p.assembly, or null when the project has none (flat top). */
export function roofOf(p) {
  const list = p.roofs || [];
  return list.length ? list[clamp(p.assembly.roof ?? 0, 0, list.length - 1)] : null;
}

/** Readable name of the building in p.assembly, e.g. "Shopfront / Three windows / Cornice, 5 floors". */
export function buildingTitle(p) {
  const a = p.assembly;
  const floors = clamp(a.floors, p.floorMin, p.floorMax);
  const n = (kind, i) => p.stages[kind][i]?.name ?? "?";
  const roof = roofOf(p);
  const corner = cornerOf(p);
  const deep = p.depthMax > p.depthMin ? `, ${chosenDepth(p)} deep` : "";
  const type = corner ? (corner.chamfer ? ", corner, chamfered" : ", corner") : "";
  const col = buildingColours(p);
  const colours = (col.main ? ", " + colourName(col.main).toLowerCase() : "") + (col.base ? `, ${colourName(col.base).toLowerCase()} base` : "");
  return `${n("base", a.base)} / ${n("body", a.body)} / ${n("capital", a.capital)}${roof ? " / " + roof.name : ""}, ${floors} floors${deep}${type}${colours}`;
}

/**
 * Number of distinct buildings the project can make: every ticked building type
 * (mid-row, corner, chamfered corner) in every depth of the range, in every
 * ticked colour (and base colour, when the base has its own).
 */
export function comboCount(p) {
  const r = Math.max(0, p.floorMax - p.floorMin + 1);
  const roofs = Math.max(1, (p.roofs || []).length);
  const depths = Math.max(0, p.depthMax - p.depthMin + 1);
  const types = typeList(p).length;
  const cl = colourLists(p), colours = cl.main.length, baseColours = cl.base.length;
  return {
    n: p.stages.base.length * p.stages.body.length * p.stages.capital.length * roofs * r * depths * types * colours * baseColours,
    r, roofs, depths, types, colours, baseColours,
  };
}
