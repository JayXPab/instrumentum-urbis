// Reading Minecraft's own block descriptions: which model a block state uses
// (blockstates/*.json), what that model looks like after following its parents
// (models/block/*.json), and which texture files it paints with.
//
// The files come from the user's game jar (the desktop app copies them out);
// none are shipped. Pure functions: no DOM, no three.js. This is for drawing
// blocks in the editor only, so the in-game mod won't need it.

/** "minecraft:block/stone" or "block/stone" -> "block/stone" */
const bare = (name) => name.replace(/^minecraft:/, "");

/** The file a model name lives in: "minecraft:block/stairs" -> "models/block/stairs.json". */
export const modelFile = (name) => `models/${bare(name)}.json`;

/** The file a texture name lives in: "minecraft:block/bricks" -> "textures/block/bricks.png". */
export const textureFile = (name) => `textures/${bare(name)}.png`;

/** The blockstate file for a block id: "minecraft:oak_stairs" -> "blockstates/oak_stairs.json". */
export const blockstateFile = (id) => `blockstates/${bare(id)}.json`;

/** "facing=east,half=bottom" -> { facing: "east", half: "bottom" }; "" -> {}. */
function keyProps(key) {
  const out = {};
  for (const part of key.split(",")) {
    if (!part) continue;
    const [k, v] = part.split("=");
    out[k] = v;
  }
  return out;
}

/** Whether a multipart "when" applies to these properties ("a|b" means either; OR lists any). */
function whenMatches(when, props) {
  if (!when) return true;
  if (when.OR) return when.OR.some((w) => whenMatches(w, props));
  if (when.AND) return when.AND.every((w) => whenMatches(w, props));
  return Object.entries(when).every(([k, v]) => props[k] === undefined || String(v).split("|").includes(props[k]));
}

/**
 * The models a block state is drawn with, from its blockstate file.
 * Properties the editor doesn't store (e.g. a stair's shape) match anything,
 * and the variant agreeing with the most stored properties wins.
 * A variant listing several models (random choice in game) gives the first.
 * @param {any} blockstate parsed blockstates/<id>.json
 * @param {Record<string,string>} props
 * @returns {{model:string, x?:number, y?:number, uvlock?:boolean}[]}
 */
export function pickModels(blockstate, props) {
  const first = (m) => (Array.isArray(m) ? m[0] : m);
  if (blockstate.variants) {
    let best = null, bestScore = -1;
    for (const [key, m] of Object.entries(blockstate.variants)) {
      const kp = keyProps(key);
      let score = 0, clash = false;
      for (const [k, v] of Object.entries(kp)) {
        if (props[k] === undefined) continue;
        if (props[k] === v) score++;
        else clash = true;
      }
      if (!clash && score > bestScore) { best = m; bestScore = score; }
    }
    return best ? [first(best)] : [];
  }
  if (blockstate.multipart) {
    return blockstate.multipart.filter((part) => whenMatches(part.when, props)).map((part) => first(part.apply));
  }
  return [];
}

/**
 * Follows a model's parents and merges them: textures from child to parent
 * (the child wins), elements from the nearest model that has any.
 * @param {string} name e.g. "minecraft:block/oak_stairs"
 * @param {(file:string)=>Promise<any>} load reads and parses a copied file
 * @returns {Promise<{textures:Record<string,string>, elements:any[]|null, ambientocclusion:boolean}>}
 */
export async function resolveModel(name, load) {
  const textures = {};
  let elements = null, ambientocclusion = true;
  const seen = new Set();
  for (let n = name; n && !seen.has(n); ) {
    seen.add(n);
    if (bare(n).startsWith("builtin/")) break;
    const m = await load(modelFile(n));
    for (const [k, v] of Object.entries(m.textures || {})) if (!(k in textures)) textures[k] = v;
    if (!elements && m.elements) elements = m.elements;
    if (m.ambientocclusion === false) ambientocclusion = false;
    n = m.parent;
  }
  return { textures, elements, ambientocclusion };
}

/**
 * Follows "#name" references to a texture name, e.g. "#side" -> "minecraft:block/bricks".
 * Returns null for a reference nothing fills in.
 */
export function textureOf(textures, ref) {
  for (let r = ref, i = 0; r && i < 16; i++) {
    if (!r.startsWith("#")) return r;
    r = textures[r.slice(1)];
  }
  return null;
}

/** Texture variables that best show what a block looks like, best first. */
const SWATCH_KEYS = ["all", "side", "texture", "cross", "pane", "front", "wool", "particle", "top", "end"];

/** The one texture that best stands for a block, for a small swatch. */
export function swatchTexture(textures) {
  for (const k of SWATCH_KEYS) {
    const t = k in textures && textureOf(textures, "#" + k);
    if (t) return t;
  }
  for (const k of Object.keys(textures)) {
    const t = textureOf(textures, "#" + k);
    if (t) return t;
  }
  return null;
}
