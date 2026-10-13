// Block catalogue and block-state helpers.
// Pure data + functions: no DOM, no three.js. Safe to port to Java later.
//
// Colours are flat approximations used only for the editor preview;
// they are not Minecraft textures.

/** @typedef {{group:string, id:string, name:string, color:string, shape:"cube"|"stairs"|"slab"|"pane"|"plant", opacity:number}} BlockDef */

/** @type {BlockDef[]} */
export const BLOCKS = [
  ["Masonry", "minecraft:stone_bricks", "Stone Bricks", "#7c7c7a", "cube"],
  ["Masonry", "minecraft:bricks", "Bricks", "#94604f", "cube"],
  ["Masonry", "minecraft:mud_bricks", "Mud Bricks", "#8a6a50", "cube"],
  ["Masonry", "minecraft:deepslate_bricks", "Deepslate Bricks", "#4a4a4d", "cube"],
  ["Masonry", "minecraft:polished_blackstone_bricks", "Blackstone Bricks", "#38323b", "cube"],
  ["Stone", "minecraft:polished_andesite", "Polished Andesite", "#878a88", "cube"],
  ["Stone", "minecraft:smooth_stone", "Smooth Stone", "#a0a0a0", "cube"],
  ["Stone", "minecraft:quartz_block", "Quartz Block", "#ebe5dd", "cube"],
  ["Stone", "minecraft:quartz_pillar", "Quartz Pillar", "#e4ddd3", "cube"],
  ["Stone", "minecraft:smooth_sandstone", "Smooth Sandstone", "#dcd2a3", "cube"],
  ["Stone", "minecraft:white_terracotta", "White Terracotta", "#cfb1a1", "cube"],
  ["Stone", "minecraft:terracotta", "Terracotta", "#975c42", "cube"],
  ["Stone", "minecraft:white_concrete", "White Concrete", "#cfd4d5", "cube"],
  ["Stone", "minecraft:packed_mud", "Packed Mud", "#8e6c55", "cube"],
  ["Wood", "minecraft:oak_planks", "Oak Planks", "#a3844f", "cube"],
  ["Wood", "minecraft:spruce_planks", "Spruce Planks", "#735632", "cube"],
  ["Wood", "minecraft:dark_oak_planks", "Dark Oak Planks", "#46301a", "cube"],
  ["Accent", "minecraft:copper_block", "Copper Block", "#c06d50", "cube"],
  ["Accent", "minecraft:oxidized_copper", "Oxidized Copper", "#55a18c", "cube"],
  ["Glass", "minecraft:glass_pane", "Glass Pane", "#a9d3df", "pane", 0.45],
  ["Glass", "minecraft:light_gray_stained_glass_pane", "Light Gray Glass Pane", "#8c9497", "pane", 0.6],
  ["Glass", "minecraft:glass", "Glass", "#c3e2ea", "cube", 0.35],
  ["Stairs", "minecraft:stone_brick_stairs", "Stone Brick Stairs", "#7c7c7a", "stairs"],
  ["Stairs", "minecraft:quartz_stairs", "Quartz Stairs", "#ebe5dd", "stairs"],
  ["Stairs", "minecraft:smooth_sandstone_stairs", "Sandstone Stairs", "#dcd2a3", "stairs"],
  ["Stairs", "minecraft:dark_oak_stairs", "Dark Oak Stairs", "#46301a", "stairs"],
  ["Stairs", "minecraft:brick_stairs", "Brick Stairs", "#94604f", "stairs"],
  ["Slabs", "minecraft:stone_brick_slab", "Stone Brick Slab", "#7c7c7a", "slab"],
  ["Slabs", "minecraft:smooth_stone_slab", "Smooth Stone Slab", "#a0a0a0", "slab"],
  ["Slabs", "minecraft:quartz_slab", "Quartz Slab", "#ebe5dd", "slab"],
  ["Slabs", "minecraft:dark_oak_slab", "Dark Oak Slab", "#46301a", "slab"],
  ["Slabs", "minecraft:brick_slab", "Brick Slab", "#94604f", "slab"],
  // Roof materials: each full block has matching stairs and slab (see MATERIALS).
  ["Roof", "minecraft:deepslate_tiles", "Deepslate Tiles", "#36363a", "cube"],
  ["Roof", "minecraft:deepslate_tile_stairs", "Deepslate Tile Stairs", "#36363a", "stairs"],
  ["Roof", "minecraft:deepslate_tile_slab", "Deepslate Tile Slab", "#36363a", "slab"],
  ["Roof", "minecraft:spruce_stairs", "Spruce Stairs", "#735632", "stairs"],
  ["Roof", "minecraft:spruce_slab", "Spruce Slab", "#735632", "slab"],
  ["Roof", "minecraft:waxed_cut_copper", "Waxed Cut Copper", "#bf6b51", "cube"],
  ["Roof", "minecraft:waxed_cut_copper_stairs", "Waxed Cut Copper Stairs", "#bf6b51", "stairs"],
  ["Roof", "minecraft:waxed_cut_copper_slab", "Waxed Cut Copper Slab", "#bf6b51", "slab"],
  ["Roof", "minecraft:waxed_oxidized_cut_copper", "Waxed Oxidized Cut Copper", "#4f9e8a", "cube"],
  ["Roof", "minecraft:waxed_oxidized_cut_copper_stairs", "Waxed Oxidized Cut Copper Stairs", "#4f9e8a", "stairs"],
  ["Roof", "minecraft:waxed_oxidized_cut_copper_slab", "Waxed Oxidized Cut Copper Slab", "#4f9e8a", "slab"],
  ["Roof", "minecraft:polished_blackstone_brick_stairs", "Blackstone Brick Stairs", "#38323b", "stairs"],
  ["Roof", "minecraft:polished_blackstone_brick_slab", "Blackstone Brick Slab", "#38323b", "slab"],
  ["Roof", "minecraft:mud_brick_stairs", "Mud Brick Stairs", "#8a6a50", "stairs"],
  ["Roof", "minecraft:mud_brick_slab", "Mud Brick Slab", "#8a6a50", "slab"],
  // Garden roofs
  ["Garden", "minecraft:grass_block", "Grass Block", "#5d8c3a", "cube"],
  ["Garden", "minecraft:short_grass", "Short Grass", "#6a9a3e", "plant"],
  ["Garden", "minecraft:tall_grass", "Tall Grass", "#6a9a3e", "plant"],
  ["Garden", "minecraft:poppy", "Poppy", "#c0302a", "plant"],
  ["Garden", "minecraft:dandelion", "Dandelion", "#e8d23a", "plant"],
  ["Garden", "minecraft:cornflower", "Cornflower", "#4a6ad8", "plant"],
  ["Garden", "minecraft:oxeye_daisy", "Oxeye Daisy", "#e4e4da", "plant"],
  ["Garden", "minecraft:allium", "Allium", "#a860d0", "plant"],
  ["Garden", "minecraft:azure_bluet", "Azure Bluet", "#d0dae4", "plant"],
  ["Garden", "minecraft:red_tulip", "Red Tulip", "#d03030", "plant"],
  ["Garden", "minecraft:white_tulip", "White Tulip", "#ececec", "plant"],
  ["Garden", "minecraft:lily_of_the_valley", "Lily of the Valley", "#f4f4f4", "plant"],
  ["Garden", "minecraft:azalea", "Azalea", "#5a7d2a", "plant"],
  ["Garden", "minecraft:flowering_azalea", "Flowering Azalea", "#7d8d4a", "plant"],
].map(([group, id, name, color, shape, opacity]) => ({ group, id, name, color, shape, opacity: opacity ?? 1 }));

/** @type {Record<string, BlockDef>} */
export const BMAP = Object.fromEntries(BLOCKS.map((b) => [b.id, b]));

/**
 * Roof materials: a full block with its matching stairs and slab.
 * @typedef {{id:string, name:string, block:string, stairs:string, slab:string}} Material
 * @type {Material[]}
 */
export const MATERIALS = [
  ["deepslate_tiles", "Deepslate Tiles", "deepslate_tiles", "deepslate_tile_stairs", "deepslate_tile_slab"],
  ["bricks", "Bricks", "bricks", "brick_stairs", "brick_slab"],
  ["stone_bricks", "Stone Bricks", "stone_bricks", "stone_brick_stairs", "stone_brick_slab"],
  ["dark_oak", "Dark Oak", "dark_oak_planks", "dark_oak_stairs", "dark_oak_slab"],
  ["spruce", "Spruce", "spruce_planks", "spruce_stairs", "spruce_slab"],
  ["copper", "Copper", "waxed_cut_copper", "waxed_cut_copper_stairs", "waxed_cut_copper_slab"],
  ["oxidized_copper", "Oxidized Copper", "waxed_oxidized_cut_copper", "waxed_oxidized_cut_copper_stairs", "waxed_oxidized_cut_copper_slab"],
  ["blackstone", "Blackstone Bricks", "polished_blackstone_bricks", "polished_blackstone_brick_stairs", "polished_blackstone_brick_slab"],
  ["mud_bricks", "Mud Bricks", "mud_bricks", "mud_brick_stairs", "mud_brick_slab"],
].map(([id, name, block, stairs, slab]) => ({
  id, name, block: "minecraft:" + block, stairs: "minecraft:" + stairs, slab: "minecraft:" + slab,
}));
/** @type {Record<string, Material>} */
export const MMAP = Object.fromEntries(MATERIALS.map((m) => [m.id, m]));

/**
 * Splits a block state string such as
 * "minecraft:stone_brick_stairs[facing=north,half=top]" into id + props.
 * @param {string} s
 */
export function parseState(s) {
  const m = /^([^\[]+)(?:\[(.*)\])?$/.exec(s);
  /** @type {Record<string,string>} */
  const props = {};
  if (m && m[2]) {
    for (const p of m[2].split(",")) {
      const [k, v] = p.split("=");
      props[k] = v;
    }
  }
  return { id: m ? m[1] : s, props };
}

/** @param {string} id @param {Record<string,string>} [props] */
export function makeState(id, props) {
  const ks = Object.keys(props || {});
  return ks.length ? id + "[" + ks.map((k) => k + "=" + props[k]).join(",") + "]" : id;
}

export const shortId = (/** @type {string} */ id) => id.replace("minecraft:", "");

/** Minecraft's default value for each property the editor may leave out, by shape. */
const SHAPE_DEFAULTS = {
  stairs: { facing: "north", half: "bottom", shape: "straight", waterlogged: "false" },
  slab: { type: "bottom", waterlogged: "false" },
  pane: { north: "false", south: "false", east: "false", west: "false", waterlogged: "false" },
  cube: {},
  plant: {},
};
/** Blocks whose properties differ from the rest of their shape. */
const ID_DEFAULTS = {
  "minecraft:quartz_pillar": { axis: "y" },
  "minecraft:grass_block": { snowy: "false" },
  "minecraft:tall_grass": { half: "lower" },
};

/**
 * Fills in every property Minecraft expects, keeping the ones already set.
 * Blocks not in the catalogue are returned unchanged.
 */
export function fullState(s) {
  const { id, props } = parseState(s);
  const d = BMAP[id];
  if (!d) return s;
  const all = { ...SHAPE_DEFAULTS[d.shape], ...ID_DEFAULTS[id], ...props };
  return makeState(id, all);
}

/** Mirrors a block state across the x axis: east <-> west, and stair corner shapes left <-> right. */
export function mirrorState(s) {
  const { id, props } = parseState(s);
  if (props.facing === "east") props.facing = "west";
  else if (props.facing === "west") props.facing = "east";
  if (props.shape) props.shape = props.shape.replace(/left|right/, (m) => (m === "left" ? "right" : "left"));
  // Side connections (panes, walls) swap sides too.
  if ("east" in props || "west" in props) {
    const e = props.east, w = props.west;
    delete props.east; delete props.west;
    if (w !== undefined) props.east = w;
    if (e !== undefined) props.west = e;
  }
  return makeState(id, props);
}

/** One quarter turn anticlockwise seen from above: north -> west -> south -> east -> north. */
const TURN = { north: "west", west: "south", south: "east", east: "north" };

/**
 * Turns a block state by quarter turns anticlockwise (seen from above).
 * Facing, axis and side connections all turn; stair shapes stay as they are.
 */
export function rotateState(s, turns = 1) {
  let { id, props } = parseState(s);
  for (let t = 0; t < ((turns % 4) + 4) % 4; t++) {
    const next = {};
    for (const [k, v] of Object.entries(props)) {
      if (k === "facing") next.facing = TURN[v] || v;
      else if (k === "axis") next.axis = v === "x" ? "z" : v === "z" ? "x" : v;
      else if (k in TURN) next[TURN[k]] = v;
      else next[k] = v;
    }
    props = next;
  }
  return makeState(id, props);
}
