// Tests for turning Minecraft models into faces (modelQuads in src/core/models.js). Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { modelQuads, blockQuads, faceShade } from "../src/core/models.js";

const ALL = ["down", "up", "north", "south", "west", "east"];
const cube = (from, to, extra = {}) => ({ from, to, faces: Object.fromEntries(ALL.map((d) => [d, { texture: "#t", cullface: d, ...extra }])) });
const T = { t: "minecraft:block/bricks" };
const box = (q) => {
  const lo = [0, 1, 2].map((i) => Math.min(...q.points.map((p) => p[i])));
  const hi = [0, 1, 2].map((i) => Math.max(...q.points.map((p) => p[i])));
  return [lo.map((v) => Math.round(v * 100) / 100), hi.map((v) => Math.round(v * 100) / 100)];
};

test("a full cube gives six faces, shaded like the game", () => {
  const qs = modelQuads({ textures: T, elements: [cube([0, 0, 0], [16, 16, 16])] });
  assert.deepEqual(qs.map((q) => q.dir), ALL);
  assert.deepEqual(qs.map((q) => q.shade), [0.5, 1, 0.8, 0.8, 0.6, 0.6]);
  assert.equal(faceShade([0, 1, 0]), 1);
  for (const q of qs) assert.equal(q.texture, "minecraft:block/bricks");
  // Default texture areas cover the whole texture.
  const south = qs.find((q) => q.dir === "south");
  assert.deepEqual(south.uvs, [[0, 0], [16, 0], [16, 16], [0, 16]]);
  assert.deepEqual(south.points[0], [0, 16, 16], "top-left seen from the street");
});

test("default texture areas follow the element's size", () => {
  // A bottom slab's side shows the lower half of the texture.
  const [, , n] = modelQuads({ textures: T, elements: [cube([0, 0, 0], [16, 8, 16])] });
  assert.deepEqual(n.uvs, [[0, 8], [16, 8], [16, 16], [0, 16]]);
});

test("a stair's step turns with the blockstate's y", () => {
  const stair = { textures: T, elements: [cube([0, 0, 0], [16, 8, 16]), cube([8, 8, 0], [16, 16, 16])] };
  const step = (y) => box(modelQuads(stair, { y }).filter((q) => q.dir === "up")[1]);
  assert.deepEqual(step(0), [[8, 16, 0], [16, 16, 16]], "east");
  assert.deepEqual(step(90), [[0, 16, 8], [16, 16, 16]], "south");
  assert.deepEqual(step(180), [[0, 16, 0], [8, 16, 16]], "west");
  assert.deepEqual(step(270), [[0, 16, 0], [16, 16, 8]], "north");
  // Upside down (x = 180): the slab part moves to the top.
  const top = modelQuads(stair, { x: 180 });
  // The slab's bottom face is now its top.
  assert.deepEqual(box(top[0]), [[0, 16, 0], [16, 16, 16]]);
  assert.equal(top[0].dir, "up");
  // Hidden-face directions turn too.
  assert.equal(modelQuads(stair, { y: 90 }).find((q) => q.dir === "south").cull, "south");
});

test("uvlock keeps the texture in place while the model turns", () => {
  const slabSide = { textures: T, elements: [cube([0, 0, 0], [16, 8, 16])] };
  const top = modelQuads(slabSide, { x: 180, uvlock: true });
  // The slab is now at the top; its north side shows the top half of the texture.
  const n = top.find((q) => q.dir === "north");
  assert.deepEqual(n.uvs.map(([, v]) => v).sort(), [0, 0, 8, 8]);
});

test("element rotation leans a wall torch away from its wall", () => {
  const torch = { textures: T, elements: [{
    from: [-1, 3.5, 7], to: [1, 13.5, 9], shade: false,
    rotation: { origin: [0, 3.5, 8], axis: "z", angle: -22.5 },
    faces: { up: { texture: "#t", uv: [7, 6, 9, 8] } },
  }] };
  const [up] = modelQuads(torch);
  assert.ok(Math.min(...up.points.map((p) => p[0])) > 2, "the top leans toward +x");
  assert.equal(up.shade, 1, "shade: false");
  assert.deepEqual(up.uvs, [[7, 6], [9, 6], [9, 8], [7, 8]]);
});

test("face rotation turns the texture area", () => {
  const [q] = modelQuads({ textures: T, elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { up: { texture: "#t", rotation: 90 } } }] });
  assert.deepEqual(q.uvs, [[0, 16], [0, 0], [16, 0], [16, 16]]);
});

test("tinted faces get the block's colour; faces without a texture are left out", () => {
  const files = {
    "blockstates/grass_block.json": { variants: { "snowy=false": { model: "minecraft:block/grass_block" }, "snowy=true": { model: "minecraft:block/grass_block_snow" } } },
    "models/block/grass_block.json": {
      textures: { top: "minecraft:block/grass_block_top", side: "minecraft:block/grass_block_side" },
      elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { up: { texture: "#top", tintindex: 0 }, north: { texture: "#side" }, south: { texture: "#missing" } } }],
    },
  };
  return blockQuads("minecraft:grass_block", { snowy: "false" }, async (f) => files[f]).then((qs) => {
    assert.equal(qs.length, 2);
    assert.equal(qs[0].tint, "#79c05a");
    assert.equal(qs[1].tint, null);
  });
});

test("multipart blocks draw every part that applies", async () => {
  const files = {
    "blockstates/oak_fence.json": { multipart: [
      { apply: { model: "minecraft:block/post" } },
      { when: { east: "true" }, apply: { model: "minecraft:block/side", y: 90, uvlock: true } },
    ] },
    "models/block/post.json": { textures: T, elements: [cube([6, 0, 6], [10, 16, 10])] },
    "models/block/side.json": { textures: T, elements: [cube([7, 12, 0], [9, 15, 9])] },
  };
  const load = async (f) => files[f];
  assert.equal((await blockQuads("minecraft:oak_fence", { east: "false" }, load)).length, 6);
  assert.equal((await blockQuads("minecraft:oak_fence", { east: "true" }, load)).length, 12);
});

test("blocks the game draws in code stand in as a box in their particle texture", async () => {
  const files = {
    "blockstates/chest.json": { variants: { "": { model: "minecraft:block/chest" } } },
    "models/block/chest.json": { textures: { particle: "minecraft:block/oak_planks" } },
  };
  const qs = await blockQuads("minecraft:chest", {}, async (f) => files[f]);
  assert.equal(qs.length, 6);
  assert.equal(qs[0].texture, "minecraft:block/oak_planks");
});
