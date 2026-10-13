/**
 * Block textures from the user's own Minecraft (desktop app only).
 * Works out which texture each block is drawn with and hands out picture
 * URLs for them. Without copied game files, everything stays flat colours.
 */
import { isDesktop, assetsStatus, readAsset } from "./desktop.js";
import { pickModels, resolveModel, swatchTexture, blockstateFile, textureFile } from "../core/models.js";

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

/** A picture URL that stands for a block in the palette, or null when there is none. */
export function blockSwatch(id) {
  if (!info) return Promise.resolve(null);
  if (!swatches.has(id)) {
    swatches.set(id, (async () => {
      try {
        const [m] = pickModels(await loadJson(blockstateFile(id)), {});
        if (!m) return null;
        const tex = swatchTexture((await resolveModel(m.model, loadJson)).textures);
        return tex ? await textureUrl(tex) : null;
      } catch (e) {
        return null; // a block this version doesn't have, or a file that's missing
      }
    })().then((u) => { ready.set(id, u); return u; }));
  }
  return swatches.get(id);
}
/** The swatch URL if it's already worked out (undefined if not yet). */
export const swatchNow = (id) => ready.get(id);
