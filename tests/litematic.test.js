// Tests for the Litematica export in src/core/litematic.js. Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readNbt } from "../src/core/nbt.js";
import { toLitematic, packTight, unpackTight, litematicBits } from "../src/core/litematic.js";
import { assemble } from "../src/core/assemble.js";
import { K } from "../src/core/facade.js";
import { parseState, makeState } from "../src/core/blocks.js";
import { sampleProject } from "../src/core/sample.js";

/** Reads a .litematic back into "x,y,z" (paste-point coordinates) -> block state. */
function decode(bytes) {
  const root = readNbt(bytes).root.value;
  const [name, region] = Object.entries(root.Regions.value)[0];
  const R = region.value;
  const pos = ["x", "y", "z"].map((k) => R.Position.value[k].value);
  const [W, H, L] = ["x", "y", "z"].map((k) => R.Size.value[k].value);
  const names = R.BlockStatePalette.value.map((e) => {
    const props = e.value.Properties ? Object.fromEntries(Object.entries(e.value.Properties.value).map(([k, v]) => [k, v.value])) : {};
    return makeState(e.value.Name.value, props);
  });
  const ids = unpackTight(R.BlockStates.value, litematicBits(names.length), W * H * L);
  const cells = new Map();
  ids.forEach((id, i) => {
    if (names[id] === "minecraft:air") return;
    const y = Math.floor(i / (W * L)), z = Math.floor((i % (W * L)) / W), x = i % W;
    cells.set(K(x + pos[0], y + pos[1], z + pos[2]), names[id]);
  });
  return { root, name, R, W, H, L, names, cells, longs: R.BlockStates.value.length };
}

test("bits per entry: at least 2, then enough for the palette", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 8, 9, 17, 300].map(litematicBits), [2, 2, 2, 2, 3, 3, 4, 5, 9]);
});

test("tight packing lets an entry run on into the next long, as Litematica does", () => {
  // 3 bits: entry 21 starts at bit 63 and runs into the second long
  const vals = Array.from({ length: 50 }, (_, i) => (i * 5) % 8);
  const longs = packTight(vals, 3);
  assert.equal(longs.length, Math.ceil((50 * 3) / 64));
  assert.deepEqual(unpackTight(longs, 3, 50), vals);
  // Litematica's own maths for entry 21: start long 0 bit 63, end long 1
  const u = longs.map((l) => BigInt.asUintN(64, l));
  const v21 = Number(((u[0] >> 63n) | (u[1] << 1n)) & 7n);
  assert.equal(v21, vals[21]);
  // Every 64-bit pattern stays a valid signed long
  assert.ok(longs.every((l) => l >= -(2n ** 63n) && l < 2n ** 63n));
});

test("the file has Litematica's header and metadata", () => {
  const p = sampleProject();
  const { root, name, W, H, L } = decode(toLitematic(p).bytes);
  assert.equal(root.Version.value, 7);
  assert.equal(root.SubVersion.value, 1);
  assert.equal(root.MinecraftDataVersion.value, 4671);
  const m = root.Metadata.value;
  assert.equal(m.Name.value, name);
  assert.equal(m.RegionCount.value, 1);
  assert.equal(m.TotalVolume.value, W * H * L);
  assert.deepEqual(["x", "y", "z"].map((k) => m.EnclosingSize.value[k].value), [W, H, L]);
  assert.equal(m.PreviewImageData, undefined, "no preview unless one is given");
});

test("every block lands where the assembled building has it; air is entry 0", () => {
  const p = sampleProject();
  p.assembly.floors = 6;
  const built = assemble(p).cells;
  const { cells, names, R } = decode(toLitematic(p).bytes);
  assert.equal(names[0], "minecraft:air");
  assert.equal(cells.size, built.size);
  assert.equal(readNbt(toLitematic(p).bytes).root.value.Metadata.value.TotalBlocks.value, built.size);
  for (const [k, c] of built) assert.equal(parseState(cells.get(k)).id, parseState(c.s).id, "block at " + k);
  for (const key of ["TileEntities", "Entities", "PendingBlockTicks", "PendingFluidTicks"]) assert.ok(R[key], key);
});

test("the paste point is the schematic's origin: the region sits at its lowest corner", () => {
  const p = sampleProject();
  const r = toLitematic(p);
  const { R, cells } = decode(r.bytes);
  assert.deepEqual(["x", "y", "z"].map((k) => R.Position.value[k].value), r.offset);
  assert.equal(r.offset[0], -Math.floor(p.width / 2));
  assert.ok(cells.has(K(0, 0, 0)), "Core Wall block at the paste point");
});

test("blocks are written with every property filled in", () => {
  const { names } = decode(toLitematic(sampleProject()).bytes);
  const stair = names.find((s) => s.includes("_stairs"));
  assert.match(stair, /shape=straight/);
  assert.match(stair, /waterlogged=false/);
});

test("an optional preview picture goes into the metadata", () => {
  const px = Array.from({ length: 16 }, (_, i) => (0xff000000 | (i * 0x111111)) | 0);
  const m = readNbt(toLitematic(sampleProject(), px).bytes).root.value.Metadata.value;
  assert.deepEqual(m.PreviewImageData.value, px);
});
