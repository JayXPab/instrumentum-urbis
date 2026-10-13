// Tests for schematic import in src/core/import.js. Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync, gunzipSync } from "node:zlib";
import { readSchematicFile, guessSettings, planImport, applyImport, turnBlocks } from "../src/core/import.js";
import { toSchem, connectPanes } from "../src/core/schem.js";
import { toLitematic } from "../src/core/litematic.js";
import { blueprintParts, packBlueprint } from "../src/core/blueprint.js";
import { assemble } from "../src/core/assemble.js";
import { nbt, TAG, writeNbt, varints } from "../src/core/nbt.js";
import { packTight } from "../src/core/litematic.js";
import { fullState, parseState, rotateState } from "../src/core/blocks.js";
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

/* ---------- turning blocks into variants ---------- */


/** The sample as a plain facade: no roof, no party walls, 3 floors (base, one body, capital). */
const plainFacade = () => {
  const p = sampleProject();
  p.roofs = [];
  p.partyWall = [];
  p.assembly.floors = 3;
  return p;
};
/** Blocks by id only (exports add pane connections the editor doesn't store). */
const ids = (blocks) => Object.fromEntries(Object.entries(blocks).map(([k, s]) => [k, parseState(s).id]).sort());
const importedFrom = async (p) => readSchematicFile("shop.schem", gzipSync(toSchem(p).bytes), gunzip);

test("a whole facade imports back as the base, body and capital it was built from", async () => {
  const p = plainFacade();
  const imp = await importedFrom(p);
  const s = guessSettings(imp.blocks, p);
  assert.equal(s.core, 0, "Core Wall guessed as the fullest layer");
  assert.deepEqual([s.left, s.right], [-3, 3]);
  assert.deepEqual([s.mode, s.baseH, s.bodyH, s.capH], ["facade", 5, 4, 3]);
  const plan = planImport(imp, s, p);
  assert.equal(plan.messages[0][0], "ok");
  assert.deepEqual(plan.variants.map((v) => [v.kind, v.name, v.height]), [["base", "shop base", 5], ["body", "shop body", 4], ["capital", "shop capital", 3]]);
  assert.deepEqual(ids(plan.variants[0].blocks), ids(p.stages.base[0].blocks));
  assert.deepEqual(ids(plan.variants[1].blocks), ids(p.stages.body[0].blocks));
  assert.deepEqual(ids(plan.variants[2].blocks), ids(p.stages.capital[0].blocks));
  const before = p.stages.body.length;
  applyImport(p, plan);
  assert.equal(p.stages.body.length, before + 1);
  assert.equal(p.stages.body.at(-1).name, "shop body");
});

test("a facade built facing another way is turned to face the street", async () => {
  const p = plainFacade();
  const imp = await importedFrom(p);
  // Pretend it was built facing east: turn it a quarter turn clockwise (three anticlockwise)
  const east = { ...imp, blocks: turnBlocks(imp.blocks, 3) };
  const s = guessSettings(east.blocks, p, 1); // one turn anticlockwise brings it back
  assert.deepEqual(ids(planImport(east, s, p).variants[0].blocks), ids(p.stages.base[0].blocks));
  assert.equal(turnBlocks(new Map([[K(0, 0, -1), "minecraft:stone_brick_stairs[facing=north]"]]), 1).get(K(-1, 0, 0)),
    rotateState("minecraft:stone_brick_stairs[facing=north]", 1), "positions and states turn together");
});

test("a narrower import is padded with the Core Wall; a wider one is trimmed evenly", async () => {
  const p = plainFacade();
  const imp = await importedFrom(p);
  const wide = plainFacade();
  wide.width = 9;
  const s = guessSettings(imp.blocks, wide);
  const plan = planImport(imp, s, wide);
  assert.ok(plan.messages.some(([t, m]) => t === "warn" && m.includes("2 columns padded")));
  assert.equal(plan.variants[1].blocks[K(-4, 0, 0)], wide.coreBlock, "left pad");
  assert.equal(plan.variants[1].blocks[K(4, 0, 0)], wide.coreBlock, "right pad");
  const narrow = plainFacade();
  narrow.width = 5; narrow.depthFront = 2; narrow.depthBack = 1;
  const planN = planImport(imp, guessSettings(imp.blocks, narrow), narrow);
  assert.ok(planN.messages.some(([t, m]) => t === "warn" && m.includes("2 columns trimmed")));
  assert.ok(Object.keys(planN.variants[1].blocks).every((k) => Math.abs(+k.split(",")[0]) <= 2));
});

test("depth grows to fit the import, up to the depth rule; deeper blocks are cut", async () => {
  const p = plainFacade();
  p.depthFront = 1; // the sample's ornament reaches 2 out
  const imp = await importedFrom(plainFacade());
  imp.blocks.set(K(0, 6, 7), "minecraft:bricks"); // far beyond the rule (3 at width 7)
  const plan = planImport(imp, guessSettings(imp.blocks, p), p);
  assert.equal(plan.depthFront, 2);
  assert.ok(plan.messages.some(([, m]) => m.includes("Front depth will go from 1 to 2")));
  assert.ok(plan.messages.some(([t, m]) => t === "warn" && m.includes("1 block deeper than the depth rule")));
  applyImport(p, plan);
  assert.equal(p.depthFront, 2);
});

test("one stage at a time: the rows you choose become one variant", async () => {
  const p = plainFacade();
  const imp = await importedFrom(p);
  const s = { ...guessSettings(imp.blocks, p), mode: "stage", stage: "body", bottom: 5, top: 8 };
  const plan = planImport(imp, s, p);
  assert.deepEqual(plan.variants.map((v) => [v.kind, v.name, v.height]), [["body", "shop", 4]]);
  assert.deepEqual(ids(plan.variants[0].blocks), ids(p.stages.body[0].blocks));
});

test("a stage with variants keeps its height, or changes it if you choose", async () => {
  const p = plainFacade();
  const imp = await importedFrom(p);
  const s = { ...guessSettings(imp.blocks, p), mode: "stage", stage: "base", bottom: 0, top: 3 }; // 4 rows, base is 5
  const plan = planImport(imp, s, p);
  assert.deepEqual(plan.heightChanges, [{ kind: "base", from: 5, to: 4 }]);

  const crop = plainFacade();
  applyImport(crop, planImport(imp, s, crop), "crop");
  assert.equal(crop.heights.base, 5);
  assert.equal(crop.stages.base.at(-1).blocks[K(0, 4, 0)], crop.coreBlock, "padded to 5 rows with the Core Wall");

  const grow = plainFacade();
  const oldBase = structuredClone(grow.stages.base[0].blocks);
  applyImport(grow, planImport(imp, s, grow), "stage");
  assert.equal(grow.heights.base, 4);
  assert.ok(Object.keys(grow.stages.base[0].blocks).every((k) => +k.split(",")[1] < 4), "other variants trimmed");
  assert.ok(Object.keys(oldBase).some((k) => +k.split(",")[1] === 4), "they did have a fifth row");
});

test("an empty stage simply takes the import's height", async () => {
  const p = plainFacade();
  p.stages.capital = [];
  const imp = await importedFrom(plainFacade());
  const s = { ...guessSettings(imp.blocks, p), capH: 2 };
  const plan = planImport(imp, s, p);
  assert.ok(plan.messages.some(([, m]) => m.includes("Capital height will be 2")));
  applyImport(p, plan);
  assert.equal(p.heights.capital, 2);
});

test("impossible settings are refused with a reason", async () => {
  const p = plainFacade();
  const imp = await importedFrom(p);
  const s = { ...guessSettings(imp.blocks, p), bodyH: 6 }; // body runs into the capital
  const plan = planImport(imp, s, p);
  assert.ok(plan.messages.some(([t, m]) => t === "err" && m.includes("overlaps the capital")));
  assert.throws(() => applyImport(p, plan), /Fix the problems/);
});
