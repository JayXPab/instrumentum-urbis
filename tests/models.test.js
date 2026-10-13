// Tests for reading Minecraft's block descriptions in src/core/models.js. Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { pickModels, resolveModel, textureOf, swatchTexture, modelFile, textureFile, blockstateFile, tintOf, frontLayers } from "../src/core/models.js";

// Cut-down copies of the real 1.21 files.
const FILES = {
  "models/block/block.json": { textures: { particle: "#all" } },
  "models/block/cube.json": { parent: "block/block", elements: [{ from: [0, 0, 0], to: [16, 16, 16] }] },
  "models/block/cube_all.json": {
    parent: "block/cube",
    textures: { particle: "#all", down: "#all", up: "#all", north: "#all", south: "#all", east: "#all", west: "#all" },
  },
  "models/block/bricks.json": { parent: "minecraft:block/cube_all", textures: { all: "minecraft:block/bricks" } },
  "models/block/stairs.json": { parent: "block/block", textures: { particle: "#side" }, elements: [{ from: [0, 0, 0], to: [16, 8, 16] }] },
  "models/block/brick_stairs.json": {
    parent: "minecraft:block/stairs",
    textures: { bottom: "minecraft:block/bricks", side: "minecraft:block/bricks", top: "minecraft:block/bricks" },
  },
  "models/block/quartz_pillar.json": {
    parent: "minecraft:block/cube_column",
    textures: { end: "minecraft:block/quartz_pillar_top", side: "minecraft:block/quartz_pillar" },
  },
  "models/block/cube_column.json": { parent: "block/cube", textures: { particle: "#side" } },
};
const load = async (f) => {
  if (!(f in FILES)) throw new Error("missing " + f);
  return FILES[f];
};

const STAIRS = {
  variants: {
    "facing=east,half=bottom,shape=straight": { model: "minecraft:block/brick_stairs" },
    "facing=east,half=bottom,shape=inner_left": { model: "minecraft:block/brick_stairs_inner", y: 270, uvlock: true },
    "facing=north,half=top,shape=straight": { model: "minecraft:block/brick_stairs", x: 180, y: 270, uvlock: true },
  },
};

test("file names from model, texture and block names", () => {
  assert.equal(modelFile("minecraft:block/stairs"), "models/block/stairs.json");
  assert.equal(modelFile("block/cube"), "models/block/cube.json");
  assert.equal(textureFile("minecraft:block/bricks"), "textures/block/bricks.png");
  assert.equal(blockstateFile("minecraft:oak_stairs"), "blockstates/oak_stairs.json");
});

test("a variant is picked by the stored properties; missing ones match anything", () => {
  assert.deepEqual(pickModels(STAIRS, { facing: "north", half: "top" }), [{ model: "minecraft:block/brick_stairs", x: 180, y: 270, uvlock: true }]);
  // No shape stored: straight and inner_left both fit; the first fitting one wins.
  assert.equal(pickModels(STAIRS, { facing: "east", half: "bottom" })[0].model, "minecraft:block/brick_stairs");
  assert.equal(pickModels(STAIRS, { facing: "east", half: "bottom", shape: "inner_left" })[0].y, 270);
  // No properties at all: still gives a model.
  assert.equal(pickModels(STAIRS, {}).length, 1);
  // A plain block.
  assert.deepEqual(pickModels({ variants: { "": { model: "minecraft:block/bricks" } } }, {}), [{ model: "minecraft:block/bricks" }]);
});

test("a variant with several random models gives the first", () => {
  const bs = { variants: { "": [{ model: "minecraft:block/stone" }, { model: "minecraft:block/stone_mirrored", y: 180 }] } };
  assert.deepEqual(pickModels(bs, {}), [{ model: "minecraft:block/stone" }]);
});

test("multipart blocks collect every part that applies", () => {
  const pane = {
    multipart: [
      { apply: { model: "minecraft:block/glass_pane_post" } },
      { when: { north: "true" }, apply: { model: "minecraft:block/glass_pane_side" } },
      { when: { OR: [{ east: "true" }, { west: "true" }] }, apply: { model: "minecraft:block/glass_pane_side", y: 90 } },
      { when: { north: "false|none" }, apply: { model: "minecraft:block/glass_pane_noside" } },
    ],
  };
  assert.deepEqual(pickModels(pane, { north: "true", east: "false", west: "false" }).map((m) => m.model), [
    "minecraft:block/glass_pane_post",
    "minecraft:block/glass_pane_side",
  ]);
  assert.equal(pickModels(pane, { north: "false", east: "true" }).length, 3);
});

test("a model's parents are followed: textures merge, nearest elements win", async () => {
  const m = await resolveModel("minecraft:block/brick_stairs", load);
  assert.equal(m.textures.side, "minecraft:block/bricks");
  assert.equal(m.textures.particle, "#side"); // from the stairs parent
  assert.deepEqual(m.elements, [{ from: [0, 0, 0], to: [16, 8, 16] }]); // the stairs' own, not block's
  const b = await resolveModel("minecraft:block/bricks", load);
  assert.equal(b.textures.all, "minecraft:block/bricks");
  assert.deepEqual(b.elements, [{ from: [0, 0, 0], to: [16, 16, 16] }]); // from cube
  assert.equal(textureOf(b.textures, "#north"), "minecraft:block/bricks");
});

test("texture references are followed, and a dangling one gives null", () => {
  assert.equal(textureOf({ particle: "#side", side: "#all", all: "minecraft:block/x" }, "#particle"), "minecraft:block/x");
  assert.equal(textureOf({ a: "#b" }, "#a"), null);
  assert.equal(textureOf({ a: "#a" }, "#a"), null); // loops stop
});

test("the swatch texture prefers the side over the end", async () => {
  const m = await resolveModel("minecraft:block/quartz_pillar", load);
  assert.equal(swatchTexture(m.textures), "minecraft:block/quartz_pillar");
  assert.equal(swatchTexture((await resolveModel("minecraft:block/brick_stairs", load)).textures), "minecraft:block/bricks");
  assert.equal(swatchTexture({}), null);
});

test("grass and leaves get the forest colours; other blocks none", () => {
  assert.equal(tintOf("minecraft:grass_block"), "#79c05a");
  assert.equal(tintOf("minecraft:oak_leaves"), "#59ae30");
  assert.equal(tintOf("minecraft:birch_leaves"), "#80a755"); // fixed in every biome
  assert.equal(tintOf("minecraft:bricks"), null);
  assert.equal(tintOf("minecraft:cherry_leaves"), null); // already coloured in its texture
});

test("front layers: a grass block is its side plus the tinted fringe; only marked faces are tinted", () => {
  const grass = {
    textures: { side: "minecraft:block/grass_block_side", overlay: "minecraft:block/grass_block_side_overlay", top: "minecraft:block/grass_block_top" },
    elements: [
      { faces: { up: { texture: "#top", tintindex: 0 }, north: { texture: "#side" } } },
      { faces: { north: { texture: "#overlay", tintindex: 0 } } },
    ],
  };
  assert.deepEqual(frontLayers(grass, "minecraft:grass_block"), [
    { texture: "minecraft:block/grass_block_side", tint: null },
    { texture: "minecraft:block/grass_block_side_overlay", tint: "#79c05a" },
  ]);
  // Stairs: two elements with the same front texture give one layer.
  const stairs = { textures: { side: "minecraft:block/bricks" }, elements: [{ faces: { north: { texture: "#side" } } }, { faces: { north: { texture: "#side" } } }] };
  assert.deepEqual(frontLayers(stairs, "minecraft:brick_stairs"), [{ texture: "minecraft:block/bricks", tint: null }]);
  // A marked face on a block without a tint stays as it is.
  const odd = { textures: { all: "minecraft:block/x" }, elements: [{ faces: { north: { texture: "#all", tintindex: 0 } } }] };
  assert.deepEqual(frontLayers(odd, "minecraft:stone"), [{ texture: "minecraft:block/x", tint: null }]);
  // No elements: falls back to the swatch texture.
  assert.deepEqual(frontLayers({ textures: { all: "minecraft:block/y" }, elements: null }, "minecraft:y"), [{ texture: "minecraft:block/y", tint: null }]);
});
