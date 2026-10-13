// The facade data model: coordinates, bounds, variants, validation.
// Pure functions that take the project as an argument. No DOM, no three.js.
//
// Coordinates are relative to the Core Wall (see CLAUDE.md):
//   x  across the facade; x = 0 is the centre column
//      (even widths: the right-hand block of the middle two)
//   y  up; 0 = bottom of the stage
//   z  0 = Core Wall, + = ornament in front, − = recess behind

export const STAGES = /** @type {const} */ (["base", "body", "capital"]);
export const STAGE_NAMES = { base: "Base", body: "Body", capital: "Capital" };

/** Key for a cell in a variant's block map. */
export const K = (x, y, z) => x + "," + y + "," + z;
/** Inverse of K. */
export const unK = (k) => k.split(",").map(Number);
export const uid = () => Math.random().toString(36).slice(2, 9);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Extent of the facade in x and z for the project's width and depths. */
export function bounds(p) {
  const c = Math.floor(p.width / 2);
  return { xMin: -c, xMax: p.width - 1 - c, zMin: -p.depthBack, zMax: p.depthFront };
}

/** Mirror partner of column x. Odd widths mirror about x = 0, even widths about x = −0.5. */
export const mirrorX = (p, x) => (p.width % 2 ? -x : -1 - x);
/** x position of the geometric mirror axis. */
export const axisX = (p) => (p.width % 2 ? 0 : -0.5);

/** New variant for a stage, pre-filled with a solid Core Wall at z = 0. */
export function newVariant(p, kind, name) {
  const v = { id: uid(), name, blocks: /** @type {Record<string,string>} */ ({}) };
  const b = bounds(p);
  for (let x = b.xMin; x <= b.xMax; x++)
    for (let y = 0; y < p.heights[kind]; y++) v.blocks[K(x, y, 0)] = p.coreBlock;
  return v;
}

/** Removes blocks outside the current bounds. Returns how many were removed. */
export function pruneAll(p) {
  const b = bounds(p);
  let n = 0;
  for (const kind of STAGES)
    for (const v of p.stages[kind])
      for (const k of Object.keys(v.blocks)) {
        const [x, y, z] = unK(k);
        if (x < b.xMin || x > b.xMax || z < b.zMin || z > b.zMax || y < 0 || y >= p.heights[kind]) {
          delete v.blocks[k];
          n++;
        }
      }
  return n;
}

/**
 * Validation messages for the project.
 * @returns {Array<["ok"|"warn"|"err", string]>}
 */
export function checks(p) {
  /** @type {Array<["ok"|"warn"|"err", string]>} */
  const out = [];
  const b = bounds(p);
  for (const k of STAGES) if (!p.stages[k].length) out.push(["err", `Add at least one ${STAGE_NAMES[k]} variant.`]);
  // Design rule: a facade is never thicker than it is wide (|zmax| <= |xmax|).
  if (p.depthFront > b.xMax || p.depthBack > b.xMax)
    out.push(["err", `Facade depth can’t exceed half the width (max ${b.xMax} each way at width ${p.width}).`]);
  if (p.floorMin < 3) out.push(["err", "Floor range must start at 3 or more."]);
  if (p.floorMax < p.floorMin) out.push(["err", "Floor range maximum is below the minimum."]);
  for (const k of STAGES)
    p.stages[k].forEach((v) => {
      let gaps = 0;
      for (let x = b.xMin; x <= b.xMax; x++) {
        let any = false;
        for (let y = 0; y < p.heights[k]; y++)
          for (let z = b.zMin; z <= b.zMax; z++) if (v.blocks[K(x, y, z)]) any = true;
        if (!any) gaps++;
      }
      if (gaps) out.push(["warn", `${STAGE_NAMES[k]} “${v.name}” has ${gaps} empty column${gaps > 1 ? "s" : ""}.`]);
    });
  if (!out.some((o) => o[0] === "err"))
    out.unshift(["ok", "Ready to assemble: every stage has a variant and the depths fit the width."]);
  return out;
}

/** Rough shape check for loaded project JSON. */
export function validProject(p) {
  return !!(
    p && typeof p === "object" && p.stages &&
    Array.isArray(p.stages.base) && Array.isArray(p.stages.body) && Array.isArray(p.stages.capital) &&
    Number.isFinite(p.width) && p.heights
  );
}
