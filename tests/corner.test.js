// Tests for corner buildings in src/core/corner.js. Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { stairQuarters, stairFromQuarters, mergeStairs, cornerOf, outsideChamfer } from "../src/core/corner.js";
import { rotateState, mirrorState, parseState } from "../src/core/blocks.js";
import { assemble, buildingDepth } from "../src/core/assemble.js";
import { K, bounds } from "../src/core/facade.js";
import { sampleProject } from "../src/core/sample.js";

const corner = (type, chamfer = 2) => {
  const p = sampleProject();
  p.roofs = [];
  p.assembly.type = type;
  p.types = { chamfer };
  p.assembly.floors = 3;
  return p;
};
const at = (A, x, y, z) => A.cells.get(K(x, y, z))?.s;
const props = (s) => parseState(s).props;

test("blocks turn a quarter turn anticlockwise", () => {
  assert.equal(rotateState("minecraft:stone_brick_stairs[facing=north,half=top]"), "minecraft:stone_brick_stairs[facing=west,half=top]");
  assert.equal(rotateState("minecraft:stone_brick_stairs[facing=south]"), "minecraft:stone_brick_stairs[facing=east]");
  assert.equal(rotateState("minecraft:quartz_pillar[axis=x]"), "minecraft:quartz_pillar[axis=z]");
  assert.deepEqual(props(rotateState("minecraft:glass_pane[north=true,east=false,south=false,west=false]")),
    { west: "true", north: "false", east: "false", south: "false" });
  assert.equal(rotateState("minecraft:bricks[facing=east]", 4), "minecraft:bricks[facing=east]");
});

test("mirroring swaps stair corner shapes left and right", () => {
  assert.equal(props(mirrorState("minecraft:quartz_stairs[facing=east,shape=outer_left]")).shape, "outer_right");
  assert.equal(props(mirrorState("minecraft:quartz_stairs[facing=east,shape=outer_left]")).facing, "west");
  assert.deepEqual(props(mirrorState("minecraft:glass_pane[east=true,west=false]")), { east: "false", west: "true" });
});

test("stair quarters match Minecraft's corner shapes", () => {
  assert.deepEqual([...stairQuarters("north")].sort(), ["NE", "NW"]);
  assert.deepEqual([...stairQuarters("north", "outer_left")], ["NW"]);
  assert.deepEqual([...stairQuarters("north", "outer_right")], ["NE"]);
  assert.deepEqual([...stairQuarters("north", "inner_left")].sort(), ["NE", "NW", "SW"]);
  assert.deepEqual(stairFromQuarters(new Set(["NW"])).shape.startsWith("outer"), true);
  assert.equal(stairFromQuarters(new Set(["NE", "SW"])), null, "opposite quarters are no stair");
});

test("two stairs merge: overlap gives an outer corner, joining gives an inner corner", () => {
  const n = "minecraft:stone_brick_stairs[facing=north,half=top]";
  const w = "minecraft:stone_brick_stairs[facing=west,half=top]";
  const outer = props(mergeStairs(n, w, "intersect"));
  assert.match(outer.shape, /^outer/);
  assert.deepEqual([...stairQuarters(outer.facing, outer.shape)], ["NW"]);
  const inner = props(mergeStairs(n, w, "union"));
  assert.match(inner.shape, /^inner/);
  assert.equal(mergeStairs(n, "minecraft:stone_brick_stairs[facing=west,half=bottom]", "union"), null, "top and bottom don't merge");
  assert.equal(mergeStairs(n, "minecraft:bricks", "union"), null);
});

test("a corner building is square, with one column shared by both facades", () => {
  const p = corner("cr");
  assert.equal(buildingDepth(p), p.width);
  const A = assemble(p);
  const b = bounds(p);
  const front = sampleProject(); // the same facade, mid-row
  front.roofs = []; front.assembly.floors = 3;
  const F = assemble(front);
  for (let y = 0; y < A.height; y++) {
    // Front facade unchanged
    for (let x = b.xMin; x < b.xMax; x++) assert.equal(at(A, x, y, 0), at(F, x, y, 0), `front ${x},${y}`);
    // Side facade: the front's columns turned onto x = xMax, from z = 0 back
    for (let i = 1; i < p.width; i++) {
      const s = at(F, b.xMin + i, y, 0);
      assert.equal(at(A, b.xMax, y, -i), s && rotateState(s), `side ${i},${y}`);
    }
  }
});

test("the side facade's ornament faces the side street, its recesses point inward", () => {
  const A = assemble(corner("cr"));
  const xm = bounds(corner("cr")).xMax;
  // Base cornice: stairs one block out from the side wall, facing back toward it (west)
  const st = at(A, xm + 1, 4, -3);
  assert.equal(props(st).facing, "west");
  // Ground-floor windows sit one block behind the side wall
  assert.match(at(A, xm - 1, 2, -2), /glass_pane/);
});

test("ornament on both corner columns continues round the corner", () => {
  const A = assemble(corner("cr"));
  const xm = 3;
  assert.match(props(at(A, xm + 1, 4, 1)).shape, /^outer/, "base cornice meets in an outer corner stair");
  assert.match(at(A, xm + 1, 0, 1), /slab/, "plinth turns the corner");
  assert.ok(at(A, xm + 2, 11, 2) && at(A, xm + 1, 11, 2) && at(A, xm + 2, 11, 1), "two-deep capital mitred");
});

test("no party wall on the corner side; the other side and back keep theirs", () => {
  const p = corner("cr");
  const A = assemble(p);
  const party = [...A.cells].filter(([, c]) => c.kind === "party").map(([k]) => k.split(",").map(Number));
  const b = bounds(p);
  assert.ok(party.some(([x]) => x === b.xMin), "inner side wall");
  assert.ok(!party.some(([x, , z]) => x === b.xMax && z > -(p.width - 1)), "no wall on the side street");
  assert.ok(party.some(([, , z]) => z === -(p.width - 1)), "back wall");
});

test("a left corner is the mirror image of a right corner built from the mirrored facade", () => {
  const A = assemble(corner("cl"));
  const xm = bounds(corner("cl")).xMin;
  assert.equal(props(at(A, xm - 1, 4, -3)).facing, "east");
  assert.match(props(at(A, xm - 1, 4, 1)).shape, /^outer/);
  assert.match(at(A, xm + 1, 2, -2), /glass_pane/);
});

test("a chamfer cuts the corner and closes it with a stepped diagonal wall", () => {
  for (const c of [1, 2, 3]) {
    const p = corner("cr-ch", c);
    assert.equal(cornerOf(p).chamfer, c);
    const A = assemble(p);
    const xm = 3;
    // The old corner column is gone
    assert.equal(at(A, xm, 2, 0), undefined, "corner column cut, chamfer " + c);
    // Wall steps: (i − 1, i) and (i, i) measured from the cut
    for (let i = 1; i <= c; i++) assert.ok(at(A, xm - c + i - 1, 1, -i), `step ${i}, chamfer ${c}`);
    // Nothing is left outside the diagonal
    for (const k of A.cells.keys()) {
      const [x, , z] = k.split(",").map(Number);
      if (A.cells.get(k).kind === "party") continue;
      const band = x - (xm - c) - -z === 1; // the band of ornament along the steps
      assert.ok(!outsideChamfer(p, c, x, z) || band, `stray block at ${k}, chamfer ${c}`);
    }
  }
});

test("the base cornice follows the chamfer as inner corner stairs", () => {
  const A = assemble(corner("cr-ch", 2));
  assert.match(props(at(A, 2, 4, 0)).shape, /^inner/);
  assert.match(props(at(A, 3, 4, -1)).shape, /^inner/);
});
