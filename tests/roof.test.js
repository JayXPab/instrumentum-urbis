// Tests for roof shapes in src/core/roof.js. Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { roofShape, outline, footprint } from "../src/core/roof.js";
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
