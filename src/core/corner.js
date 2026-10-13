// Corner buildings: the front facade plus the same facade turned 90° to face
// the side street. Pure functions, no DOM, no three.js.
//
// Everything is worked out for a RIGHT corner (side street to the east, +x).
// A left corner mirrors the front, builds a right corner, and mirrors back,
// which gives exactly the same result as turning the other way.
//
// Right corner, in world coordinates:
//   the side facade's Core Wall is the plane x = xMax, running from z = 0
//   (the shared corner column) back to z = −(width − 1). Its ornament points
//   east (+x), its recesses west, into the building.
//   A facade cell (x', y, z') of the side lands at (xMax + z', y, −(x' − xMin)).
//
// Where the two meet:
//   merge  same block, or two stairs that combine into a corner stair
//   trim   anything else: the Core Wall block on a Core Wall plane, air elsewhere
// Outside the corner, matching ornament on both corner columns is continued
// round the corner, mitred like a picture frame.

import { BMAP, parseState, makeState, mirrorState, rotateState } from "./blocks.js";
import { K, unK, bounds, clamp } from "./facade.js";

/** Building types: mid-row, and corners left/right, sharp or chamfered ("-ch"). */
export const TYPES = /** @type {const} */ (["mid", "cl", "cr", "cl-ch", "cr-ch"]);
export const TYPE_NAMES = {
  mid: "Mid-row", cl: "Left corner", cr: "Right corner", "cl-ch": "Left corner, chamfered", "cr-ch": "Right corner, chamfered",
};
export const CHAMFER_MIN = 1, CHAMFER_MAX = 3;

/** Which building types a project generates (saved with the project). */
export const typesDefaults = () => ({ mid: true, left: false, right: false, sharp: true, chamfered: false, chamfer: 2 });

/**
 * The building types ticked in p.types, in order: mid-row, then left and right corners,
 * sharp before chamfered. A corner with neither style ticked counts as sharp;
 * with nothing ticked at all, mid-row.
 * @returns {string[]}
 */
export function typeList(p) {
  const t = { ...typesDefaults(), ...p.types };
  const out = t.mid ? ["mid"] : [];
  const styles = [t.sharp || !t.chamfered ? "" : null, t.chamfered ? "-ch" : null].filter((s) => s !== null);
  for (const [on, code] of [[t.left, "cl"], [t.right, "cr"]]) if (on) for (const s of styles) out.push(code + s);
  return out.length ? out : ["mid"];
}

/**
 * The corner of the building in p.assembly, or null for a mid-row building.
 * @returns {{side:"left"|"right", chamfer:number} | null}
 */
export function cornerOf(p) {
  const t = p.assembly?.type || "mid";
  if (t === "mid" || !TYPES.includes(t)) return null;
  return {
    side: t.startsWith("cl") ? "left" : "right",
    chamfer: t.endsWith("-ch") ? clamp(Math.round(p.types?.chamfer ?? 2), CHAMFER_MIN, CHAMFER_MAX) : 0,
  };
}

/* ---------- stair quarters ---------- */
// A stair is described by which quarters of the block (seen from above) have
// the tall part: "NE", "NW", "SE", "SW". Two stairs meeting at a corner
// combine by joining (inner corner) or overlapping (outer corner) their quarters.

const OPP = { north: "south", south: "north", east: "west", west: "east" };
const LEFT = { north: "west", west: "south", south: "east", east: "north" }; // looking toward the facing
const RIGHT = { north: "east", east: "south", south: "west", west: "north" };
const quarter = (a, b) => {
  const ns = [a, b].find((d) => d === "north" || d === "south");
  const ew = [a, b].find((d) => d === "east" || d === "west");
  return ns[0].toUpperCase() + ew[0].toUpperCase();
};
/** The two quarters on one side of a block. */
export const halfOf = (d) => (d === "north" || d === "south" ? [quarter(d, "east"), quarter(d, "west")] : [quarter("north", d), quarter("south", d)]);

const SHAPES = ["straight", "outer_left", "outer_right", "inner_left", "inner_right"];

/** Tall quarters of a stair with this facing and shape. */
export function stairQuarters(facing, shape = "straight") {
  const h = halfOf(facing);
  switch (shape) {
    case "outer_left": return new Set([quarter(facing, LEFT[facing])]);
    case "outer_right": return new Set([quarter(facing, RIGHT[facing])]);
    case "inner_left": return new Set([...h, quarter(OPP[facing], LEFT[facing])]);
    case "inner_right": return new Set([...h, quarter(OPP[facing], RIGHT[facing])]);
    default: return new Set(h);
  }
}

/** The stair (facing + shape) with exactly these tall quarters, or null if none has. */
export function stairFromQuarters(qs) {
  const want = [...qs].sort().join();
  for (const facing of ["north", "east", "south", "west"])
    for (const shape of SHAPES)
      if ([...stairQuarters(facing, shape)].sort().join() === want) return { facing, shape };
  return null;
}

const isStair = (s) => BMAP[parseState(s).id]?.shape === "stairs";

/**
 * Combines two stairs of the same half into one corner stair.
 * "union" joins their tall parts (inner corner); "intersect" keeps the overlap (outer corner).
 * Returns null if they can't combine. The first stair's block is kept.
 */
export function mergeStairs(a, b, how) {
  if (!isStair(a) || !isStair(b)) return null;
  const A = parseState(a), B = parseState(b);
  if ((A.props.half || "bottom") !== (B.props.half || "bottom")) return null;
  const qa = stairQuarters(A.props.facing || "north", A.props.shape);
  const qb = stairQuarters(B.props.facing || "north", B.props.shape);
  const q = how === "union" ? new Set([...qa, ...qb]) : new Set([...qa].filter((x) => qb.has(x)));
  const st = q.size && q.size < 4 ? stairFromQuarters(q) : null;
  if (!st) return null;
  const props = { ...A.props, facing: st.facing };
  if (st.shape === "straight") delete props.shape;
  else props.shape = st.shape;
  return makeState(A.id, props);
}

/* ---------- building the corner ---------- */

/** @typedef {{s:string, kind:string, copy?:number}} Cell */

/** Mirrors cells across the facade's middle (x -> xMin + xMax − x), blocks included. */
export function mirrorCells(cells, p) {
  const b = bounds(p), m = b.xMin + b.xMax;
  const out = new Map();
  for (const [k, c] of cells) {
    const [x, y, z] = unK(k);
    out.set(K(m - x, y, z), { ...c, s: mirrorState(c.s) });
  }
  return out;
}

/**
 * Turns a stack of front-facade cells into a corner building's facades.
 * @param {Map<string, Cell>} front the stacked front facade (base, bodies, capital)
 * @param {{side:"left"|"right", chamfer:number}} corner
 * @returns {Map<string, Cell>}
 */
export function buildCorner(front, p, corner) {
  if (corner.side === "left") return mirrorCells(rightCorner(mirrorCells(front, p), p, corner.chamfer), p);
  return rightCorner(front, p, corner.chamfer);
}

function rightCorner(front, p, chamfer) {
  const b = bounds(p), xm = b.xMax;

  // The side facade: the front turned a quarter turn anticlockwise.
  /** @type {Map<string, Cell>} */
  const side = new Map();
  for (const [k, c] of front) {
    const [x, y, z] = unK(k);
    side.set(K(xm + z, y, -(x - b.xMin)), { ...c, s: rotateState(c.s, 1) });
  }

  // Put them together: merge where they meet, otherwise trim.
  const out = new Map(front);
  for (const [k, sc] of side) {
    const f = out.get(k);
    if (!f) { out.set(k, sc); continue; }
    if (f.s === sc.s) continue;
    const m = mergeStairs(f.s, sc.s, "union");
    if (m) { out.set(k, { ...f, s: m }); continue; }
    const [x, , z] = unK(k);
    if (z === 0 || x === xm) out.set(k, { ...f, s: p.coreBlock });
    else out.delete(k);
  }

  // Outside the corner: continue ornament that both corner columns share.
  const ys = new Set([...front.keys()].map((k) => unK(k)[1]));
  for (const y of ys)
    for (let d = 1; d <= p.depthFront; d++) {
      const fb = front.get(K(xm, y, d)); // front corner column, d out from the wall
      const sb = side.get(K(xm + d, y, 0)); // side corner column, d out from its wall
      if (!fb || !sb || parseState(fb.s).id !== parseState(sb.s).id) continue;
      for (let a = 1; a <= d; a++)
        for (let c = 1; c <= d; c++) {
          if (Math.max(a, c) !== d) continue; // layer d of the mitre
          const k = K(xm + a, y, c);
          if (out.has(k)) continue;
          const s = a < c ? fb.s : a > c ? sb.s : mergeStairs(fb.s, sb.s, "intersect") ?? fb.s;
          out.set(k, { ...fb, s });
        }
    }

  if (chamfer > 0) cutChamfer(out, front, p, chamfer);
  return out;
}

/**
 * Chamfer: cuts `c` blocks off the corner and closes it with a stepped
 * diagonal wall. Measured from the cut: u = x − (xMax − c) across, v = −z back.
 * Wall cells: (i, i) for i = 1 … c − 1 and (i − 1, i) for i = 1 … c.
 */
function cutChamfer(out, front, p, c) {
  const xm = bounds(p).xMax;
  const at = (u, v) => [xm - c + u, -v];
  const wall = new Set();
  for (let i = 1; i < c; i++) wall.add(i + "," + i);
  for (let i = 1; i <= c; i++) wall.add(i - 1 + "," + i);
  const isWall = (u, v) => wall.has(u + "," + v) || (v === 0 && u <= 0) || (u === c && v >= c);

  // Clear the corner square.
  for (const k of [...out.keys()]) {
    const [x, , z] = unK(k);
    if (x > xm - c && z > -c) out.delete(k);
  }

  const ys = new Set([...front.keys()].map((k) => unK(k)[1]));
  for (const y of ys) {
    const corner = front.get(K(xm, y, 0)) || { s: p.coreBlock, kind: "capital" };
    for (const key of wall) {
      const [u, v] = key.split(",").map(Number);
      const [x, z] = at(u, v);
      out.set(K(x, y, z), { ...corner, s: corner.s });
    }

    // A band one block out from the corner column carries on along the steps.
    const band = front.get(K(xm, y, 1));
    if (!band) continue;
    const B = parseState(band.s);
    for (let u = 1; u <= c; u++)
      for (let v = 0; v < c; v++) {
        if (u - v < 1 || isWall(u, v)) continue;
        const dirs = [];
        if (isWall(u - 1, v)) dirs.push("west");
        if (isWall(u + 1, v)) dirs.push("east");
        if (isWall(u, v + 1)) dirs.push("north");
        if (isWall(u, v - 1)) dirs.push("south");
        if (!dirs.length) continue;
        let s = band.s;
        if (isStair(band.s) && (B.props.facing === "north" || B.props.facing === "south")) {
          // The front band's stairs face the wall (north) or away from it (south): keep that.
          const use = B.props.facing === "north" ? dirs : dirs.map((d) => OPP[d]);
          const st = stairFromQuarters(new Set(use.flatMap(halfOf)));
          if (st) {
            const props = { ...B.props, facing: st.facing };
            if (st.shape === "straight") delete props.shape;
            else props.shape = st.shape;
            s = makeState(B.id, props);
          }
        }
        const [x, z] = at(u, v);
        out.set(K(x, y, z), { ...band, s });
      }
  }
}

/**
 * Is (x, z) cut away by the chamfer of a right corner? Used to clip roofs.
 */
export function outsideChamfer(p, c, x, z) {
  const xm = bounds(p).xMax;
  const u = x - (xm - c), v = -z;
  return c > 0 && x > xm - c && z > -c && u - v >= 1;
}
