// Tests for roof shapes in src/core/roof.js. Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { roofShape, outline, footprint, roofBlocks, pickMaterial, roofDefaults } from "../src/core/roof.js";
import { BMAP, MATERIALS, parseState } from "../src/core/blocks.js";
import { mulberry32 } from "../src/core/assemble.js";
import { K } from "../src/core/facade.js";
import { sampleProject } from "../src/core/sample.js";

const style = (o) => ({ type: "gable", ridge: "parallel", height: 4, edge: 0, ...o });
const byKey = (pieces) => new Map(pieces.map((c) => [K(c.x, c.y, c.z), c]));
/** Highest roof level in each slice across the slope (one value per z, at x = 0). */
const profile = (pieces, f, axis = "z") => {
  const out = [];
  const [a, b] = axis === "z" ? [f.zMin, f.zMax] : [f.xMin, f.xMax];
  for (let u = a; u <= b; u++) {
    const col = pieces.filter((c) => (axis === "z" ? c.z === u && c.x === 0 : c.x === u && c.z === f.zMax) && !["gable", "party"].includes(c.part));
    out.push(Math.max(...col.map((c) => c.y + (c.part === "slab" ? 0.5 : 1))));
  }
  return out;
};

test("a gable rises evenly to its height and comes down again", () => {
  const p = sampleProject(); // footprint 7 wide, 9 deep
  const f = footprint(p);
  const pr = profile(roofShape(p, style({ height: 4 })), f);
  assert.equal(pr.length, 9);
  assert.equal(Math.max(...pr), 4);
  assert.deepEqual(pr, [...pr].reverse(), "symmetrical");
  for (let i = 1; i <= 4; i++) assert.ok(pr[i] >= pr[i - 1], "rises to the ridge");
});

test("the height slider sets the roof height, any value", () => {
  const p = sampleProject();
  const f = footprint(p);
  for (const h of [1, 2, 3, 5, 7, 10]) assert.equal(Math.max(...profile(roofShape(p, style({ height: h })), f)), h, "height " + h);
});

test("stairs face uphill, with the tall half toward the ridge", () => {
  const p = sampleProject();
  const pieces = roofShape(p, style({ height: 4 }));
  const stairs = pieces.filter((c) => c.part === "stairs" && c.x === 0);
  assert.ok(stairs.length > 0);
  for (const s of stairs) assert.equal(s.facing, s.z < -4 ? "south" : "north", "stair at z " + s.z);
});

test("a shallow roof uses slabs, a steep roof uses blocks under stairs", () => {
  const p = sampleProject();
  const low = roofShape(p, style({ height: 1 }));
  assert.ok(low.some((c) => c.part === "slab"));
  // 13 high over 9 deep is about 3 up per step: two blocks under each stair
  const steep = roofShape(p, style({ height: 13 }));
  assert.ok(steep.filter((c) => c.part === "block").length > steep.filter((c) => c.part === "stairs").length);
});

test("the roof has no holes: each column reaches down to its lower neighbour", () => {
  const p = sampleProject();
  const pieces = roofShape(p, style({ height: 8 }));
  const m = byKey(pieces);
  const f = footprint(p);
  for (let z = f.zMin; z <= f.zMax; z++) {
    const ys = pieces.filter((c) => c.x === 1 && c.z === z && !["gable", "party"].includes(c.part)).map((c) => c.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) assert.equal(ys[i], ys[i - 1] + 1, "gap at z " + z);
  }
  assert.ok(m.size === pieces.length, "no cell used twice");
});

test("gable ends fill the triangle: party walls when parallel, the front when facing the street", () => {
  const p = sampleProject();
  const f = footprint(p);
  const par = roofShape(p, style({ height: 4 }));
  assert.ok(par.some((c) => c.part === "party" && c.x === f.xMin));
  assert.ok(!par.some((c) => c.part === "gable"));
  const st = roofShape(p, style({ height: 4, ridge: "street" }));
  const front = st.filter((c) => c.part === "gable");
  assert.ok(front.length > 0 && front.every((c) => c.z === f.zMax));
  assert.ok(st.some((c) => c.part === "party" && c.z === f.zMin), "back end on the back wall");
  // Facing the street, the slope runs across x and stairs face east/west.
  assert.ok(st.filter((c) => c.part === "stairs").every((c) => c.facing === "east" || c.facing === "west"));
});

test("edge: overhang reaches past the walls, inset starts inside them", () => {
  const p = sampleProject();
  const f = footprint(p);
  const zs = (s) => roofShape(p, s).filter((c) => !["gable", "party"].includes(c.part)).map((c) => c.z);
  assert.equal(Math.max(...zs(style({ edge: 1 }))), f.zMax + 1);
  assert.equal(Math.min(...zs(style({ edge: 1 }))), f.zMin - 1);
  assert.equal(Math.max(...zs(style({ edge: -2 }))), f.zMax - 2);
  // Gable ends stay inside the walls even under an overhang
  const ends = roofShape(p, style({ edge: 2 })).filter((c) => c.part === "party");
  assert.ok(ends.every((c) => c.z >= f.zMin && c.z <= f.zMax));
});

test("a sloped roof climbs from front to back, or back to front when flipped", () => {
  const p = sampleProject();
  const f = footprint(p);
  const pr = profile(roofShape(p, style({ type: "sloped", height: 5 })), f);
  assert.equal(pr[0], 5); // z = zMin is the back
  assert.ok(pr[pr.length - 1] < 1.5);
  const fl = profile(roofShape(p, style({ type: "sloped", height: 5, flip: true })), f);
  assert.deepEqual(fl, [...pr].reverse());
});

test("mansard is steep low down; convex bulges out above the straight mansard", () => {
  const n = 15, H = 8;
  const m = [...Array(n)].map((_, i) => outline("mansard", i, n, H));
  const c = [...Array(n)].map((_, i) => outline("convex", i, n, H));
  const g = [...Array(n)].map((_, i) => outline("gable", i, n, H));
  assert.ok(m[1] - m[0] > g[1] - g[0], "steeper than a gable at the eaves");
  assert.ok(c[1] > m[1], "convex sits above the straight lower slope");
  assert.equal(Math.max(...m), H);
  assert.equal(Math.max(...c), H);
});

test("flat roofs cover the footprint; a parapet adds a wall round the edge", () => {
  const p = sampleProject();
  const f = footprint(p);
  const cells = (f.xMax - f.xMin + 1) * (f.zMax - f.zMin + 1);
  const flat = roofShape(p, { type: "flat" });
  assert.equal(flat.length, cells);
  assert.ok(flat.every((c) => c.y === 0 && c.part === "block"));
  const walled = roofShape(p, { type: "flat", parapet: true });
  assert.ok(walled.some((c) => c.part === "parapet" && c.y === 1));
  assert.ok(!walled.some((c) => c.part === "parapet" && c.x === 0 && c.z === -4), "no wall in the middle");
});

test("garden roofs are walled, with soil and a planting spot on every inner cell", () => {
  const p = sampleProject();
  const g = roofShape(p, { type: "garden" });
  const inner = g.filter((c) => c.part === "soil");
  assert.equal(inner.length, g.filter((c) => c.part === "plant").length);
  assert.equal(inner.length, (7 - 2) * (9 - 2));
  assert.ok(g.filter((c) => c.part === "parapet").every((c) => c.y <= 1));
});

/* ---------- materials ---------- */

test("every roof material has a full block, stairs and slab in the catalogue", () => {
  for (const m of MATERIALS) {
    assert.equal(BMAP[m.block]?.shape, "cube", m.block);
    assert.equal(BMAP[m.stairs]?.shape, "stairs", m.stairs);
    assert.equal(BMAP[m.slab]?.shape, "slab", m.slab);
  }
});

test("roof pieces become the material's stairs, slabs and blocks", () => {
  const p = sampleProject();
  const bl = roofBlocks(p, style({ height: 3 }), 20, mulberry32(1));
  const ids = new Set(bl.map((b) => parseState(b.s).id));
  for (const id of ["minecraft:deepslate_tiles", "minecraft:deepslate_tile_stairs", "minecraft:deepslate_tile_slab"]) assert.ok(ids.has(id), id);
  assert.ok(bl.every((b) => b.y >= 20), "starts on top of the building");
  const stair = bl.find((b) => b.s.includes("_stairs"));
  assert.match(stair.s, /facing=(north|south),half=bottom/);
});

test("gradient bands run from eaves to ridge", () => {
  const st = roofDefaults({ blend: 0, bands: [{ mix: [{ material: "bricks", weight: 1 }] }, { mix: [{ material: "copper", weight: 1 }] }] });
  const r = mulberry32(3);
  assert.equal(pickMaterial(st, 0, r).id, "bricks");
  assert.equal(pickMaterial(st, 0.3, r).id, "bricks");
  assert.equal(pickMaterial(st, 0.7, r).id, "copper");
  assert.equal(pickMaterial(st, 1, r).id, "copper");
});

test("a soft blend mixes neighbouring bands near the border only", () => {
  const st = roofDefaults({ blend: 0.8, bands: [{ mix: [{ material: "bricks", weight: 1 }] }, { mix: [{ material: "copper", weight: 1 }] }] });
  const r = mulberry32(4);
  const at = (pos) => [...Array(400)].map(() => pickMaterial(st, pos, r).id);
  const mid = at(0.5);
  assert.ok(mid.includes("bricks") && mid.includes("copper"), "mixed at the border");
  assert.ok(at(0).every((m) => m === "bricks"), "pure at the eaves");
});

test("within a band, materials are mixed by weight", () => {
  const st = roofDefaults({ bands: [{ mix: [{ material: "bricks", weight: 3 }, { material: "mud_bricks", weight: 1 }] }] });
  const r = mulberry32(5);
  const picks = [...Array(4000)].map(() => pickMaterial(st, 0.5, r).id);
  const share = picks.filter((m) => m === "bricks").length / picks.length;
  assert.ok(share > 0.7 && share < 0.8, "about three quarters bricks, got " + share);
});

test("gable ends use party-wall blocks, or the gable block at a street front", () => {
  const p = sampleProject();
  const party = roofBlocks(p, style({}), 0, mulberry32(1), () => "minecraft:mud_bricks");
  assert.ok(party.some((b) => b.s === "minecraft:mud_bricks"));
  const front = roofBlocks(p, style({ ridge: "street", gableBlock: "minecraft:quartz_block" }), 0, mulberry32(1));
  assert.ok(front.some((b) => b.s === "minecraft:quartz_block" && b.z === 0));
});

test("garden density sets how much grows, and the same seed grows the same garden", () => {
  const p = sampleProject();
  const plants = (d, seed) => roofBlocks(p, { type: "garden", density: d }, 0, mulberry32(seed))
    .filter((b) => BMAP[parseState(b.s).id]?.shape === "plant" && !b.s.includes("half=upper"));
  assert.equal(plants(0, 1).length, 0);
  assert.equal(plants(1, 1).length, 5 * 7);
  assert.deepEqual(plants(0.5, 9), plants(0.5, 9));
  const all = roofBlocks(p, { type: "garden", density: 1 }, 0, mulberry32(2));
  for (const low of all.filter((b) => b.s === "minecraft:tall_grass[half=lower]"))
    assert.ok(all.some((b) => b.s === "minecraft:tall_grass[half=upper]" && b.x === low.x && b.z === low.z && b.y === low.y + 1));
  assert.ok(all.some((b) => b.s === "minecraft:grass_block"));
});

/* ---------- corner roofs ---------- */

const cornerP = (type, chamfer = 2) => { const p = sampleProject(); p.assembly.type = type; p.types = { chamfer }; return p; };
/** Highest roof level at each (x, z), ignoring party-wall fill. */
const tops = (pieces) => {
  const m = new Map();
  for (const c of pieces) if (c.part !== "party") m.set(c.x + "," + c.z, Math.max(m.get(c.x + "," + c.z) ?? -1, c.y + (c.part === "slab" ? 0.5 : 1)));
  return m;
};

/** Roof heights of the mid-row building of the same depth, across z (they don't vary along x). */
const midProfile = (p, st) => {
  const m = structuredClone(p);
  m.assembly.type = "mid";
  const t = tops(roofShape(m, st));
  return (z) => t.get("0," + z);
};

test("a corner roof lines up with the mid-row roofs on both streets", () => {
  for (const [type, height, edge, depth] of [["gable", 4, 0, 9], ["gable", 4, 1, 9], ["mansard", 6, 0, 11], ["convex", 6, 1, 9], ["gable", 5, -1, 12]]) {
    const p = cornerP("c");
    p.depthMin = 3; p.depthMax = 20; p.assembly.depth = depth;
    const st = style({ type, height, edge });
    const t = tops(roofShape(p, st));
    const mid = midProfile(p, st);
    const f = footprint(p);
    const label = `${type} h${height} edge ${edge} depth ${depth}`;
    // Front street: the corner's inner edge matches its neighbour's cross-section
    for (let z = f.zMin; z <= f.zMax + edge; z++) assert.equal(t.get(f.xMin + "," + z), mid(z), label + " front z " + z);
    // Side street: the back edge matches the side neighbour (the same roof, turned)
    for (let x = f.xMin; x <= f.xMax + edge; x++) {
      const a = f.xMax + edge - x; // blocks in from the side-street eave
      if (a >= depth + 2 * edge) continue;
      assert.equal(t.get(x + "," + f.zMin), mid(edge - a), label + " side x " + x);
    }
  }
});

test("where the two wings meet: a hip outside, a valley inside", () => {
  const p = cornerP("c");
  // 9 high over 9 deep: two blocks up per step, so the hip and valley are stairs, not slabs
  const pieces = roofShape(p, style({ height: 9 }));
  assert.ok(pieces.some((c) => c.part === "stairs" && /^outer/.test(c.shape)), "hip: outer corner stairs");
  assert.ok(pieces.some((c) => c.part === "stairs" && /^inner/.test(c.shape)), "valley: inner corner stairs");
});

test("a plot wider than the depth gets a flat patch in its inner back corner", () => {
  const p = cornerP("c");
  p.depthMin = 5; p.depthMax = 5; p.assembly.depth = 5; // plot stays 7 wide
  const t = tops(roofShape(p, style({ height: 3 })));
  const f = footprint(p);
  assert.equal(t.get(f.xMin + "," + f.zMin), 0.5);
});

test("a sloped corner roof comes down toward both streets, high at the inner back corner", () => {
  const p = cornerP("c");
  const f = footprint(p);
  const pieces = roofShape(p, style({ type: "sloped", height: 4 }));
  const t = tops(pieces);
  assert.equal(t.get(f.xMin + "," + f.zMin), 4, "inner back corner is highest");
  assert.equal(t.get(f.xMax + "," + f.zMax), 0.5, "street corner is lowest");
  assert.ok(pieces.some((c) => c.part === "party"), "high edges closed with party wall");
});

test("edge reaches out over both streets on a corner, never over the neighbours", () => {
  const p = cornerP("c");
  const f = footprint(p);
  const xs = roofShape(p, style({ edge: 1 })).map((c) => c.x), zs = roofShape(p, style({ edge: 1 })).map((c) => c.z);
  assert.equal(Math.max(...xs), f.xMax + 1);
  assert.equal(Math.max(...zs), f.zMax + 1);
  assert.equal(Math.min(...xs), f.xMin);
  assert.equal(Math.min(...zs), f.zMin);
});

test("a chamfered corner clips the roof along the diagonal; a garden wall follows it", () => {
  const p = cornerP("c-ch", 2);
  const t = tops(roofShape(p, style({ height: 4 })));
  assert.ok(!t.has("3,0") && !t.has("2,0") && !t.has("3,-1"), "roof cut at the corner");
  const g = roofShape(p, { type: "garden" });
  assert.ok(g.some((c) => c.part === "parapet" && c.x === 2 && c.z === -1), "wall along the cut");
});
