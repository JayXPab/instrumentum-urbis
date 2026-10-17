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

/* ---------- tints ---------- */
// Some textures are grey in the jar and coloured by the game: grass and
// leaves by biome, a few blocks by a fixed colour. The editor uses the forest
// biome's colours. Only model faces marked with a "tintindex" are coloured.

/**
 * Grass, leaf and leaf-litter colours in the forest biome (the game's colour
 * maps at temperature 0.7, downfall 0.8; checked against the 1.21.11 jar).
 */
export const FOREST = { grass: "#79c05a", foliage: "#59ae30", dryFoliage: "#a36d46" };

/** Block id (without "minecraft:") -> the colour its marked faces get. */
const TINTS = {
  grass_block: FOREST.grass, short_grass: FOREST.grass, tall_grass: FOREST.grass,
  fern: FOREST.grass, large_fern: FOREST.grass, potted_fern: FOREST.grass,
  sugar_cane: FOREST.grass, bush: FOREST.grass,
  pink_petals: FOREST.grass, wildflowers: FOREST.grass, // their stems; the petals aren't marked
  oak_leaves: FOREST.foliage, jungle_leaves: FOREST.foliage, acacia_leaves: FOREST.foliage,
  dark_oak_leaves: FOREST.foliage, mangrove_leaves: FOREST.foliage, vine: FOREST.foliage,
  leaf_litter: FOREST.dryFoliage,
  // Fixed colours, the same in every biome.
  birch_leaves: "#80a755", spruce_leaves: "#619961", lily_pad: "#208030",
  // Water's usual colour (most biomes).
  water: "#3f76e4", bubble_column: "#3f76e4", water_cauldron: "#3f76e4",
};

/** The colour a block's marked faces get, or null when it has none. */
export const tintOf = (id) => TINTS[bare(id)] || null;

/**
 * What a block looks like from the front, as texture layers drawn in order:
 * each element's north face (south, else any face, if it has none), with
 * the block's tint on faces marked for it. A grass block gives its side and
 * then the green fringe on top. Repeated layers are left out.
 * @param {{textures:Record<string,string>, elements:any[]|null}} model a resolved model
 * @param {string} id the block id, for its tint
 * @returns {{texture:string, tint:string|null}[]}
 */
export function frontLayers(model, id) {
  const tint = tintOf(id);
  const layers = [];
  for (const el of model.elements || []) {
    const faces = el.faces || {};
    const face = faces.north || faces.south || Object.values(faces)[0];
    if (!face) continue;
    const texture = textureOf(model.textures, face.texture);
    if (!texture) continue;
    const t = face.tintindex !== undefined ? tint : null;
    if (!layers.some((l) => l.texture === texture && l.tint === t)) layers.push({ texture, tint: t });
  }
  if (!layers.length) {
    const texture = swatchTexture(model.textures);
    if (texture) layers.push({ texture, tint: null });
  }
  return layers;
}

/* ---------- model geometry ---------- */
// Turns a resolved model into flat four-cornered faces ("quads") ready for
// drawing. Model units are sixteenths of a block, 0…16 on each axis, with the
// game's axes (+x east, +y up, +z south).

/**
 * Each face's corners in drawing order (top-left, top-right, bottom-right,
 * bottom-left, as seen from outside the face), built from an element's
 * `from` (a) and `to` (b) corners.
 */
const CORNERS = {
  down: (a, b) => [[a[0], a[1], b[2]], [b[0], a[1], b[2]], [b[0], a[1], a[2]], [a[0], a[1], a[2]]],
  up: (a, b) => [[a[0], b[1], a[2]], [b[0], b[1], a[2]], [b[0], b[1], b[2]], [a[0], b[1], b[2]]],
  north: (a, b) => [[b[0], b[1], a[2]], [a[0], b[1], a[2]], [a[0], a[1], a[2]], [b[0], a[1], a[2]]],
  south: (a, b) => [[a[0], b[1], b[2]], [b[0], b[1], b[2]], [b[0], a[1], b[2]], [a[0], a[1], b[2]]],
  west: (a, b) => [[a[0], b[1], a[2]], [a[0], b[1], b[2]], [a[0], a[1], b[2]], [a[0], a[1], a[2]]],
  east: (a, b) => [[b[0], b[1], b[2]], [b[0], b[1], a[2]], [b[0], a[1], a[2]], [b[0], a[1], b[2]]],
};

/** Where a point lands on a face's texture when none is given, as [u, v] in 0…16. */
const PROJECT = {
  down: (p) => [p[0], 16 - p[2]],
  up: (p) => [p[0], p[2]],
  north: (p) => [16 - p[0], 16 - p[1]],
  south: (p) => [p[0], 16 - p[1]],
  west: (p) => [p[2], 16 - p[1]],
  east: (p) => [16 - p[2], 16 - p[1]],
};

/** The game's own default texture area for a face: [u1, v1, u2, v2]. */
function defaultUv(dir, a, b) {
  const [u1, v1] = PROJECT[dir](CORNERS[dir](a, b)[0]);
  const [u2, v2] = PROJECT[dir](CORNERS[dir](a, b)[2]);
  return [u1, v1, u2, v2];
}

/** Turns point p about an axis through origin o by deg degrees (right-handed). */
function turn(p, axis, deg, o) {
  if (!deg) return p;
  // Quarter turns exactly, so blocks stay on whole sixteenths.
  const q4 = deg % 90 === 0 ? (((deg / 90) % 4) + 4) % 4 : -1;
  const r = (deg * Math.PI) / 180;
  const c = q4 >= 0 ? [1, 0, -1, 0][q4] : Math.cos(r), s = q4 >= 0 ? [0, 1, 0, -1][q4] : Math.sin(r);
  const [x, y, z] = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
  const q = axis === "x" ? [x, y * c - z * s, y * s + z * c]
    : axis === "y" ? [x * c + z * s, y, -x * s + z * c]
    : [x * c - y * s, x * s + y * c, z];
  return [q[0] + o[0] + 0, q[1] + o[1] + 0, q[2] + o[2] + 0];
}

/** Which way a face points after turning, from its normal. */
function dirOf(n) {
  const [x, y, z] = n.map(Math.abs);
  if (y >= x && y >= z) return n[1] > 0 ? "up" : "down";
  if (x >= z) return n[0] > 0 ? "east" : "west";
  return n[2] > 0 ? "south" : "north";
}

/** How bright the game draws a face pointing along normal n (top 1, sides 0.8 and 0.6, bottom 0.5). */
export function faceShade(n) {
  const [x, y, z] = n;
  return Math.min(1, x * x * 0.6 + y * y * ((3 + y) / 4) + z * z * 0.8);
}

const CENTRE = [8, 8, 8];

/**
 * The faces of one model, turned as a blockstate variant says.
 * @param {{textures:Record<string,string>, elements:any[]|null}} model a resolved model
 * @param {{x?:number, y?:number, uvlock?:boolean}} [variant] from pickModels
 * @param {string|null} [tint] the colour of faces marked with a tintindex
 * @returns {{texture:string, tint:string|null, shade:number, dir:string, cull:string|null, points:number[][], uvs:number[][]}[]}
 *   points in 0…16 model units; uvs as [u, v] in 0…16 with v down the texture
 */
export function modelQuads(model, variant = {}, tint = null) {
  const out = [];
  const rx = variant.x || 0, ry = variant.y || 0;
  // The game turns a variant about x first, then y; both by minus the angle.
  const place = (p) => turn(turn(p, "x", -rx, CENTRE), "y", -ry, CENTRE);
  for (const el of model.elements || []) {
    const rot = el.rotation;
    let scale = null;
    if (rot && rot.rescale && rot.angle) {
      const f = 1 / Math.cos((Math.abs(rot.angle) * Math.PI) / 180);
      scale = rot.axis === "x" ? [1, f, f] : rot.axis === "y" ? [f, 1, f] : [f, f, 1];
    }
    const shape = (p) => {
      if (!rot) return p;
      let q = turn(p, rot.axis, rot.angle, rot.origin);
      if (scale) q = q.map((v, i) => rot.origin[i] + (v - rot.origin[i]) * scale[i]);
      return q;
    };
    for (const [dir, face] of Object.entries(el.faces || {})) {
      if (!CORNERS[dir]) continue;
      const texture = textureOf(model.textures, face.texture);
      if (!texture) continue;
      const raw = CORNERS[dir](el.from, el.to);
      const points = raw.map((p) => place(shape(p)));
      // Normal from two edges (corners run clockwise as seen from outside).
      const e1 = points[1].map((v, i) => v - points[0][i]), e2 = points[3].map((v, i) => v - points[0][i]);
      let n = [e1[2] * e2[1] - e1[1] * e2[2], e1[0] * e2[2] - e1[2] * e2[0], e1[1] * e2[0] - e1[0] * e2[1]];
      const len = Math.hypot(...n) || 1;
      n = n.map((v) => v / len);
      const now = dirOf(n);
      let uvs;
      if (variant.uvlock && (rx || ry)) {
        // Locked: the texture stays put in the world while the model turns.
        uvs = points.map((p) => PROJECT[now](p));
      } else {
        const [u1, v1, u2, v2] = face.uv || defaultUv(dir, el.from, el.to);
        const corners = [[u1, v1], [u2, v1], [u2, v2], [u1, v2]];
        const k = (((face.rotation || 0) / 90) % 4 + 4) % 4;
        uvs = corners.map((_, i) => corners[(i - k + 4) % 4]);
      }
      // The face a neighbour must cover to hide this one, turned with the model.
      let cull = null;
      if (face.cullface) {
        const c = { down: [0, -1, 0], up: [0, 1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] }[face.cullface];
        if (c) cull = dirOf(place(c.map((v, i) => v + CENTRE[i])).map((v, i) => v - CENTRE[i]));
      }
      out.push({
        texture, tint: face.tintindex !== undefined ? tint : null,
        shade: el.shade === false ? 1 : faceShade(n), dir: now, cull, points, uvs,
      });
    }
  }
  return out;
}

/**
 * Some blocks (chests, beds, signs, banners, heads…) are drawn by the game's
 * code, not from model files: their models only name a "particle" texture.
 * They stand in as a slightly smaller box in that texture (tinted, so water
 * is blue).
 */
const STAND_IN = {
  from: [1, 0, 1], to: [15, 14, 15],
  faces: Object.fromEntries(["down", "up", "north", "south", "west", "east"].map((d) => [d, { texture: "#particle", tintindex: 0 }])),
};

/**
 * Everything needed to draw a block state: the faces of each model it uses.
 * @param {string} id block id
 * @param {Record<string,string>} props every property (see fullState)
 * @param {(file:string)=>Promise<any>} load reads and parses a copied file
 */
export async function blockQuads(id, props, load) {
  const tint = tintOf(id);
  const out = [];
  for (const v of pickModels(await load(blockstateFile(id)), props)) {
    if (!v || !v.model) continue;
    const m = await resolveModel(v.model, load);
    out.push(...modelQuads(m.elements ? m : { ...m, elements: [STAND_IN] }, v, tint));
  }
  return out;
}
