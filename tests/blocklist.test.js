import test from "node:test";
import assert from "node:assert/strict";
import { BLOCKS, BMAP, BLOCK_PROPS, ALL_GROUP, fullState, placeDefaults } from "../src/core/blocks.js";

test("every block of 1.21.11 is in the catalogue, once", () => {
  const ids = BLOCKS.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(Object.keys(BLOCK_PROPS).length, 1162);
  for (const id of Object.keys(BLOCK_PROPS)) assert.ok(BMAP[id], id);
  for (const id of ["minecraft:oak_door", "minecraft:lantern", "minecraft:pale_oak_leaves", "minecraft:chiseled_tuff_bricks"])
    assert.equal(BMAP[id].group, ALL_GROUP, id);
  assert.ok(!BMAP["minecraft:air"], "air is never placed");
});

test("the hand-picked blocks are real blocks of the game", () => {
  for (const b of BLOCKS) assert.ok(BLOCK_PROPS[b.id], b.id);
});

test("blocks get a drawing shape from their name and size", () => {
  assert.equal(BMAP["minecraft:andesite_stairs"].shape, "stairs");
  assert.equal(BMAP["minecraft:tuff_slab"].shape, "slab");
  assert.equal(BMAP["minecraft:iron_bars"].shape, "pane");
  assert.equal(BMAP["minecraft:cobblestone"].shape, "cube");
  assert.equal(BMAP["minecraft:torch"].shape, "plant");
  assert.equal(BMAP["minecraft:oak_door"].shape, "other");
});

test("properties come with the game's defaults, default first", () => {
  assert.deepEqual(BLOCK_PROPS["minecraft:oak_door"].map((p) => p.name), ["facing", "half", "hinge", "open", "powered"]);
  assert.deepEqual(BLOCK_PROPS["minecraft:light"][0].values.slice(0, 2), ["15", "0"]);
  assert.equal(fullState("minecraft:oak_door[half=upper]"),
    "minecraft:oak_door[facing=north,half=upper,hinge=left,open=false,powered=false]");
  assert.equal(fullState("minecraft:lantern"), "minecraft:lantern[hanging=false,waterlogged=false]");
});

test("leaves are placed so they never decay", () => {
  assert.equal(placeDefaults("minecraft:oak_leaves").persistent, "true");
  assert.equal(placeDefaults("minecraft:oak_stairs").facing, "north");
  assert.deepEqual(placeDefaults("minecraft:something_new"), {});
});
