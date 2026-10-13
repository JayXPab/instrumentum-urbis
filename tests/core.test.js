// Tests for the facade rules in src/core. Run with: npm test
// These use Node's built-in test runner, so they need no extra packages.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseState, makeState, mirrorState } from "../src/core/blocks.js";
import { K, bounds, mirrorX, axisX, newVariant, pruneAll, checks } from "../src/core/facade.js";
import { assemble, comboCount, mulberry32 } from "../src/core/assemble.js";
import { sampleProject } from "../src/core/sample.js";

test("odd width: x = 0 is the exact middle and mirrors onto itself", () => {
  const p = { width: 7, depthFront: 1, depthBack: 1 };
  assert.deepEqual(bounds(p), { xMin: -3, xMax: 3, zMin: -1, zMax: 1 });
  assert.equal(mirrorX(p, -3), 3);
  assert.equal(mirrorX(p, 0) + 0, 0);
  assert.equal(axisX(p), 0);
});

test("even width: x = 0 is the right-hand block of the middle pair", () => {
  const p = { width: 6, depthFront: 1, depthBack: 1 };
  const b = bounds(p);
  assert.equal(b.xMin, -3);
  assert.equal(b.xMax, 2); // three blocks left of centre, two right
  assert.equal(mirrorX(p, 0), -1); // the middle pair mirror onto each other
  assert.equal(mirrorX(p, -3), 2);
  assert.equal(axisX(p), -0.5);
});

test("block states round-trip and mirror east/west", () => {
  const s = makeState("minecraft:stone_brick_stairs", { facing: "east", half: "top" });
  assert.equal(s, "minecraft:stone_brick_stairs[facing=east,half=top]");
  assert.deepEqual(parseState(s).props, { facing: "east", half: "top" });
  assert.equal(parseState(mirrorState(s)).props.facing, "west");
  assert.equal(mirrorState("minecraft:bricks"), "minecraft:bricks");
});

test("a new variant starts with a full Core Wall at z = 0", () => {
  const p = sampleProject();
  const v = newVariant(p, "body", "Test");
  assert.equal(Object.keys(v.blocks).length, p.width * p.heights.body);
  assert.ok(Object.keys(v.blocks).every((k) => k.endsWith(",0")));
});

test("shrinking the width prunes blocks outside the new bounds", () => {
  const p = sampleProject();
  p.width = 5;
  p.depthFront = 2;
  const removed = pruneAll(p);
  assert.ok(removed > 0);
  for (const v of p.stages.base) assert.equal(v.blocks[K(3, 0, 0)], undefined);
});

test("checks enforce the depth rule |zmax| <= |xmax|", () => {
  const p = sampleProject();
  assert.equal(checks(p)[0][0], "ok");
  p.depthFront = 4; // width 7 allows at most 3
  assert.ok(checks(p).some(([t, m]) => t === "err" && m.includes("depth")));
});

test("assembly stacks base, repeated body floors, capital, then roof", () => {
  const p = sampleProject();
  p.assembly.floors = 5;
  const A = assemble(p);
  assert.equal(A.floors, 5);
  assert.deepEqual(A.segs.map((s) => s.kind), ["base", "body", "body", "body", "capital", "roof"]);
  assert.equal(A.height, 5 + 4 * 3 + 3);
  assert.ok(A.top > A.height, "the roof sits on top");
  assert.ok([...A.cells.values()].some((c) => c.kind === "roof"));
  // Every body floor is the same variant
  assert.ok(A.segs.filter((s) => s.kind === "body").every((s) => s.name === "Three windows"));
});

test("floors are clamped to the floor range", () => {
  const p = sampleProject();
  p.assembly.floors = 99;
  assert.equal(assemble(p).floors, p.floorMax);
});

test("party walls never overwrite facade blocks", () => {
  const p = sampleProject();
  const A = assemble(p);
  const facade = [...A.cells.values()].filter((c) => c.kind !== "party").length;
  p.partyWall = [];
  assert.equal(assemble(p).cells.size, facade);
});

test("the same seed rebuilds the same party walls", () => {
  const p = sampleProject();
  const a = JSON.stringify([...assemble(p).cells]);
  const b = JSON.stringify([...assemble(p).cells]);
  assert.equal(a, b);
  const r = mulberry32(1);
  assert.ok(r() >= 0 && r() < 1);
});

test("combination count multiplies variants, roofs, floor counts and depths", () => {
  const p = sampleProject(); // 2 × 2 × 2 variants, 3 roofs, floors 3..8, depth 9 only
  assert.deepEqual(comboCount(p), { n: 144, r: 6, roofs: 3, depths: 1 });
  p.depthMax = 12; // depths 9..12
  assert.deepEqual(comboCount(p), { n: 576, r: 6, roofs: 3, depths: 4 });
  p.roofs = []; // no roof styles: flat tops, roofs count as one
  assert.equal(comboCount(p).n, 192);
});
