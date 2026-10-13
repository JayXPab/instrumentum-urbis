// Tests for colour variants. Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { BMAP, BLOCKS, COLOURS, COLOUR_FAMILIES, isColourSlot, recolour } from "../src/core/blocks.js";

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
