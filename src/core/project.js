// Loading projects: brings a saved project of any older format up to date
// and fills in settings added since. Pure functions, no DOM, no three.js.
//
// Format history
//   1  first version: one building depth (buildingDepth)
//   2  building depth is a range (depthMin..depthMax), chosen per building (assembly.depth)

import { bulkDefaults } from "./bulk.js";
import { roofDefaults } from "./roof.js";

export const FORMAT = "instrumentum-urbis/facade";
export const FORMAT_VERSION = 2;

/**
 * Upgrades a loaded project in place and returns it.
 * Safe to run on a project that is already current.
 */
export function upgradeProject(p) {
  // v1 -> v2: one depth becomes a range of one value.
  if (p.depthMin == null || p.depthMax == null) {
    const d = Number.isFinite(p.buildingDepth) ? p.buildingDepth : 9;
    p.depthMin = d;
    p.depthMax = d;
  }
  delete p.buildingDepth;
  p.format = FORMAT;
  p.formatVersion = FORMAT_VERSION;

  // Settings added after version 1 that fill in on load.
  p.assembly ??= { base: 0, body: 0, capital: 0, floors: p.floorMin || 3, seed: 1 };
  p.assembly.roof ??= 0;
  p.assembly.depth ??= p.depthMin;
  p.partyWall ??= [];
  p.roofs = (p.roofs || []).map((r) => roofDefaults(r));
  p.bulk = { ...bulkDefaults(), ...p.bulk };
  return p;
}
