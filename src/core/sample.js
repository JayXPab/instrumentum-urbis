// The sample facade the editor opens with: two variants per stage.

import { makeState } from "./blocks.js";
import { K, newVariant } from "./facade.js";
import { bulkDefaults } from "./bulk.js";
import { roofDefaults } from "./roof.js";

export function sampleProject() {
  const p = {
    format: "instrumentum-urbis/facade",
    formatVersion: 1,
    mcVersion: "1.21.11",
    width: 7,
    depthFront: 2,
    depthBack: 1,
    heights: { base: 5, body: 4, capital: 3 },
    coreBlock: "minecraft:stone_bricks",
    stages: { base: [], body: [], capital: [] },
    floorMin: 3,
    floorMax: 8,
    buildingDepth: 9,
    partyWall: [
      { block: "minecraft:bricks", weight: 3 },
      { block: "minecraft:mud_bricks", weight: 1 },
      { block: "minecraft:terracotta", weight: 1 },
    ],
    assembly: { base: 0, body: 0, capital: 0, roof: 0, floors: 5, seed: 7 },
    roofs: [
      roofDefaults({ name: "Slate gable", type: "gable", height: 4, edge: 1 }),
      roofDefaults({
        name: "Copper mansard", type: "mansard", height: 6,
        bands: [
          { mix: [{ material: "oxidized_copper", weight: 3 }, { material: "copper", weight: 1 }] },
          { mix: [{ material: "deepslate_tiles", weight: 1 }] },
        ],
      }),
      roofDefaults({ name: "Roof garden", type: "garden", parapetBlock: "minecraft:stone_bricks", density: 0.45 }),
    ],
    bulk: bulkDefaults(),
  };
  const S = (v, x, y, z, s) => {
    if (s) v.blocks[K(x, y, z)] = s;
    else delete v.blocks[K(x, y, z)];
  };
  const xs = [-3, -2, -1, 0, 1, 2, 3];
  const stairTop = (id) => makeState(id, { facing: "north", half: "top" });
  const slab = (id, t) => makeState(id, { type: t });

  // Base A: shopfront
  let v = newVariant(p, "base", "Shopfront");
  for (const x of xs) S(v, x, 0, 1, slab("minecraft:smooth_stone_slab", "bottom"));
  for (const x of xs) S(v, x, 4, 1, stairTop("minecraft:stone_brick_stairs"));
  for (const x of [-2, -1, 1, 2])
    for (let y = 1; y <= 3; y++) {
      S(v, x, y, 0, null);
      S(v, x, y, -1, "minecraft:glass_pane");
    }
  for (let y = 1; y <= 3; y++) S(v, 0, y, 0, null);
  S(v, 0, 1, -1, "minecraft:dark_oak_planks");
  S(v, 0, 2, -1, "minecraft:dark_oak_planks");
  S(v, 0, 3, -1, "minecraft:glass_pane");
  p.stages.base.push(v);

  // Base B: quartz colonnade
  v = newVariant(p, "base", "Colonnade");
  for (const x of xs) S(v, x, 0, 0, "minecraft:polished_andesite");
  for (const x of [-2, 0, 2])
    for (let y = 1; y <= 3; y++) {
      S(v, x, y, 0, null);
      S(v, x, y, -1, x === 0 && y < 3 ? "minecraft:spruce_planks" : "minecraft:glass_pane");
    }
  for (const x of [-3, -1, 1, 3]) for (let y = 0; y <= 3; y++) S(v, x, y, 1, "minecraft:quartz_pillar");
  for (const x of xs) S(v, x, 4, 1, slab("minecraft:quartz_slab", "top"));
  p.stages.base.push(v);

  // Body A: three windows
  p.coreBlock = "minecraft:bricks";
  v = newVariant(p, "body", "Three windows");
  for (const x of [-2, 0, 2]) {
    for (let y = 1; y <= 2; y++) {
      S(v, x, y, 0, null);
      S(v, x, y, -1, "minecraft:glass_pane");
    }
    S(v, x, 0, 1, slab("minecraft:stone_brick_slab", "top"));
    S(v, x, 3, 0, "minecraft:stone_bricks");
  }
  for (const x of [-3, 3]) for (let y = 0; y < 4; y++) S(v, x, y, 1, "minecraft:stone_bricks");
  p.stages.body.push(v);

  // Body B: paired windows with a centre pilaster
  v = newVariant(p, "body", "Paired windows");
  for (const x of [-2, -1, 1, 2]) {
    for (let y = 1; y <= 2; y++) {
      S(v, x, y, 0, null);
      S(v, x, y, -1, "minecraft:glass_pane");
    }
    S(v, x, 0, 1, slab("minecraft:stone_brick_slab", "top"));
  }
  for (let y = 0; y < 4; y++) S(v, 0, y, 1, "minecraft:quartz_pillar");
  p.stages.body.push(v);

  // Capital A: cornice
  p.coreBlock = "minecraft:stone_bricks";
  v = newVariant(p, "capital", "Cornice");
  for (const x of xs) {
    S(v, x, 0, 1, "minecraft:polished_andesite");
    S(v, x, 1, 1, stairTop("minecraft:stone_brick_stairs"));
    S(v, x, 2, 1, "minecraft:stone_bricks");
    S(v, x, 2, 2, slab("minecraft:stone_brick_slab", "bottom"));
  }
  p.stages.capital.push(v);

  // Capital B: parapet
  p.coreBlock = "minecraft:bricks";
  v = newVariant(p, "capital", "Parapet");
  for (const x of xs) {
    S(v, x, 0, 1, slab("minecraft:stone_brick_slab", "top"));
    S(v, x, 1, 1, slab("minecraft:quartz_slab", "top"));
    S(v, x, 2, 0, null);
  }
  for (const x of [-3, -1, 1, 3]) S(v, x, 2, 0, "minecraft:stone_bricks");
  p.stages.capital.push(v);

  p.coreBlock = "minecraft:stone_bricks";
  return p;
}
