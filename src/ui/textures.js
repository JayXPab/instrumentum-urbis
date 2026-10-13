/**
 * Block textures from the user's own Minecraft (desktop app only).
 * Works out which texture each block is drawn with and hands out picture
 * URLs for them. Without copied game files, everything stays flat colours.
 */
import { isDesktop, assetsStatus, readAsset } from "./desktop.js";
import { pickModels, resolveModel, frontLayers, blockstateFile, textureFile } from "../core/models.js";

let version = null;
/** What was copied: { jar, files }, or null when there are no game files yet. */
let info = null;
const json = new Map(); // file -> Promise of parsed JSON
const urls = new Map(); // texture name -> Promise of picture URL
const swatches = new Map(); // block id -> Promise of picture URL or null
/** Swatch URLs already worked out, for drawing without waiting. */
const ready = new Map();

/** Forgets everything worked out so far (after copying new files). */
function forget() {
  for (const p of urls.values()) p.then((u) => u && URL.revokeObjectURL(u));
  json.clear(); urls.clear(); swatches.clear(); ready.clear();
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
