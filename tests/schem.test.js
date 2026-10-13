// Tests for the .schem export in src/core/schem.js. Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readNbt, readVarints } from "../src/core/nbt.js";
import { toSchem, connectPanes, schemName } from "../src/core/schem.js";
import { assemble } from "../src/core/assemble.js";
import { K } from "../src/core/facade.js";
import { parseState } from "../src/core/blocks.js";
import { sampleProject } from "../src/core/sample.js";

/** Reads a schematic back into a map of "x,y,z" (paste-point coordinates) -> block state. */
function decode(bytes) {
  const S = readNbt(bytes).root.value.Schematic.value;
  const W = S.Width.value, H = S.Height.value, L = S.Length.value;
  const [ox, oy, oz] = S.Offset.value;
  const names = [];
  for (const [s, t] of Object.entries(S.Blocks.value.Palette.value)) names[t.value] = s;
  const ids = readVarints(S.Blocks.value.Data.value);
  const cells = new Map();
  ids.forEach((id, i) => {
    if (names[id] === "minecraft:air") return;
    const y = Math.floor(i / (W * L)), z = Math.floor((i % (W * L)) / W), x = i % W;
    cells.set(K(x + ox, y + oy, z + oz), names[id]);
  });
  return { S, W, H, L, cells, count: ids.length };
}

test("the schematic header says Sponge v3 for Minecraft 1.21.11", () => {
  const { S } = decode(toSchem(sampleProject()).bytes);
  assert.equal(S.Version.value, 3);
  assert.equal(S.DataVersion.value, 4671);
  assert.equal(S.Blocks.value.Palette.value["minecraft:air"].value, 0);
});

test("every block lands where the assembled building has it", () => {
  const p = sampleProject();
  p.assembly.floors = 5;
  const built = assemble(p).cells;
  const { cells, W, H, L, count } = decode(toSchem(p).bytes);
  assert.equal(count, W * H * L);
  assert.equal(H, assemble(p).top); // roof included
  assert.equal(cells.size, built.size);
  for (const [k, c] of built) {
    // Panes gain connection properties; everything else is copied as is.
    assert.equal(parseState(cells.get(k)).id, parseState(c.s).id, "block at " + k);
  }
});

test("the paste point is the bottom of the Core Wall's centre column", () => {
  const p = sampleProject();
  const r = toSchem(p);
  assert.equal(r.offset[0], -Math.floor(p.width / 2)); // left edge of the facade
  assert.equal(r.offset[1], 0);
  const { cells } = decode(r.bytes);
  assert.ok(cells.has(K(0, 0, 0)), "Core Wall block at the paste point");
});

test("glass panes connect to panes and full blocks, not to air", () => {
  const cells = new Map([
    [K(0, 0, 0), { s: "minecraft:glass_pane" }],
    [K(-1, 0, 0), { s: "minecraft:stone_bricks" }],
    [K(1, 0, 0), { s: "minecraft:glass_pane" }],
    [K(0, 0, 1), { s: "minecraft:stone_brick_slab[type=top]" }],
  ]);
  const out = connectPanes(cells);
  assert.deepEqual(parseState(out.get(K(0, 0, 0))).props, { north: "false", south: "false", east: "true", west: "true" });
  assert.equal(out.get(K(-1, 0, 0)), "minecraft:stone_bricks");
});

test("file names count variants from 1", () => {
  const p = sampleProject();
  p.assembly.base = 0; p.assembly.body = 1; p.assembly.capital = 0; p.assembly.floors = 4;
  assert.equal(schemName(p), "facade_b1-b2-c1-r1_4fl");
  p.assembly.roof = 2;
  assert.equal(schemName(p), "facade_b1-b2-c1-r3_4fl");
  p.roofs = []; // no roof styles: no -r part
  assert.equal(schemName(p), "facade_b1-b2-c1_4fl");
});

test("an unsupported Minecraft version is refused", () => {
  const p = sampleProject();
  p.mcVersion = "1.0";
  assert.throws(() => toSchem(p), /Unsupported/);
});
