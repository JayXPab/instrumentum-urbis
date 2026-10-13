// Tests for schematic import in src/core/import.js. Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync, gunzipSync } from "node:zlib";
import { readSchematicFile } from "../src/core/import.js";
import { toSchem, connectPanes } from "../src/core/schem.js";
import { toLitematic } from "../src/core/litematic.js";
import { blueprintParts, packBlueprint } from "../src/core/blueprint.js";
import { assemble } from "../src/core/assemble.js";
import { nbt, TAG, writeNbt, varints } from "../src/core/nbt.js";
import { packTight } from "../src/core/litematic.js";
import { fullState, parseState } from "../src/core/blocks.js";
import { K } from "../src/core/facade.js";
import { sampleProject } from "../src/core/sample.js";

const gunzip = (b) => gunzipSync(b);
/** The sample building's blocks, as our exporters write them. */
const expected = (p, full) => {
  const m = new Map();
  for (const [k, s] of connectPanes(assemble(p).cells)) m.set(k, full ? fullState(s) : s);
  return m;
};

test("a .schem we exported reads back block for block", async () => {
  const p = sampleProject();
  const r = await readSchematicFile("facade.schem", gzipSync(toSchem(p).bytes), gunzip);
  assert.equal(r.format, "schem");
  assert.equal(r.name, "facade");
  assert.deepEqual(r.blocks, expected(p, false));
});

test("a .litematic we exported reads back block for block", async () => {
  const p = sampleProject();
  const r = await readSchematicFile("facade.litematic", gzipSync(toLitematic(p).bytes), gunzip);
  assert.equal(r.format, "litematic");
  assert.deepEqual(r.blocks, expected(p, true));
});

test("a .bp we exported reads back block for block", async () => {
  const p = sampleProject();
  p.assembly.floors = 8; // more than one section high
  const parts = blueprintParts(p);
  const file = packBlueprint(parts.header, new Uint8Array([137, 80, 78, 71]), gzipSync(parts.blocks));
  const r = await readSchematicFile("facade.bp", file, gunzip);
  assert.equal(r.format, "bp");
  assert.deepEqual(r.blocks, expected(p, true));
});

test("older Sponge version 2 schematics are read too", async () => {
  // 2 × 1 × 1: stone bricks then air; palette and data at the top level
  const root = nbt.compound({
    Version: nbt.int(2), DataVersion: nbt.int(3700),
    Width: nbt.short(2), Height: nbt.short(1), Length: nbt.short(1),
    PaletteMax: nbt.int(2),
    Palette: nbt.compound({ "minecraft:air": nbt.int(0), "minecraft:stone_bricks": nbt.int(1) }),
    BlockData: nbt.byteArray(varints([1, 0])),
  });
  const r = await readSchematicFile("old.schem", gzipSync(writeNbt(root, "Schematic")), gunzip);
  assert.deepEqual([...r.blocks], [[K(0, 0, 0), "minecraft:stone_bricks"]]);
});

test("Litematica regions with negative sizes and several regions are placed correctly", async () => {
  const region = (pos, size, states) => {
    const names = ["minecraft:air", ...new Set(states)];
    const ids = states.map((s) => names.indexOf(s));
    const xyz = ([x, y, z]) => nbt.compound({ x: nbt.int(x), y: nbt.int(y), z: nbt.int(z) });
    return nbt.compound({
      Position: xyz(pos), Size: xyz(size),
      BlockStatePalette: nbt.list(TAG.Compound, names.map((n) => nbt.compound({ Name: nbt.string(n) }))),
      BlockStates: nbt.longArray(packTight(ids, Math.max(2, Math.ceil(Math.log2(names.length))))),
    });
  };
  const root = nbt.compound({
    Version: nbt.int(7),
    Regions: nbt.compound({
      // Size −2 in x: covers x = 4 and x = 3 (Position back toward smaller x)
      A: region([4, 0, 0], [-2, 1, 1], ["minecraft:bricks", "minecraft:stone_bricks"]),
      B: region([0, 5, 0], [1, 1, 1], ["minecraft:glass"]),
    }),
  });
  const r = await readSchematicFile("x.litematic", gzipSync(writeNbt(root)), gunzip);
  assert.equal(r.blocks.get(K(3, 0, 0)), "minecraft:bricks");
  assert.equal(r.blocks.get(K(4, 0, 0)), "minecraft:stone_bricks");
  assert.equal(r.blocks.get(K(0, 5, 0)), "minecraft:glass");
  assert.equal(r.blocks.size, 3);
});

test("air, void air and structure voids are left out; unknown blocks are kept as they are", async () => {
  const root = nbt.compound({
    Version: nbt.int(2), Width: nbt.short(4), Height: nbt.short(1), Length: nbt.short(1),
    Palette: nbt.compound({
      "minecraft:cave_air": nbt.int(0), "minecraft:structure_void": nbt.int(1),
      "minecraft:lantern[hanging=true]": nbt.int(2), "minecraft:void_air": nbt.int(3),
    }),
    BlockData: nbt.byteArray(varints([0, 1, 2, 3])),
  });
  const r = await readSchematicFile("a.schem", writeNbt(root, "Schematic"), gunzip); // not gzipped: also fine
  assert.deepEqual([...r.blocks], [[K(2, 0, 0), "minecraft:lantern[hanging=true]"]]);
  assert.equal(parseState(r.blocks.get(K(2, 0, 0))).props.hanging, "true");
});

test("files that aren't schematics are refused with a clear message", async () => {
  await assert.rejects(readSchematicFile("x.schem", gzipSync(writeNbt(nbt.compound({ Foo: nbt.int(1) }))), gunzip), /isn't a WorldEdit, Litematica or Axiom/);
  await assert.rejects(readSchematicFile("x.bp", new Uint8Array([1, 2, 3, 4, 5]), gunzip), /Not an Axiom blueprint/);
});
