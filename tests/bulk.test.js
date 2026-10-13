// Tests for the combination generator in src/core/bulk.js. Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { comboAt, chooseCombos, bulkCount, forCombo, buildingSeed, indexCsv } from "../src/core/bulk.js";
import { assemble, comboCount, buildingTitle, buildingDepth } from "../src/core/assemble.js";
import { schemName } from "../src/core/schem.js";
import { upgradeProject } from "../src/core/project.js";
import { checks } from "../src/core/facade.js";
import { sampleProject } from "../src/core/sample.js";

const key = (c) => `${c.base}-${c.body}-${c.capital}-${c.roof}-${c.floors}`;

test("every combination appears exactly once", () => {
  const p = sampleProject();
  const total = comboCount(p).n; // 2 × 2 × 2 variants × 3 roofs × 6 floor counts
  assert.equal(total, 144);
  const all = chooseCombos(p);
  assert.equal(all.length, total);
  assert.equal(new Set(all.map(key)).size, total);
  for (const c of all) {
    assert.ok(c.floors >= p.floorMin && c.floors <= p.floorMax);
    assert.ok(c.base < 2 && c.body < 2 && c.capital < 2 && c.roof < 3);
  }
  assert.deepEqual(comboAt(p, 0), { base: 0, body: 0, capital: 0, roof: 0, floors: 3, depth: 9, type: "mid" });
  assert.deepEqual(comboAt(p, 6), { base: 0, body: 0, capital: 0, roof: 1, floors: 3, depth: 9, type: "mid" });
  assert.deepEqual(comboAt(p, 143), { base: 1, body: 1, capital: 1, roof: 2, floors: 8, depth: 9, type: "mid" });
});

test("an amount below all takes the first N in order", () => {
  const p = sampleProject();
  p.bulk.amount = 5;
  assert.deepEqual(chooseCombos(p), [0, 1, 2, 3, 4].map((i) => comboAt(p, i)));
  p.bulk.amount = 999; // more than exist means all
  assert.deepEqual(bulkCount(p), { n: 144, total: 144 });
});

test("a random sample has N different buildings and repeats for the same seed", () => {
  const p = sampleProject();
  p.bulk.amount = 10;
  p.bulk.random = true;
  const a = chooseCombos(p);
  assert.equal(a.length, 10);
  assert.equal(new Set(a.map(key)).size, 10);
  assert.deepEqual(chooseCombos(p), a);
  assert.notDeepEqual(a, chooseCombos({ ...p, bulk: { ...p.bulk, random: false } }));
  p.bulk.seed = 2;
  assert.notDeepEqual(chooseCombos(p), a);
});

test("a random sample of all is simply every combination", () => {
  const p = sampleProject();
  p.bulk.random = true;
  assert.equal(chooseCombos(p).length, 144);
});

test("each building gets its own party-wall seed; the project is not changed", () => {
  const p = sampleProject();
  const before = JSON.stringify(p);
  const [c1, c2] = chooseCombos(p);
  assert.notEqual(buildingSeed(p.bulk.seed, c1), buildingSeed(p.bulk.seed, c2));
  const q = forCombo(p, c2);
  assert.deepEqual(assemble(q).cells, assemble(forCombo(p, c2)).cells);
  assert.equal(q.assembly.floors, c2.floors);
  assert.equal(JSON.stringify(p), before);
});

test("titles and index.csv use the variant names", () => {
  const p = forCombo(sampleProject(), { base: 1, body: 0, capital: 1, roof: 2, floors: 4, depth: 9 });
  assert.equal(buildingTitle(p), "Colonnade / Three windows / Parapet / Roof garden, 4 floors");
  p.stages.base[1].name = 'Big, "grand" base';
  const out = indexCsv([{ file: "a.bp", p, blocks: 10 }]).split("\r\n");
  assert.equal(out[0], "file,type,base,body,capital,roof,floors,depth,seed,blocks");
  assert.equal(out[1], `a.bp,Mid-row,"Big, ""grand"" base",Three windows,Parapet,Roof garden,4,9,${p.assembly.seed},10`);
});

test("a different roof keeps the same party walls", () => {
  const p = sampleProject();
  const a = forCombo(p, { base: 0, body: 0, capital: 0, roof: 0, floors: 5 });
  const c = forCombo(p, { base: 0, body: 0, capital: 0, roof: 1, floors: 5 });
  assert.equal(a.assembly.seed, c.assembly.seed);
  const walls = (q) => [...assemble(q).cells].filter(([, v]) => v.kind === "party").map(([k, v]) => k + v.s).join();
  assert.equal(walls(a), walls(c));
});

test("a depth range adds every depth to the combinations", () => {
  const p = sampleProject();
  p.depthMin = 9; p.depthMax = 11;
  const all = chooseCombos(p);
  assert.equal(all.length, 144 * 3);
  assert.deepEqual(new Set(all.map((c) => c.depth)), new Set([9, 10, 11]));
  const q = forCombo(p, all.find((c) => c.depth === 11));
  assert.equal(buildingDepth(q), 11);
  // Party walls only: the slate gable's overhang reaches one block further.
  const back = Math.min(...[...assemble(q).cells].filter(([, c]) => c.kind === "party").map(([k]) => +k.split(",")[2]));
  assert.equal(back, -10, "back wall 11 blocks from the front, Core Wall included");
});

test("depth shows in names and titles only when the range has more than one value", () => {
  const p = sampleProject();
  assert.equal(schemName(p), "facade_b1-b1-c1-r1_5fl");
  p.depthMax = 12; p.assembly.depth = 12;
  assert.equal(schemName(p), "facade_b1-b1-c1-r1_5fl_12d");
  assert.match(buildingTitle(p), /, 5 floors, 12 deep$/);
});

test("the building is never shallower than the facade allows", () => {
  const p = sampleProject(); // depthBack 1: needs at least 3
  p.depthMin = 2; p.depthMax = 2; p.assembly.depth = 2;
  assert.equal(buildingDepth(p), 3);
  assert.ok(checks(p).some(([t, m]) => t === "err" && m.includes("Depth range")));
});

test("a version 1 project loads with its depth as a range of one", () => {
  const v1 = { format: "instrumentum-urbis/facade", formatVersion: 1, width: 7, depthFront: 1, depthBack: 1,
    heights: { base: 4, body: 4, capital: 3 }, stages: { base: [], body: [], capital: [] },
    floorMin: 3, floorMax: 5, buildingDepth: 11, partyWall: [], assembly: { base: 0, body: 0, capital: 0, floors: 3, seed: 1 } };
  const p = upgradeProject(v1);
  assert.equal(p.formatVersion, 2);
  assert.equal(p.depthMin, 11);
  assert.equal(p.depthMax, 11);
  assert.equal(p.assembly.depth, 11);
  assert.equal(p.buildingDepth, undefined);
  assert.deepEqual(p.roofs, []);
  assert.equal(p.bulk.format, "bp");
  assert.deepEqual(upgradeProject(structuredClone(p)), p, "upgrading again changes nothing");
});

test("ticked corner types add to the combinations, with one depth each", () => {
  const p = sampleProject(); // 144 mid-row buildings at depth 9
  p.depthMax = 10; // mid-row now has 2 depths
  p.types = { mid: true, left: true, right: true, sharp: true, chamfered: true, chamfer: 2 };
  // per variant set: 2 mid-row depths + 4 corner types = 6 slots; × 2·2·2 variants × 3 roofs × 6 floor counts
  assert.equal(comboCount(p).n, 6 * 8 * 3 * 6);
  const all = chooseCombos(p);
  assert.equal(new Set(all.map((c) => key(c) + c.type + c.depth)).size, all.length);
  assert.deepEqual([...new Set(all.map((c) => c.type))].sort(), ["cl", "cl-ch", "cr", "cr-ch", "mid"]);
  assert.ok(all.filter((c) => c.type !== "mid").every((c) => c.depth === p.depthMin), "corners have one depth");
});

test("corners only: no mid-row buildings; a corner with no style ticked is sharp", () => {
  const p = sampleProject();
  p.types = { mid: false, left: false, right: true, sharp: false, chamfered: false, chamfer: 2 };
  assert.equal(comboCount(p).n, 144);
  assert.ok(chooseCombos(p).every((c) => c.type === "cr"));
  p.types = { mid: false, left: false, right: false };
  assert.ok(chooseCombos(p).every((c) => c.type === "mid"), "nothing ticked falls back to mid-row");
});

test("corner buildings are named and titled by type", () => {
  const p = forCombo(sampleProject(), { base: 0, body: 0, capital: 0, roof: 0, floors: 4, depth: 9, type: "cl-ch" });
  p.depthMax = 12; // even with a depth range, corners carry no depth
  assert.equal(schemName(p), "facade_b1-b1-c1-r1_4fl_cl-ch");
  assert.match(buildingTitle(p), /, 4 floors, left corner, chamfered$/);
  assert.match(indexCsv([{ file: "x.bp", p, blocks: 1 }]).split("\r\n")[1], /^x\.bp,"Left corner, chamfered",/);
});

test("an older project loads as mid-row only", () => {
  const p = sampleProject();
  delete p.types;
  delete p.assembly.type;
  upgradeProject(p);
  assert.equal(p.assembly.type, "mid");
  assert.equal(p.types.mid, true);
  assert.equal(p.types.right, false);
});
