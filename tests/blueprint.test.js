// Tests for the Axiom .bp export in src/core/blueprint.js. Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync, gunzipSync } from "node:zlib";
import { readNbt } from "../src/core/nbt.js";
import { blueprintParts, packBlueprint, unpackBlueprint, packSection, sectionBits, BP_MAGIC } from "../src/core/blueprint.js";
import { assemble } from "../src/core/assemble.js";
import { K } from "../src/core/facade.js";
import { parseState, makeState, fullState } from "../src/core/blocks.js";
import { sampleProject } from "../src/core/sample.js";

/** Unpacks a section's palette + long array back into 4096 block states. */
function unpackSection(tag) {
  const names = tag.value.palette.value.map((e) => {
    const props = e.value.Properties ? Object.fromEntries(Object.entries(e.value.Properties.value).map(([k, v]) => [k, v.value])) : {};
    return makeState(e.value.Name.value, props);
  });
  if (!tag.value.data) return new Array(4096).fill(names[0]);
  const bits = sectionBits(names.length);
  const perLong = Math.floor(64 / bits);
  const longs = tag.value.data.value.map((v) => BigInt.asUintN(64, v));
  return Array.from({ length: 4096 }, (_, i) =>
    names[Number((longs[Math.floor(i / perLong)] >> BigInt((i % perLong) * bits)) & ((1n << BigInt(bits)) - 1n))]);
}

/** Builds a full .bp the way the editor does, with a stand-in thumbnail. */
function makeBp(p) {
  const parts = blueprintParts(p);
  return { parts, file: packBlueprint(parts.header, Uint8Array.from([137, 80, 78, 71]), gzipSync(parts.blocks)) };
}

test("missing block properties get Minecraft's defaults", () => {
  assert.equal(fullState("minecraft:stone_brick_stairs[facing=east,half=top]"),
    "minecraft:stone_brick_stairs[facing=east,half=top,shape=straight,waterlogged=false]");
  assert.equal(fullState("minecraft:quartz_pillar"), "minecraft:quartz_pillar[axis=y]");
  assert.equal(fullState("minecraft:bricks"), "minecraft:bricks");
  assert.equal(fullState("minecraft:something_new[a=b]"), "minecraft:something_new[a=b]");
});

test("section bit width follows Minecraft: 0 for one entry, at least 4, then log2", () => {
  assert.deepEqual([1, 2, 16, 17, 32, 33, 300].map(sectionBits), [0, 4, 4, 5, 5, 6, 9]);
});

test("a section packs entries without straddling longs", () => {
  const cells = new Array(4096).fill("minecraft:void_air");
  cells[0] = "minecraft:bricks";
  cells[4095] = "minecraft:stone_bricks";
  const tag = packSection(cells);
  assert.equal(tag.value.data.value.length, 256); // 4 bits, 16 per long
  assert.deepEqual(unpackSection(tag), cells);
  // 17 distinct blocks need 5 bits: 12 per long, 342 longs
  const many = cells.map((_, i) => "minecraft:b" + (i % 17));
  const t2 = packSection(many);
  assert.equal(t2.value.data.value.length, Math.ceil(4096 / 12));
  assert.deepEqual(unpackSection(t2), many);
});

test("a section of one block has no data array", () => {
  const tag = packSection(new Array(4096).fill("minecraft:void_air"));
  assert.equal(tag.value.data, undefined);
  assert.equal(tag.value.palette.value.length, 1);
});

test("the .bp file has the magic number, header, thumbnail and gzipped blocks", () => {
  const { file } = makeBp(sampleProject());
  assert.equal(new DataView(file.buffer).getInt32(0), BP_MAGIC);
  const { header, thumbnail, gzBlocks } = unpackBlueprint(file);
  const h = readNbt(header).root.value;
  assert.equal(h.Version.value, 2);
  assert.equal(h.Name.value, "Shopfront / Three windows / Cornice / Slate gable, 5 floors");
  assert.deepEqual([...thumbnail], [137, 80, 78, 71]);
  assert.equal(readNbt(gunzipSync(gzBlocks)).root.value.DataVersion.value, 4671);
});

test("every block of the building lands in the right section and cell", () => {
  const p = sampleProject();
  p.assembly.floors = 8; // tall enough to cross into a second section
  const { file, parts } = makeBp(p);
  const root = readNbt(gunzipSync(unpackBlueprint(file).gzBlocks)).root.value;
  const got = new Map();
  for (const r of root.BlockRegion.value) {
    const { X, Y, Z, BlockStates } = r.value;
    unpackSection(BlockStates).forEach((s, i) => {
      if (s === "minecraft:void_air") return;
      const x = X.value * 16 + (i & 15), z = Z.value * 16 + ((i >> 4) & 15), y = Y.value * 16 + (i >> 8);
      got.set(K(x, y, z), s);
    });
  }
  const built = assemble(p).cells;
  assert.ok(parts.sections >= 2);
  assert.equal(got.size, built.size);
  assert.equal(readNbt(unpackBlueprint(file).header).root.value.BlockCount.value, built.size);
  for (const [k, c] of built) assert.equal(parseState(got.get(k)).id, parseState(c.s).id, "block at " + k);
  // Negative coordinates (left of centre, behind the Core Wall) survive
  assert.ok([...got.keys()].some((k) => k.startsWith("-")));
});
