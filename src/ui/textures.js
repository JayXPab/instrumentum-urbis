/**
 * Block textures from the user's own Minecraft (desktop app only).
 * Works out which texture each block is drawn with and hands out picture
 * URLs for them. Without copied game files, everything stays flat colours.
 */
import { isDesktop, assetsStatus, readAsset } from "./desktop.js";
import { pickModels, resolveModel, frontLayers, blockstateFile, textureFile, blockQuads } from "../core/models.js";
import { parseState, fullState } from "../core/blocks.js";

let version = null;
/** What was copied: { jar, files }, or null when there are no game files yet. */
let info = null;
const json = new Map(); // file -> Promise of parsed JSON
const urls = new Map(); // texture name -> Promise of picture URL
const swatches = new Map(); // block id -> Promise of picture URL or null
/** Swatch URLs already worked out, for drawing without waiting. */
const ready = new Map();
const images = new Map(); // texture name -> Promise of { canvas, alpha } or null
const quads = new Map(); // block state -> Promise of faces or null
const colours = new Map(); // block id -> average colour "#rrggbb", or null while working it out
/** Goes up by one each time the game files change, so drawings made from the old ones are dropped. */
export let generation = 0;

/** Forgets everything worked out so far (after copying new files). */
function forget() {
  for (const p of urls.values()) p.then((u) => u && URL.revokeObjectURL(u));
  json.clear(); urls.clear(); swatches.clear(); ready.clear(); images.clear(); quads.clear(); colours.clear();
  generation++;
}

/* ---------- telling the editor something new can be drawn ---------- */
let listener = () => {};
let soon = 0;
/** Calls fn (a little later, once for many changes) whenever more blocks can be drawn with textures. */
export function onTexturesChange(fn) { listener = fn; }
export function texturesChanged() {
  if (!soon) soon = setTimeout(() => { soon = 0; listener(); }, 80);
}

/** Checks which game files this Minecraft version has. Returns { jar, files } or null. */
export async function initTextures(v) {
  version = v;
  forget();
  info = null;
  if (isDesktop) {
    try { info = await assetsStatus(v); } catch (e) { info = null; }
  }
  return info;
}
/** Whether blocks can be drawn with real textures. */
export const hasTextures = () => !!info;
export const textureInfo = () => info;
/** After copying new files: start again with them. */
export const reloadTextures = () => initTextures(version);

const text = new TextDecoder();
function loadJson(file) {
  if (!json.has(file)) json.set(file, readAsset(version, file).then((b) => JSON.parse(text.decode(b))));
  return json.get(file);
}
/** A picture URL for a texture name like "minecraft:block/bricks". */
export function textureUrl(name) {
  if (!urls.has(name))
    urls.set(name, readAsset(version, textureFile(name)).then(
      (b) => URL.createObjectURL(new Blob([b], { type: "image/png" })),
      () => null,
    ));
  return urls.get(name);
}

/** Loads a picture URL into an image. */
const loadImage = (url) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });

/**
 * Draws texture layers on top of each other, colouring the tinted ones the way
 * the game does (the grey texture multiplied by the colour, keeping its
 * see-through parts). Animated textures (tall strips) give their first frame.
 * Returns a picture URL.
 */
async function drawLayers(layers) {
  const S = 16;
  const out = document.createElement("canvas");
  out.width = out.height = S;
  const ctx = out.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  for (const l of layers) {
    const url = await textureUrl(l.texture);
    if (!url) continue;
    const im = await loadImage(url);
    const f = im.width; // frames are square: the first one is the top f × f
    if (!l.tint) { ctx.drawImage(im, 0, 0, f, f, 0, 0, S, S); continue; }
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const x = c.getContext("2d");
    x.imageSmoothingEnabled = false;
    x.drawImage(im, 0, 0, f, f, 0, 0, S, S);
    x.globalCompositeOperation = "multiply";
    x.fillStyle = l.tint;
    x.fillRect(0, 0, S, S);
    x.globalCompositeOperation = "destination-in"; // keep only where the texture was
    x.drawImage(im, 0, 0, f, f, 0, 0, S, S);
    ctx.drawImage(c, 0, 0);
  }
  const blob = await new Promise((r) => out.toBlob(r, "image/png"));
  return URL.createObjectURL(blob);
}

/** A picture URL that stands for a block in the palette, or null when there is none. */
export function blockSwatch(id) {
  if (!info) return Promise.resolve(null);
  if (!swatches.has(id)) {
    swatches.set(id, (async () => {
      try {
        const [m] = pickModels(await loadJson(blockstateFile(id)), {});
        if (!m) return null;
        const layers = frontLayers(await resolveModel(m.model, loadJson), id);
        if (!layers.length) return null;
        // One plain layer: the texture itself. Otherwise draw the layers together.
        if (layers.length === 1 && !layers[0].tint) return await textureUrl(layers[0].texture);
        return await drawLayers(layers);
      } catch (e) {
        return null; // a block this version doesn't have, or a file that's missing
      }
    })().then((u) => { ready.set(id, u); return u; }));
  }
  return swatches.get(id);
}
/** The swatch URL if it's already worked out (undefined if not yet). */
export const swatchNow = (id) => ready.get(id);

/**
 * A texture's first frame on a canvas, and how see-through it is:
 * "opaque", "cutout" (only fully clear or fully solid pixels, like leaves)
 * or "blend" (partly clear pixels, like stained glass). Null if missing.
 */
export function textureImage(name) {
  if (!images.has(name))
    images.set(name, textureUrl(name).then(async (url) => {
      if (!url) return null;
      const im = await loadImage(url);
      const f = im.width; // frames are square: the first one is the top f × f
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = f;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(im, 0, 0, f, f, 0, 0, f, f);
      const px = ctx.getImageData(0, 0, f, f).data;
      let alpha = "opaque";
      for (let i = 3; i < px.length; i += 4) {
        if (px[i] === 255) continue;
        if (px[i] > 0) { alpha = "blend"; break; }
        alpha = "cutout";
      }
      return { canvas, alpha };
    }).catch(() => null));
  return images.get(name);
}

/** The faces a block state is drawn with (see modelQuads), or null when it can't be. */
export function stateQuads(state) {
  if (!info) return Promise.resolve(null);
  if (!quads.has(state))
    quads.set(state, (async () => {
      const { id, props } = parseState(fullState(state));
      const q = await blockQuads(id, props, loadJson);
      return q.length ? q : null;
    })().catch(() => null));
  return quads.get(state);
}

/**
 * A block's average colour from its palette picture (for the elevation grid),
 * or undefined until it's known. Asks for it the first time.
 */
export function colourNow(id) {
  if (!info) return undefined;
  if (!colours.has(id)) {
    colours.set(id, null);
    const g = generation;
    blockSwatch(id).then(async (url) => {
      if (!url || g !== generation) return;
      const im = await loadImage(url);
      const f = im.width, c = document.createElement("canvas");
      c.width = c.height = f;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(im, 0, 0, f, f, 0, 0, f, f);
      const px = ctx.getImageData(0, 0, f, f).data, sum = [0, 0, 0, 0];
      for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += px[i + k] * px[i + 3];
      for (let i = 3; i < px.length; i += 4) sum[3] += px[i];
      if (!sum[3] || g !== generation) return;
      colours.set(id, "#" + sum.slice(0, 3).map((v) => Math.round(v / sum[3]).toString(16).padStart(2, "0")).join(""));
      texturesChanged();
    }).catch(() => {});
  }
  return colours.get(id) || undefined;
}
