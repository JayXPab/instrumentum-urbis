/**
 * What only the desktop app can do: pick folders, find the mods' folders, and
 * save files straight into them. In a plain browser `isDesktop` is false and
 * the editor downloads files instead.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export const isDesktop = isTauri();

/** Opens the Windows folder picker. Returns the chosen folder, or null. */
export async function chooseFolder(title, start) {
  const dir = await open({ directory: true, title, defaultPath: start || undefined });
  return typeof dir === "string" ? dir : null;
}

/**
 * Every Axiom, WorldEdit and Litematica folder found in the usual launcher
 * places: [{ format, launcher, instance, path }].
 */
export const findModFolders = () => invoke("find_mod_folders");

/** Saves bytes as `name` in `dir` (inside subfolder `sub`, if given). Returns the full path. */
export const saveFile = (dir, name, bytes, sub = "") =>
  invoke("save_file", bytes, {
    headers: { "x-dir": encodeURIComponent(dir), "x-sub": encodeURIComponent(sub), "x-name": encodeURIComponent(name) },
  });

/* ---------- this computer's folder settings ---------- */
// Kept apart from the project: folders belong to this computer, and a project
// file shared with someone else shouldn't carry them.
const KEY = "instrumentum-urbis.folders.v1";

/** { bp, schem, litematic: folder or "", bulkTo: "zip" | "folders", sub: bulk subfolder } */
export function loadFolders() {
  let f = {};
  try { f = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { /* storage unavailable */ }
  return { bp: "", schem: "", litematic: "", bulkTo: "zip", sub: "instrumentum-urbis", ...f };
}
export function saveFolders(f) {
  try { localStorage.setItem(KEY, JSON.stringify(f)); } catch (e) { /* storage unavailable */ }
}
