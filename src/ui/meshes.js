// three.js helpers: turn block states into meshes, draw guide lines and labels.

import * as THREE from "three";
import { BMAP, parseState } from "../core/blocks.js";
import { hasTextures, stateQuads, textureImage, texturesChanged, generation } from "./textures.js";

export const unitBox = new THREE.BoxGeometry(1, 1, 1);
const matCache = new Map();

/** Cheap per-position hash used to vary block shading slightly. */
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function material(hex, shade, opacity) {
  const key = hex + "|" + shade + "|" + opacity;
  let m = matCache.get(key);
  if (!m) {
    const c = new THREE.Color(hex);
    c.offsetHSL(0, 0, (shade - 1.5) * 0.018);
    m = new THREE.MeshLambertMaterial({ color: c, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
    matCache.set(key, m);
  }
  return m;
}

/* ---------- blocks drawn from the game's own models ---------- */
// With the game files copied (desktop app), each block state is built once
// from its models into one shape with a material per texture, and every block
// of that state shares it. Until it's built (or without game files) the block
// is drawn with the flat-colour boxes further down.

let built = new Map(); // block state -> { geo, parts } or null when it can't be drawn
const building = new Set();
let builtFor = -1;
let texCache = new Map(); // texture name -> THREE texture
let modelMats = new Map(); // texture|tint|alpha|opacity -> material

/** Drops everything built from older game files. */
function checkGeneration() {
  if (builtFor === generation) return;
  builtFor = generation;
  for (const m of built.values()) m?.geo.dispose();
  for (const t of texCache.values()) t.dispose();
  for (const m of modelMats.values()) m.dispose();
  built = new Map(); texCache = new Map(); modelMats = new Map();
  building.clear();
}

/** Builds one block state's shape from its faces. Each group of faces sharing a texture and tint is one material. */
async function buildModel(state) {
  const quads = await stateQuads(state);
  if (!quads) return null;
  const byKey = new Map();
  for (const q of quads) {
    const key = q.texture + "|" + (q.tint || "");
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(q);
  }
  const pos = [], uv = [], col = [], index = [], parts = [];
  const geo = new THREE.BufferGeometry();
  const c = new THREE.Color();
  for (const [key, qs] of byKey) {
    const img = await textureImage(qs[0].texture);
    if (!img) continue;
    const start = index.length;
    for (const q of qs) {
      const v0 = pos.length / 3;
      // Block (x, y, z) fills x−½…x+½, y…y+1, z−½…z+½.
      for (const p of q.points) pos.push(p[0] / 16 - 0.5, p[1] / 16, p[2] / 16 - 0.5);
      for (const [u, v] of q.uvs) uv.push(u / 16, 1 - v / 16);
      // The game darkens sides and bottoms; the shade is a brightness on screen.
      c.setRGB(q.shade, q.shade, q.shade, THREE.SRGBColorSpace);
      for (let i = 0; i < 4; i++) col.push(c.r, c.g, c.b);
      index.push(v0, v0 + 3, v0 + 2, v0, v0 + 2, v0 + 1);
    }
    geo.addGroup(start, index.length - start, parts.length);
    parts.push({ key, texture: qs[0].texture, tint: qs[0].tint, img });
  }
  if (!parts.length) return null;
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  return { geo, parts };
}

/** The built shape for a state, or undefined while it's being built (asks for it), or null if it can't be drawn. */
function modelNow(state) {
  if (!hasTextures()) return null;
  checkGeneration();
  if (built.has(state)) return built.get(state);
  if (!building.has(state)) {
    building.add(state);
    const g = generation;
    buildModel(state).catch(() => null).then((m) => {
      if (g !== generation) { m?.geo.dispose(); return; }
      built.set(state, m);
      building.delete(state);
      texturesChanged();
    });
  }
  return undefined;
}

/** A material for one texture, tint and opacity, shared by every block using it. */
function modelMaterial(part, opacity) {
  const key = part.key + "|" + opacity;
  let m = modelMats.get(key);
  if (!m) {
    let t = texCache.get(part.texture);
    if (!t) {
      t = new THREE.CanvasTexture(part.img.canvas);
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.SRGBColorSpace;
      texCache.set(part.texture, t);
    }
    const blend = part.img.alpha === "blend" || opacity < 1;
    m = new THREE.MeshBasicMaterial({
      map: t, vertexColors: true, color: new THREE.Color(part.tint || "#ffffff"),
      transparent: blend, opacity, depthWrite: !blend,
      alphaTest: part.img.alpha === "cutout" ? 0.5 : part.img.alpha === "blend" ? 0.01 : 0,
    });
    modelMats.set(key, m);
  }
  return m;
}

/**
 * One block: its real shape and textures when the game files are there,
 * otherwise box meshes approximating it. Every mesh carries
 * userData.cell = [x, y, z] so clicks can be traced back to the block.
 */
export function blockObject(state, x, y, z, opacity = 1) {
  const model = modelNow(state);
  if (model) {
    const me = new THREE.Mesh(model.geo, model.parts.map((p) => modelMaterial(p, opacity)));
    me.position.set(x, y, z);
    me.userData.cell = [x, y, z];
    me.userData.shared = true;
    return me;
  }
  const { id, props } = parseState(state);
  const b = BMAP[id] || { color: "#d000d0", shape: "cube", opacity: 1 };
  const m = material(b.color, Math.floor(hash3(x, y, z) * 4), Math.min(b.opacity, opacity));
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const part = (sx, sy, sz, cx, cy, cz) => {
    const me = new THREE.Mesh(unitBox, m);
    me.scale.set(sx, sy, sz);
    me.position.set(cx, cy, cz);
    me.userData.cell = [x, y, z];
    g.add(me);
  };
  // Stairs: the tall half sits on the side the stair faces.
  const off = { north: [0, -0.25], south: [0, 0.25], east: [0.25, 0], west: [-0.25, 0] }[props.facing || "north"];
  const half = (cy) => {
    if (off[0]) part(0.5, 0.5, 1, off[0], cy, 0);
    else part(1, 0.5, 0.5, 0, cy, off[1]);
  };
  switch (b.shape) {
    case "slab":
      if (props.type === "top") part(1, 0.5, 1, 0, 0.75, 0);
      else if (props.type === "double") part(1, 1, 1, 0, 0.5, 0);
      else part(1, 0.5, 1, 0, 0.25, 0);
      break;
    case "pane":
      part(1, 1, 0.14, 0, 0.5, 0);
      break;
    case "carpet":
      part(1, 0.0625, 1, 0, 0.03125, 0);
      break;
    case "plant":
      // Two thin crossing leaves, like Minecraft draws grass and flowers.
      part(0.7, 0.75, 0.08, 0, 0.375, 0);
      part(0.08, 0.75, 0.7, 0, 0.375, 0);
      break;
    case "stairs":
      if (props.half === "top") {
        part(1, 0.5, 1, 0, 0.75, 0);
        half(0.25);
      } else {
        part(1, 0.5, 1, 0, 0.25, 0);
        half(0.75);
      }
      break;
    default:
      part(1, 1, 1, 0, 0.5, 0);
  }
  return g;
}

/** Removes and disposes everything in a group (shared geometry and cached materials are kept). */
export function clearGroup(g) {
  while (g.children.length) {
    const c = g.children.pop();
    c.traverse((o) => {
      if (o.geometry && o.geometry !== unitBox && !o.userData.shared) o.geometry.dispose();
      if (o.material && o.userData.own) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
  }
}

/** Adds line segments (pairs of points) to a group. */
export function addLines(group, points, color, opacity = 1, dashed = false) {
  const geo = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p)));
  const mat = dashed
    ? new THREE.LineDashedMaterial({ color: new THREE.Color(color), dashSize: 0.35, gapSize: 0.25, transparent: true, opacity })
    : new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: opacity < 1, opacity });
  const l = new THREE.LineSegments(geo, mat);
  l.userData.own = true;
  if (dashed) l.computeLineDistances();
  group.add(l);
  return l;
}

/** Wireframe box outline. */
export function boxEdges(group, x0, y0, z0, x1, y1, z1, color, opacity) {
  const c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const p = [];
  [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(([a, b]) => p.push(c[a], c[b]));
  return addLines(group, p, color, opacity);
}

/** A right-aligned text label that always faces the camera. */
export function textSprite(text, color) {
  const fs = 44, pad = 10;
  const cv = document.createElement("canvas");
  const ctx = cv.getContext("2d");
  ctx.font = `500 ${fs}px "IBM Plex Mono", monospace`;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  cv.width = w;
  cv.height = fs + pad * 2;
  ctx.font = `500 ${fs}px "IBM Plex Mono", monospace`;
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  ctx.fillText(text, w - pad, cv.height / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  s.userData.own = true;
  const h = 0.62;
  s.scale.set((h * cv.width) / cv.height, h, 1);
  s.center.set(1, 0.5);
  s.renderOrder = 10;
  return s;
}
