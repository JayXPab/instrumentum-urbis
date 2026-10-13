// Tests for the combination generator in src/core/bulk.js. Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { comboAt, chooseCombos, bulkCount, forCombo, buildingSeed, indexCsv } from "../src/core/bulk.js";
import { assemble, comboCount, buildingTitle } from "../src/core/assemble.js";
import { sampleProject } from "../src/core/sample.js";

const key = (c) => `${c.base}-${c.body}-${c.capital}-${c.floors}`;

test("every combination appears exactly once", () => {
  const p = sampleProject();
  const total = comboCount(p).n; // 2 × 2 × 2 × 6 floor counts
  assert.equal(total, 48);
  const all = chooseCombos(p);
  assert.equal(all.length, total);
  assert.equal(new Set(all.map(key)).size, total);
  for (const c of all) {
    assert.ok(c.floors >= p.floorMin && c.floors <= p.floorMax);
    assert.ok(c.base < 2 && c.body < 2 && c.capital < 2);
  }
  assert.deepEqual(comboAt(p, 0), { base: 0, body: 0, capital: 0, floors: 3 });
  assert.deepEqual(comboAt(p, 47), { base: 1, body: 1, capital: 1, floors: 8 });
});

test("an amount below all takes the first N in order", () => {
  const p = sampleProject();
  p.bulk.amount = 5;
  assert.deepEqual(chooseCombos(p), [0, 1, 2, 3, 4].map((i) => comboAt(p, i)));
  p.bulk.amount = 999; // more than exist means all
  assert.deepEqual(bulkCount(p), { n: 48, total: 48 });
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
  assert.equal(chooseCombos(p).length, 48);
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
  const p = forCombo(sampleProject(), { base: 1, body: 0, capital: 1, floors: 4 });
  assert.equal(buildingTitle(p), "Colonnade / Three windows / Parapet, 4 floors");
  p.stages.base[1].name = 'Big, "grand" base';
  const out = indexCsv([{ file: "a.bp", p, blocks: 10 }]).split("\r\n");
  assert.equal(out[0], "file,base,body,capital,floors,party_wall_seed,blocks");
  assert.equal(out[1], `a.bp,"Big, ""grand"" base",Three windows,Parapet,4,${p.assembly.seed},10`);
});
