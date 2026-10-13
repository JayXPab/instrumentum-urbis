// Tests for colour variants. Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { BMAP, BLOCKS, COLOURS, COLOUR_FAMILIES, isColourSlot, recolour } from "../src/core/blocks.js";
import { slotsIn, colourLists, buildingColours } from "../src/core/colour.js";
import { assemble, comboCount, buildingTitle } from "../src/core/assemble.js";
import { chooseCombos, forCombo, indexCsv } from "../src/core/bulk.js";
import { schemName } from "../src/core/schem.js";
import { upgradeProject } from "../src/core/project.js";
import { K } from "../src/core/facade.js";
import { sampleProject } from "../src/core/sample.js";

test("all 16 colours of the five colourable families are in the catalogue, once each", () => {
  assert.equal(COLOURS.length, 16);
  for (const [fam] of COLOUR_FAMILIES)
    for (const c of COLOURS) assert.ok(BMAP[`minecraft:${c}_${fam}`], `${c}_${fam}`);
  const ids = BLOCKS.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicates");
  assert.equal(BMAP["minecraft:red_carpet"].shape, "carpet");
});

test("only the white blocks of those families are colour slots", () => {
  for (const s of ["minecraft:white_wool", "minecraft:white_terracotta", "minecraft:white_concrete", "minecraft:white_concrete_powder", "minecraft:white_carpet"])
    assert.ok(isColourSlot(s), s);
  for (const s of ["minecraft:red_wool", "minecraft:terracotta", "minecraft:white_stained_glass", "minecraft:white_glazed_terracotta", "minecraft:bricks"])
    assert.ok(!isColourSlot(s), s);
});

test("recolouring changes a slot's colour and nothing else", () => {
  assert.equal(recolour("minecraft:white_wool", "red"), "minecraft:red_wool");
  assert.equal(recolour("minecraft:white_concrete_powder", "light_blue"), "minecraft:light_blue_concrete_powder");
  assert.equal(recolour("minecraft:white_carpet", "white"), "minecraft:white_carpet");
  assert.equal(recolour("minecraft:bricks", "red"), "minecraft:bricks");
  assert.equal(recolour("minecraft:red_wool", "blue"), "minecraft:red_wool", "only white is a slot");
});

/** The sample with white concrete in every body variant and a white wool awning in every base. */
const colourful = () => {
  const p = sampleProject();
  for (const v of p.stages.body) v.blocks[K(0, 1, 0)] = "minecraft:white_concrete";
  for (const v of p.stages.base) v.blocks[K(-1, 4, 2)] = "minecraft:white_wool";
  return p;
};
const at = (p, x, y, z) => assemble(p).cells.get(K(x, y, z))?.s;

test("colour slots are found per stage", () => {
  assert.deepEqual(slotsIn(sampleProject()), { base: false, rest: false });
  assert.deepEqual(slotsIn(colourful()), { base: true, rest: true });
});

test("colour variants are off by default: nothing changes", () => {
  const p = colourful();
  assert.deepEqual(colourLists(p), { main: [null], base: [null] });
  assert.equal(comboCount(p).n, 144);
  assert.equal(at(p, 0, 6, 0), "minecraft:white_concrete");
});

test("one colour per building recolours every white slot, base included", () => {
  const p = colourful();
  p.colours = { on: true, list: ["red", "blue"] };
  p.assembly.colour = "red";
  assert.equal(at(p, 0, 6, 0), "minecraft:red_concrete", "body slot");
  assert.equal(at(p, -1, 4, 2), "minecraft:red_wool", "base awning takes the same colour");
  assert.equal(comboCount(p).n, 144 * 2);
  assert.equal(schemName(p), "facade_b1-b1-c1-r1_5fl_red");
  assert.match(buildingTitle(p), /, red$/);
});

test("the base can have its own colour; combinations multiply main × base", () => {
  const p = colourful();
  p.colours = { on: true, list: ["red", "blue"], baseOn: true, baseList: ["white", "green", "yellow"] };
  p.assembly.colour = "blue";
  p.assembly.baseColour = "green";
  assert.equal(at(p, 0, 6, 0), "minecraft:blue_concrete");
  assert.equal(at(p, -1, 4, 2), "minecraft:green_wool");
  assert.equal(comboCount(p).n, 144 * 2 * 3);
  const all = chooseCombos(p);
  assert.equal(new Set(all.map((c) => [c.base, c.body, c.capital, c.roof, c.floors, c.colour, c.baseColour].join())).size, all.length);
  assert.equal(schemName(p), "facade_b1-b1-c1-r1_5fl_blue_base-green");
  assert.match(buildingTitle(p), /, blue, green base$/);
  const q = forCombo(p, all.find((c) => c.colour === "red" && c.baseColour === "yellow"));
  assert.match(indexCsv([{ file: "x", p: q, blocks: 1 }]).split("\r\n")[1], /,red,yellow,\d+,1$/);
});

test("a colour only counts where it has white blocks to colour", () => {
  const p = colourful();
  for (const v of p.stages.body) delete v.blocks[K(0, 1, 0)]; // only the base has slots now
  p.colours = { on: true, list: ["red", "blue"], baseOn: true, baseList: ["green"] };
  assert.deepEqual(colourLists(p), { main: [null], base: ["green"] }, "main colour has nothing to colour");
  p.colours.baseOn = false;
  assert.deepEqual(colourLists(p), { main: ["blue", "red"], base: [null] }, "main colours the base instead (Minecraft order)");
});

test("an unticked colour isn't used; nothing ticked falls back to white", () => {
  const p = colourful();
  p.colours = { on: true, list: [] };
  assert.deepEqual(colourLists(p).main, ["white"]);
  p.colours.list = ["red"];
  p.assembly.colour = "blue"; // not ticked
  assert.equal(buildingColours(p).main, "red");
});

test("older projects load with colour variants off", () => {
  const p = sampleProject();
  delete p.colours; delete p.assembly.colour; delete p.assembly.baseColour;
  upgradeProject(p);
  assert.equal(p.colours.on, false);
  assert.equal(p.colours.list.length, 16);
  assert.equal(p.assembly.colour, "white");
});
