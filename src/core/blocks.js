// Block catalogue and block-state helpers.
// Pure data + functions: no DOM, no three.js. Safe to port to Java later.
//
// Colours are flat approximations used only for the editor preview;
// they are not Minecraft textures.

/** @typedef {{group:string, id:string, name:string, color:string, shape:"cube"|"stairs"|"slab"|"pane", opacity:number}} BlockDef */

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
].map(([group, id, name, color, shape, opacity]) => ({ group, id, name, color, shape, opacity: opacity ?? 1 }));

/** @type {Record<string, BlockDef>} */
export const BMAP = Object.fromEntries(BLOCKS.map((b) => [b.id, b]));

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
};
/** Blocks whose properties differ from the rest of their shape. */
const ID_DEFAULTS = { "minecraft:quartz_pillar": { axis: "y" } };

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

/** Mirrors a block state across the x axis (east <-> west). */
export function mirrorState(s) {
  const { id, props } = parseState(s);
  if (props.facing === "east") props.facing = "west";
  else if (props.facing === "west") props.facing = "east";
  return makeState(id, props);
}
