// The Facade Editor UI: state, 3D view, elevation grid, side panels.
// All facade rules live in src/core; this file only wires them to the screen.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { BLOCKS, BMAP, MATERIALS, parseState, makeState, shortId, mirrorState } from "../core/blocks.js";
import {
  STAGES, STAGE_NAMES, K, unK, uid, clamp, bounds, mirrorX, axisX,
  newVariant, pruneAll, checks, validProject,
} from "../core/facade.js";
import { assemble, comboCount, buildingDepth, minDepth, plot } from "../core/assemble.js";
import { upgradeProject } from "../core/project.js";
import { sampleProject } from "../core/sample.js";
import { toSchem, schemName } from "../core/schem.js";
import { blueprintParts, packBlueprint } from "../core/blueprint.js";
import { bulkDefaults, bulkCount, chooseCombos, forCombo, indexCsv } from "../core/bulk.js";
import { ZipWriter } from "../core/zip.js";
import { roofDefaults, SLOPED } from "../core/roof.js";
import { typeList, TYPE_NAMES } from "../core/corner.js";
import { blockObject, clearGroup, addLines, boxEdges, textSprite } from "./meshes.js";

/* ============================================================
   STATE
   ============================================================ */
const STORE_KEY = "instrumentum-urbis.project.v1";
function loadStored() {
  try {
    const t = localStorage.getItem(STORE_KEY);
    return t ? JSON.parse(t) : null;
  } catch (e) {
    return null;
  }
}
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(P)); } catch (e) { /* storage unavailable */ }
  }, 300);
}

/** The project: everything that gets saved. */
let P = loadStored();
if (!validProject(P)) P = sampleProject();
upgradeProject(P);

/** Editor-only state: never saved. */
const ui = {
  mode: "edit", stage: "base", sel: { base: 0, body: 0, capital: 0 }, layer: 0,
  tool: "place", block: "minecraft:stone_bricks", facing: "north", half: "top", slabType: "top",
  mirror: true, fade: false, labels: true, filter: "",
};

/* ---------- undo / redo (whole-project snapshots) ---------- */
const undoStack = [], redoStack = [];
function pushUndo(before) {
  undoStack.push(before);
  if (undoStack.length > 80) undoStack.shift();
  redoStack.length = 0;
}
const snapshot = () => pushUndo(JSON.stringify(P));
function undo() {
  if (!undoStack.length) return toast("Nothing to undo");
  redoStack.push(JSON.stringify(P));
  P = JSON.parse(undoStack.pop());
  afterStructural();
}
function redo() {
  if (!redoStack.length) return toast("Nothing to redo");
  undoStack.push(JSON.stringify(P));
  P = JSON.parse(redoStack.pop());
  afterStructural();
}

/* ---------- small helpers ---------- */
const $ = (id) => document.getElementById(id);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fmt = (n) => (n > 0 ? "+" + n : n < 0 ? "−" + -n : "0");
const zLabel = (z) => (z === 0 ? "core wall" : z > 0 ? "ornament" : "recess");
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function curVariant() {
  const list = P.stages[ui.stage];
  return list[clamp(ui.sel[ui.stage], 0, list.length - 1)] || null;
}
let toastT = 0;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("on"), 2200);
}

/* ============================================================
   EDITING
   ============================================================ */
function inBounds(x, y, z) {
  const b = bounds(P);
  return x >= b.xMin && x <= b.xMax && z >= b.zMin && z <= b.zMax && y >= 0 && y < P.heights[ui.stage];
}
function currentState() {
  const b = BMAP[ui.block];
  if (b.shape === "stairs") return makeState(b.id, { facing: ui.facing, half: ui.half });
  if (b.shape === "slab") return makeState(b.id, { type: ui.slabType });
  return b.id;
}
/** Applies one edit at (x,y,z), plus its mirror when mirroring is on. Returns true if anything changed. */
function applyAt(x, y, z, tool) {
  const v = curVariant();
  if (!v || !inBounds(x, y, z)) return false;
  if (tool === "pick") {
    const s = v.blocks[K(x, y, z)];
    if (!s) return false;
    const { id, props } = parseState(s);
    if (!BMAP[id]) return false;
    ui.block = id;
    if (props.facing) ui.facing = props.facing;
    if (props.half) ui.half = props.half;
    if (props.type) ui.slabType = props.type;
    setTool("place");
    renderCurrent();
    renderPalette();
    return false;
  }
  const st = tool === "place" ? currentState() : null;
  const targets = [[x, st]];
  if (ui.mirror) {
    const mx = mirrorX(P, x), b = bounds(P);
    if (mx !== x && mx >= b.xMin && mx <= b.xMax) targets.push([mx, st && mirrorState(st)]);
  }
  let changed = false;
  for (const [tx, s] of targets) {
    const k = K(tx, y, z);
    if (s) {
      if (v.blocks[k] !== s) { v.blocks[k] = s; changed = true; }
    } else if (v.blocks[k]) {
      delete v.blocks[k];
      changed = true;
    }
  }
  return changed;
}

/* ============================================================
   3D VIEW
   ============================================================ */
const canvas = $("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7068, 2.3));
const sun = new THREE.DirectionalLight(0xffffff, 1.7);
sun.position.set(0.6, 1, 0.9);
scene.add(sun);
const fill = new THREE.DirectionalLight(0xffffff, 0.55);
fill.position.set(-1, 0.3, -0.6);
scene.add(fill);

const world = new THREE.Group();
const helpers = new THREE.Group();
scene.add(world, helpers);
let layerPlane = null, voxelMeshes = [];
const hover = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.04, 1.04, 1.04)),
  new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }),
);
hover.renderOrder = 20;
hover.visible = false;
scene.add(hover);

function render3D() {
  clearGroup(world);
  clearGroup(helpers);
  voxelMeshes = [];
  layerPlane = null;
  const b = bounds(P), accent = css("--accent"), muted = css("--muted"), fg = css("--fg");
  scene.background = new THREE.Color(css("--viewport"));

  if (ui.mode === "edit") {
    const v = curVariant(), h = P.heights[ui.stage];
    $("viewtag").innerHTML = v ? `${STAGE_NAMES[ui.stage]} <small>${escapeHtml(v.name)}</small>` : STAGE_NAMES[ui.stage];
    if (v) for (const [k, s] of Object.entries(v.blocks)) { const [x, y, z] = unK(k); world.add(blockObject(s, x, y, z)); }
    // Stage bounds, Core Wall slab, mirror axis
    boxEdges(helpers, b.xMin - 0.5, 0, b.zMin - 0.5, b.xMax + 0.5, h, b.zMax + 0.5, muted, 0.45);
    boxEdges(helpers, b.xMin - 0.5, 0, -0.5, b.xMax + 0.5, h, 0.5, accent, 0.9);
    const ax = axisX(P);
    addLines(helpers, [[ax, -0.6, b.zMax + 0.55], [ax, h + 0.6, b.zMax + 0.55]], accent, 1, true);
    // Ground grid under the stage
    const gp = [];
    for (let x = b.xMin; x <= b.xMax + 1; x++) gp.push([x - 0.5, 0, b.zMin - 0.5], [x - 0.5, 0, b.zMax + 0.5]);
    for (let z = b.zMin; z <= b.zMax + 1; z++) gp.push([b.xMin - 0.5, 0, z - 0.5], [b.xMax + 0.5, 0, z - 0.5]);
    addLines(helpers, gp, muted, 0.25);
    // Active layer: tinted plane that is also a click target
    const pl = new THREE.Mesh(
      new THREE.PlaneGeometry(P.width, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(accent), transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }),
    );
    pl.position.set((b.xMin + b.xMax) / 2, h / 2, ui.layer);
    pl.userData.own = true;
    pl.userData.layer = true;
    helpers.add(pl);
    layerPlane = pl;
    boxEdges(helpers, b.xMin - 0.5, 0, ui.layer - 0.5, b.xMax + 0.5, h, ui.layer + 0.5, accent, 0.35);
    const lbl = textSprite("x = " + (P.width % 2 ? "0" : "−½") + " axis", accent);
    lbl.position.set(ax + lbl.scale.x / 2 + 0.2, h + 0.95, b.zMax + 0.55);
    helpers.add(lbl);
  } else {
    const A = assemble(P);
    const lot = plot(P);
    $("viewtag").innerHTML = `${A.floors} floors <small>${lot.xMax - lot.xMin + 1} × ${A.top} × ${buildingDepth(P)}</small>`;
    for (const [k, c] of A.cells) {
      const [x, y, z] = unK(k);
      const faded = ui.fade && c.kind === "body" && c.copy > 0;
      world.add(blockObject(c.s, x, y, z, faded ? 0.28 : 1));
    }
    if (ui.labels) {
      for (const s of A.segs) {
        addLines(helpers, [[b.xMin - 1.6, s.y0, b.zMax + 0.6], [b.xMax + 0.5, s.y0, b.zMax + 0.6]], muted, 0.55);
        const t = s.kind === "body" ? `BODY ${s.copy + 1}/${s.total}` : s.kind.toUpperCase();
        if (s.kind === "roof" && s.h <= 0) continue;
        const sp = textSprite(t, s.kind === "body" && s.copy > 0 ? muted : fg);
        sp.position.set(b.xMin - 1.8, s.y0 + s.h / 2, b.zMax + 0.6);
        helpers.add(sp);
      }
      addLines(helpers, [[b.xMin - 1.6, A.height, b.zMax + 0.6], [b.xMax + 0.5, A.height, b.zMax + 0.6]], muted, 0.55);
    }
    const gp = [];
    const R = Math.max(P.width, buildingDepth(P)) + 6;
    for (let i = -R; i <= R; i++) { gp.push([i - 0.5, 0, -R], [i - 0.5, 0, R]); gp.push([-R, 0, i - 0.5], [R, 0, i - 0.5]); }
    addLines(helpers, gp, muted, 0.12);
    helpers.add(pasteMarker(accent));
  }
  world.traverse((o) => { if (o.isMesh) voxelMeshes.push(o); });
}

/**
 * The paste point: where the player stands for //paste, or where Axiom
 * anchors the blueprint. It is the block at x = 0, y = 0, z = 0, the bottom
 * of the Core Wall's centre column. Drawn on top so it shows through walls.
 */
function pasteMarker(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), depthTest: false, transparent: true, opacity: 0.95 });
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), mat);
  gem.position.set(0, 0.5, 0);
  gem.renderOrder = 30;
  gem.userData.own = true;
  g.add(gem);
  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02)),
    new THREE.LineBasicMaterial({ color: new THREE.Color(color), depthTest: false, transparent: true }),
  );
  box.position.set(0, 0.5, 0);
  box.renderOrder = 30;
  box.userData.own = true;
  g.add(box);
  const label = textSprite("paste point", color);
  label.center.set(0, 0.5); // text starts beside the marker and runs outward
  label.position.set(0.75, 0.5, 0.9);
  label.renderOrder = 31;
  g.add(label);
  return g;
}

function fitView() {
  const b = bounds(P);
  let h, zMin = b.zMin, xMin = b.xMin, xMax = b.xMax, zMax = b.zMax;
  if (ui.mode === "edit") h = P.heights[ui.stage];
  else {
    // Frame everything that was built: corner buildings reach out to the side street.
    const A = assemble(P);
    h = A.top;
    zMin = -buildingDepth(P);
    for (const k of A.cells.keys()) {
      const [x, , z] = unK(k);
      xMin = Math.min(xMin, x); xMax = Math.max(xMax, x); zMax = Math.max(zMax, z);
    }
  }
  const cx = (xMin + xMax) / 2, cy = h / 2, cz = (zMin + zMax) / 2;
  const size = Math.max(xMax - xMin + 1, h, zMax - zMin) + 4;
  controls.target.set(cx, cy, cz);
  const dist = (size / (2 * Math.tan((camera.fov * Math.PI) / 360))) * 1.15;
  camera.position.set(cx + dist * 0.55, cy + dist * 0.32, cz + dist * 0.78);
  controls.update();
}
function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
  camera.aspect = Math.max(1, r.width) / Math.max(1, r.height);
  camera.updateProjectionMatrix();
}
new ResizeObserver(() => { resize(); renderGrid(); }).observe(canvas.parentElement);
(function loop() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
})();

/**
 * Pictures an assembled building alone (no guides, no fading) from the
 * front-right, as a square PNG with a transparent background.
 * @returns {Promise<Uint8Array>}
 */
async function thumbnailPng(p = P, size = 256) {
  const g = new THREE.Group();
  for (const [k, c] of assemble(p).cells) { const [x, y, z] = unK(k); g.add(blockObject(c.s, x, y, z)); }
  const shown = [world.visible, helpers.visible, hover.visible], bg = scene.background, alpha = renderer.getClearAlpha();
  world.visible = helpers.visible = hover.visible = false;
  scene.background = null;
  renderer.setClearAlpha(0);
  scene.add(g);

  const sphere = new THREE.Box3().setFromObject(g).getBoundingSphere(new THREE.Sphere());
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 2000);
  const dist = sphere.radius / Math.sin((cam.fov * Math.PI) / 360);
  cam.position.copy(sphere.center).addScaledVector(new THREE.Vector3(0.6, 0.45, 1).normalize(), dist);
  cam.lookAt(sphere.center);

  const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const px = new Uint8Array(size * size * 4);
  try {
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
  } finally {
    renderer.setRenderTarget(null);
    rt.dispose();
    scene.remove(g);
    clearGroup(g);
    [world.visible, helpers.visible, hover.visible] = shown;
    scene.background = bg;
    renderer.setClearAlpha(alpha);
  }

  // WebGL rows run bottom to top; images run top to bottom.
  const c2 = document.createElement("canvas");
  c2.width = c2.height = size;
  const img = new ImageData(size, size);
  for (let y = 0; y < size; y++) img.data.set(px.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
  c2.getContext("2d").putImageData(img, 0, 0);
  const blob = await new Promise((res) => c2.toBlob(res, "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

/* ---------- clicking in 3D ---------- */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function hitAt(ev) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const targets = layerPlane ? voxelMeshes.concat([layerPlane]) : voxelMeshes;
  const hit = ray.intersectObjects(targets, false)[0];
  if (!hit) return null;
  if (hit.object.userData.layer) {
    const c = [Math.round(hit.point.x), Math.floor(hit.point.y), ui.layer];
    return { cell: c, place: c };
  }
  const cell = hit.object.userData.cell, n = hit.face.normal;
  return { cell, place: [cell[0] + Math.round(n.x), cell[1] + Math.round(n.y), cell[2] + Math.round(n.z)] };
}
let down = null;
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey, t: performance.now() }; });
canvas.addEventListener("pointerup", (e) => {
  if (!down) return;
  const d = Math.hypot(e.clientX - down.x, e.clientY - down.y), info = down;
  down = null;
  // A short press without dragging is a click; anything else was orbiting.
  if (ui.mode !== "edit" || d > 5 || performance.now() - info.t > 600) return;
  const h = hitAt(e);
  if (!h) return;
  const tool = info.b === 2 || info.shift ? "erase" : ui.tool;
  const [x, y, z] = tool === "place" ? h.place : h.cell;
  if (!inBounds(x, y, z)) { if (tool === "place") toast("That spot is outside the stage bounds"); return; }
  const before = JSON.stringify(P);
  if (applyAt(x, y, z, tool)) { pushUndo(before); afterEdit(); }
});
canvas.addEventListener("pointermove", (e) => {
  if (ui.mode !== "edit" || e.buttons) { hover.visible = false; return; }
  const h = hitAt(e);
  if (!h) { hover.visible = false; $("coord").textContent = "—"; return; }
  const erasing = ui.tool === "erase" || e.shiftKey;
  const [x, y, z] = ui.tool === "place" && !e.shiftKey ? h.place : h.cell;
  if (!inBounds(x, y, z)) { hover.visible = false; $("coord").textContent = "outside bounds"; return; }
  hover.position.set(x, y + 0.5, z);
  hover.visible = true;
  hover.material.color.set(css(erasing ? "--danger" : "--accent"));
  showCoord(x, y, z);
});
canvas.addEventListener("pointerleave", () => { hover.visible = false; });
function showCoord(x, y, z) {
  const s = curVariant()?.blocks[K(x, y, z)];
  $("coord").textContent = `x ${fmt(x)} · y ${y} · z ${fmt(z)}  ${zLabel(z)}${s ? "  ·  " + shortId(parseState(s).id) : ""}`;
}

/* ============================================================
   ELEVATION GRID (2D, one z layer at a time)
   ============================================================ */
const grid = $("grid"), gctx = grid.getContext("2d");
let G = { cell: 20, ml: 26, mt: 8 };
function renderGrid() {
  if (ui.mode !== "edit") return;
  const v = curVariant(), b = bounds(P), h = P.heights[ui.stage];
  const avail = Math.max(160, $("gridwrap").clientWidth - 14);
  const cell = clamp(Math.floor((avail - 28) / P.width), 8, 30);
  G = { cell, ml: 26, mt: 8 };
  const W = G.ml + P.width * cell + 4, H = G.mt + h * cell + 20;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  grid.width = W * dpr; grid.height = H * dpr;
  grid.style.width = W + "px"; grid.style.height = H + "px";
  const c = gctx;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  const line = css("--line"), muted = css("--muted"), accent = css("--accent");
  c.fillStyle = css("--panel");
  c.fillRect(G.ml, G.mt, P.width * cell, h * cell);
  const px = (x) => G.ml + (x - b.xMin) * cell, py = (y) => G.mt + (h - 1 - y) * cell;
  // Centre column tint
  c.fillStyle = accent; c.globalAlpha = 0.08; c.fillRect(px(0), G.mt, cell, h * cell); c.globalAlpha = 1;
  for (let y = 0; y < h; y++)
    for (let x = b.xMin; x <= b.xMax; x++) {
      const s = v?.blocks[K(x, y, ui.layer)];
      const X = px(x), Y = py(y);
      if (!s) {
        // Faint ghost of the Core Wall when editing another layer
        if (ui.layer !== 0 && v?.blocks[K(x, y, 0)]) { c.fillStyle = muted; c.globalAlpha = 0.13; c.fillRect(X + 1, Y + 1, cell - 2, cell - 2); c.globalAlpha = 1; }
        continue;
      }
      const { id, props } = parseState(s);
      const bk = BMAP[id] || { color: "#d000d0", shape: "cube", opacity: 1 };
      c.fillStyle = bk.color;
      c.globalAlpha = bk.opacity < 1 ? 0.65 : 1;
      if (bk.shape === "slab" && props.type !== "double") c.fillRect(X, props.type === "top" ? Y : Y + cell / 2, cell, cell / 2);
      else if (bk.shape === "stairs") {
        c.fillRect(X, props.half === "top" ? Y : Y + cell / 2, cell, cell / 2);
        const yy = props.half === "top" ? Y + cell / 2 : Y;
        if (props.facing === "east") c.fillRect(X + cell / 2, yy, cell / 2, cell / 2);
        else if (props.facing === "west") c.fillRect(X, yy, cell / 2, cell / 2);
        else { c.globalAlpha = props.facing === "north" ? 0.55 : 1; c.fillRect(X, yy, cell, cell / 2); }
      } else if (bk.shape === "pane") {
        c.fillRect(X, Y, cell, cell);
        c.globalAlpha = 1;
        c.strokeStyle = "rgba(255,255,255,.55)";
        c.beginPath(); c.moveTo(X + cell * 0.25, Y + cell * 0.75); c.lineTo(X + cell * 0.75, Y + cell * 0.25); c.stroke();
      } else c.fillRect(X, Y, cell, cell);
      c.globalAlpha = 1;
    }
  c.strokeStyle = line; c.lineWidth = 1; c.beginPath();
  for (let i = 0; i <= P.width; i++) { const X = G.ml + i * cell + 0.5; c.moveTo(X, G.mt); c.lineTo(X, G.mt + h * cell); }
  for (let j = 0; j <= h; j++) { const Y = G.mt + j * cell + 0.5; c.moveTo(G.ml, Y); c.lineTo(G.ml + P.width * cell, Y); }
  c.stroke();
  // Mirror axis
  const ax = G.ml + (axisX(P) - b.xMin + 0.5) * cell;
  c.strokeStyle = accent; c.setLineDash([4, 3]); c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(ax, G.mt - 4); c.lineTo(ax, G.mt + h * cell + 4); c.stroke(); c.setLineDash([]);
  // Axis labels
  c.fillStyle = muted; c.font = `10.5px ${css("--f-mono")}`; c.textAlign = "right"; c.textBaseline = "middle";
  for (let y = 0; y < h; y++) c.fillText(String(y), G.ml - 5, py(y) + cell / 2);
  c.textAlign = "center"; c.textBaseline = "top";
  const step = cell < 14 ? 2 : 1;
  for (let x = b.xMin; x <= b.xMax; x++)
    if ((x - b.xMin) % step === 0 || x === 0) {
      c.fillStyle = x === 0 ? accent : muted;
      c.fillText(x === 0 ? "0" : String(x).replace("-", "−"), px(x) + cell / 2, G.mt + h * cell + 4);
    }
}
function gridCell(e) {
  const r = grid.getBoundingClientRect(), b = bounds(P), h = P.heights[ui.stage];
  return [Math.floor((e.clientX - r.left - G.ml) / G.cell) + b.xMin, h - 1 - Math.floor((e.clientY - r.top - G.mt) / G.cell)];
}
let gStroke = null;
grid.addEventListener("contextmenu", (e) => e.preventDefault());
grid.addEventListener("pointerdown", (e) => {
  const [x, y] = gridCell(e);
  if (!inBounds(x, y, ui.layer)) return;
  grid.setPointerCapture(e.pointerId);
  gStroke = { tool: e.button === 2 || e.shiftKey ? "erase" : ui.tool, before: JSON.stringify(P), changed: false, seen: new Set() };
  strokeAt(x, y);
});
grid.addEventListener("pointermove", (e) => {
  const [x, y] = gridCell(e);
  if (inBounds(x, y, ui.layer)) showCoord(x, y, ui.layer);
  if (gStroke && gStroke.tool !== "pick") strokeAt(x, y);
});
function strokeAt(x, y) {
  if (!inBounds(x, y, ui.layer)) return;
  const k = x + "," + y;
  if (gStroke.seen.has(k)) return;
  gStroke.seen.add(k);
  if (applyAt(x, y, ui.layer, gStroke.tool)) { gStroke.changed = true; renderGrid(); render3D(); }
}
function endStroke() {
  if (!gStroke) return;
  if (gStroke.changed) { pushUndo(gStroke.before); afterEdit(); }
  gStroke = null;
}
grid.addEventListener("pointerup", endStroke);
grid.addEventListener("pointercancel", endStroke);

/* ============================================================
   SIDE PANELS
   ============================================================ */
function renderLayers() {
  const b = bounds(P), box = $("layers");
  box.innerHTML = "";
  if (ui.layer > b.zMax || ui.layer < b.zMin) ui.layer = 0;
  for (let z = b.zMax; z >= b.zMin; z--) {
    const bt = document.createElement("button");
    bt.textContent = "z " + fmt(z);
    bt.setAttribute("aria-pressed", String(z === ui.layer));
    bt.title = zLabel(z);
    bt.onclick = () => { ui.layer = z; renderLayers(); renderGrid(); render3D(); };
    box.appendChild(bt);
  }
  $("layerInfo").textContent = zLabel(ui.layer);
}
function renderPalette() {
  const box = $("palette"), f = ui.filter.toLowerCase();
  box.innerHTML = "";
  for (const g of [...new Set(BLOCKS.map((b) => b.group))]) {
    const list = BLOCKS.filter((b) => b.group === g && (!f || b.name.toLowerCase().includes(f) || b.id.includes(f)));
    if (!list.length) continue;
    const sec = document.createElement("div");
    sec.className = "pgroup";
    sec.innerHTML = `<h3>${g}</h3>`;
    const gd = document.createElement("div");
    gd.className = "pgrid";
    for (const b of list) {
      const bt = document.createElement("button");
      bt.setAttribute("aria-pressed", String(b.id === ui.block));
      bt.title = b.id;
      bt.innerHTML = `<span class="sw" style="background:${b.color};opacity:${b.opacity < 1 ? 0.7 : 1}"></span><span>${b.name}</span>`;
      bt.onclick = () => { ui.block = b.id; if (ui.tool !== "place") setTool("place"); renderPalette(); renderCurrent(); };
      gd.appendChild(bt);
    }
    sec.appendChild(gd);
    box.appendChild(sec);
  }
  if (!box.children.length) box.innerHTML = `<p class="lbl">No blocks match “${escapeHtml(ui.filter)}”.</p>`;
}
function renderCurrent() {
  const b = BMAP[ui.block];
  $("curSw").style.background = b.color;
  $("curName").textContent = b.name;
  $("curState").textContent = currentState();
  $("stairOpts").hidden = b.shape !== "stairs";
  $("slabOpts").hidden = b.shape !== "slab";
  $("facing").value = ui.facing;
  $("half").value = ui.half;
  $("slabType").value = ui.slabType;
}
function setTool(t) {
  ui.tool = t;
  document.querySelectorAll("#tools button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === t)));
  updateHint();
}
function updateHint() {
  $("hint").textContent = ui.mode === "edit"
    ? "Click: " + ui.tool + " · Right-click or Shift: erase · Drag: orbit · Ctrl+Z: undo"
    : "Drag: orbit · Right-drag: pan · Scroll: zoom";
}
function renderVariants() {
  const list = P.stages[ui.stage], ul = $("vlist");
  ul.innerHTML = "";
  ui.sel[ui.stage] = clamp(ui.sel[ui.stage], 0, Math.max(0, list.length - 1));
  list.forEach((v, i) => {
    const li = document.createElement("li");
    const bt = document.createElement("button");
    bt.className = "vpick";
    bt.setAttribute("aria-pressed", String(i === ui.sel[ui.stage]));
    bt.innerHTML = `<span>${escapeHtml(v.name)}</span><small>${Object.keys(v.blocks).length} blocks</small>`;
    bt.onclick = () => { ui.sel[ui.stage] = i; renderVariants(); render3D(); renderGrid(); };
    li.appendChild(bt);
    ul.appendChild(li);
  });
  if (!list.length) ul.innerHTML = `<li class="lbl">No ${STAGE_NAMES[ui.stage].toLowerCase()} variants yet. Add one to start.</li>`;
  const v = curVariant();
  $("varName").value = v ? v.name : "";
  $("varName").disabled = !v;
  $("delVar").disabled = !v;
  $("dupVar").disabled = !v;
  document.querySelectorAll(".stagetabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.stage === ui.stage)));
  $("cntBase").textContent = P.stages.base.length + " var · " + P.heights.base + "h";
  $("cntBody").textContent = P.stages.body.length + " var · " + P.heights.body + "h";
  $("cntCap").textContent = P.stages.capital.length + " var · " + P.heights.capital + "h";
}
function renderChecks() {
  $("checks").innerHTML = checks(P).map(([t, m]) => `<li class="${t}">${escapeHtml(m)}</li>`).join("");
}
function syncInputs() {
  const b = bounds(P);
  $("inWidth").value = P.width;
  $("inFront").value = P.depthFront;
  $("inBack").value = P.depthBack;
  $("hBase").value = P.heights.base;
  $("hBody").value = P.heights.body;
  $("hCap").value = P.heights.capital;
  $("coreBlock").value = P.coreBlock;
  $("mcVersion").value = P.mcVersion;
  $("xrange").textContent = `x ${fmt(b.xMin)}…${fmt(b.xMax)}`;
  $("axisInfo").textContent = P.width % 2
    ? "Odd width. Centre column x=0, mirror axis through it."
    : "Even width. Centre column x=0 is the right of the middle pair; mirror axis at x=−½.";
  $("optMirror").checked = ui.mirror;
  $("optFade").checked = ui.fade;
  $("optLabels").checked = ui.labels;
}
function renderBuildPanel() {
  const a = P.assembly;
  const fillSel = (id, list, key) => {
    const s = $(id);
    s.innerHTML = list.map((v, i) => `<option value="${i}">${escapeHtml(v.name)}</option>`).join("");
    a[key] = clamp(a[key], 0, Math.max(0, list.length - 1));
    s.value = a[key];
    s.disabled = !list.length;
  };
  const types = typeList(P);
  if (!types.includes(a.type)) a.type = types[0];
  $("pickType").innerHTML = types.map((t) => `<option value="${t}"${t === a.type ? " selected" : ""}>${TYPE_NAMES[t]}</option>`).join("");
  $("pickType").disabled = types.length < 2;
  fillSel("pickBase", P.stages.base, "base");
  fillSel("pickBody", P.stages.body, "body");
  fillSel("pickCap", P.stages.capital, "capital");
  if (P.roofs.length) fillSel("pickRoof", P.roofs, "roof");
  else { $("pickRoof").innerHTML = "<option>Flat top (no roof styles yet)</option>"; $("pickRoof").disabled = true; }
  $("fMin").value = P.floorMin;
  $("fMax").value = P.floorMax;
  $("dMin").value = P.depthMin;
  $("dMax").value = P.depthMax;
  $("dMin").min = $("dMax").min = minDepth(P);
  const dr = $("depth");
  dr.min = P.depthMin;
  dr.max = Math.max(P.depthMin, P.depthMax);
  a.depth = clamp(a.depth, P.depthMin, Math.max(P.depthMin, P.depthMax));
  dr.value = a.depth;
  $("depthVal").textContent = `${buildingDepth(P)} blocks`;
  // Only worth a slider when there is a range to choose from.
  $("depthFld").hidden = P.depthMax <= P.depthMin;
  const fr = $("floors");
  fr.min = P.floorMin;
  fr.max = Math.max(P.floorMin, P.floorMax);
  a.floors = clamp(a.floors, P.floorMin, Math.max(P.floorMin, P.floorMax));
  fr.value = a.floors;
  $("floorsVal").textContent = `${a.floors} (base + ${a.floors - 2} body + capital)`;
  const { n, r } = comboCount(P);
  $("comboN").textContent = n.toLocaleString();
  const roofs = P.roofs.length ? ` × ${P.roofs.length} roof${P.roofs.length === 1 ? "" : "s"}` : "";
  const nd = Math.max(0, P.depthMax - P.depthMin + 1);
  const depths = (nd > 1 ? ` × ${nd} depths` : "") + (types.length > 1 ? ` × ${types.length} building types` : "");
  $("comboF").textContent = `${P.stages.base.length} base × ${P.stages.body.length} body × ${P.stages.capital.length} capital${roofs} × ${r} floor count${r === 1 ? "" : "s"}${depths}`;
  try {
    const { size: [w, h, l], blocks } = toSchem(P);
    $("schemInfo").textContent = `${schemName(P)}: ${w} × ${h} × ${l}, ${blocks.toLocaleString()} blocks. The paste point is marked in the 3D view.`;
    $("dlSchem").disabled = $("dlBp").disabled = false;
  } catch (e) {
    $("schemInfo").textContent = e.message;
    $("dlSchem").disabled = $("dlBp").disabled = true;
  }
  renderTypes();
  renderRoofs();
  renderBulk();
  const rows = $("pwRows");
  rows.innerHTML = "";
  P.partyWall.forEach((e, i) => {
    const d = document.createElement("div");
    d.className = "pw";
    const opts = BLOCKS.filter((b) => b.shape === "cube").map((b) => `<option value="${b.id}"${b.id === e.block ? " selected" : ""}>${b.name}</option>`).join("");
    d.innerHTML = `<select id="pwB${i}" aria-label="Party wall block ${i + 1}">${opts}</select><input type="number" id="pwW${i}" min="0" max="99" value="${e.weight}" aria-label="Weight"><button class="btn small danger" aria-label="Remove">✕</button>`;
    d.querySelector("select").onchange = (ev) => { snapshot(); e.block = ev.target.value; afterEdit(); };
    d.querySelector("input").onchange = (ev) => { snapshot(); e.weight = clamp(+ev.target.value || 0, 0, 99); afterEdit(); };
    d.querySelector("button").onclick = () => { snapshot(); P.partyWall.splice(i, 1); afterEdit(); };
    rows.appendChild(d);
  });
  if (!P.partyWall.length) rows.innerHTML = `<p class="lbl">No party wall blocks. Side and back walls are left open.</p>`;
}

/* ---------- refresh orchestration ---------- */
function afterEdit() {
  save();
  renderVariants();
  renderChecks();
  render3D();
  renderGrid();
  if (ui.mode !== "edit") renderBuildPanel();
}
function afterStructural() {
  for (const k of STAGES) ui.sel[k] = clamp(ui.sel[k], 0, Math.max(0, P.stages[k].length - 1));
  save(); syncInputs(); renderLayers(); renderVariants(); renderChecks(); renderBuildPanel(); render3D(); renderGrid();
}

/* ============================================================
   INPUT WIRING
   ============================================================ */
function numInput(id, apply) {
  $(id).addEventListener("change", (e) => {
    const n = parseInt(e.target.value, 10);
    if (!Number.isFinite(n)) { syncInputs(); return; }
    snapshot();
    const msg = apply(n);
    const dropped = pruneAll(P);
    afterStructural();
    fitView();
    if (dropped) toast(`${dropped} block${dropped > 1 ? "s" : ""} outside the new size removed. Ctrl+Z restores them.`);
    else if (msg) toast(msg);
  });
}
numInput("inWidth", (n) => {
  P.width = clamp(n, 3, 48);
  const xm = bounds(P).xMax;
  if (P.depthFront > xm || P.depthBack > xm) {
    P.depthFront = Math.min(P.depthFront, xm);
    P.depthBack = Math.min(P.depthBack, xm);
    return "Depth reduced to fit the new width.";
  }
});
numInput("inFront", (n) => { const xm = bounds(P).xMax; P.depthFront = clamp(n, 0, xm); if (n > xm) return `Front depth is limited to ${xm} at this width.`; });
numInput("inBack", (n) => { const xm = bounds(P).xMax; P.depthBack = clamp(n, 0, xm); if (n > xm) return `Back depth is limited to ${xm} at this width.`; });
numInput("hBase", (n) => { P.heights.base = clamp(n, 2, 24); });
numInput("hBody", (n) => { P.heights.body = clamp(n, 2, 24); });
numInput("hCap", (n) => { P.heights.capital = clamp(n, 1, 24); });
$("coreBlock").innerHTML = BLOCKS.filter((b) => b.shape === "cube").map((b) => `<option value="${b.id}">${b.name}</option>`).join("");
$("coreBlock").onchange = (e) => { P.coreBlock = e.target.value; save(); };
$("mcVersion").onchange = (e) => { P.mcVersion = e.target.value; save(); };

document.querySelectorAll(".stagetabs button").forEach((b) => (b.onclick = () => { ui.stage = b.dataset.stage; renderVariants(); render3D(); renderGrid(); fitView(); }));
$("newVar").onclick = () => {
  snapshot();
  const list = P.stages[ui.stage];
  list.push(newVariant(P, ui.stage, `${STAGE_NAMES[ui.stage]} ${list.length + 1}`));
  ui.sel[ui.stage] = list.length - 1;
  afterEdit();
};
$("dupVar").onclick = () => {
  const v = curVariant();
  if (!v) return;
  snapshot();
  const c = JSON.parse(JSON.stringify(v));
  c.id = uid();
  c.name = v.name + " copy";
  P.stages[ui.stage].splice(ui.sel[ui.stage] + 1, 0, c);
  ui.sel[ui.stage]++;
  afterEdit();
};
$("varName").addEventListener("change", (e) => { const v = curVariant(); if (!v) return; snapshot(); v.name = e.target.value.trim() || v.name; afterEdit(); });
let delArm = 0;
$("delVar").onclick = () => {
  const v = curVariant();
  if (!v) return;
  const bt = $("delVar");
  if (!delArm) {
    bt.textContent = `Confirm: delete “${v.name}”`;
    delArm = setTimeout(() => { bt.textContent = "Delete variant"; delArm = 0; }, 3000);
    return;
  }
  clearTimeout(delArm);
  delArm = 0;
  bt.textContent = "Delete variant";
  snapshot();
  P.stages[ui.stage].splice(ui.sel[ui.stage], 1);
  afterStructural();
  toast(`Deleted “${v.name}”. Ctrl+Z brings it back.`);
};

document.querySelectorAll("#tools button").forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
$("optMirror").onchange = (e) => { ui.mirror = e.target.checked; };
$("facing").onchange = (e) => { ui.facing = e.target.value; renderCurrent(); };
$("half").onchange = (e) => { ui.half = e.target.value; renderCurrent(); };
$("slabType").onchange = (e) => { ui.slabType = e.target.value; renderCurrent(); };
$("pSearch").addEventListener("input", (e) => { ui.filter = e.target.value; renderPalette(); });

$("pickBase").onchange = (e) => { P.assembly.base = +e.target.value; save(); render3D(); };
$("pickBody").onchange = (e) => { P.assembly.body = +e.target.value; save(); render3D(); };
$("pickCap").onchange = (e) => { P.assembly.capital = +e.target.value; save(); render3D(); };
$("pickRoof").onchange = (e) => { P.assembly.roof = +e.target.value; save(); renderBuildPanel(); render3D(); fitView(); };
$("floors").addEventListener("input", (e) => { P.assembly.floors = +e.target.value; save(); renderBuildPanel(); render3D(); });
$("floors").addEventListener("change", () => fitView());
$("fMin").onchange = (e) => { snapshot(); P.floorMin = clamp(parseInt(e.target.value, 10) || 3, 3, 200); if (P.floorMax < P.floorMin) P.floorMax = P.floorMin; afterStructural(); };
$("fMax").onchange = (e) => { snapshot(); P.floorMax = clamp(parseInt(e.target.value, 10) || 3, 3, 200); if (P.floorMax < P.floorMin) P.floorMin = P.floorMax; afterStructural(); };
const depthIn = (v) => clamp(parseInt(v, 10) || minDepth(P), minDepth(P), 64);
$("dMin").onchange = (e) => { snapshot(); P.depthMin = depthIn(e.target.value); if (P.depthMax < P.depthMin) P.depthMax = P.depthMin; afterStructural(); fitView(); };
$("dMax").onchange = (e) => { snapshot(); P.depthMax = depthIn(e.target.value); if (P.depthMax < P.depthMin) P.depthMin = P.depthMax; afterStructural(); fitView(); };
$("depth").addEventListener("input", (e) => { P.assembly.depth = +e.target.value; save(); renderBuildPanel(); render3D(); });
$("depth").addEventListener("change", () => fitView());
$("pwAdd").onclick = () => { snapshot(); P.partyWall.push({ block: "minecraft:stone_bricks", weight: 1 }); afterEdit(); };
$("optFade").onchange = (e) => { ui.fade = e.target.checked; render3D(); };
$("optLabels").onchange = (e) => { ui.labels = e.target.checked; render3D(); };
$("randomize").onclick = () => {
  const a = P.assembly, r = Math.random;
  if (!P.stages.base.length || !P.stages.body.length || !P.stages.capital.length) return toast("Each stage needs at least one variant first.");
  a.base = Math.floor(r() * P.stages.base.length);
  a.body = Math.floor(r() * P.stages.body.length);
  a.capital = Math.floor(r() * P.stages.capital.length);
  a.roof = Math.floor(r() * Math.max(1, P.roofs.length));
  a.floors = P.floorMin + Math.floor(r() * (P.floorMax - P.floorMin + 1));
  a.depth = P.depthMin + Math.floor(r() * (P.depthMax - P.depthMin + 1));
  const types = typeList(P);
  a.type = types[Math.floor(r() * types.length)];
  a.seed = Math.floor(r() * 1e9);
  save(); renderBuildPanel(); render3D(); fitView();
};

function setMode(m) {
  ui.mode = m;
  $("app").dataset.mode = m;
  $("modeEdit").setAttribute("aria-pressed", String(m === "edit"));
  $("modeBuild").setAttribute("aria-pressed", String(m === "build"));
  $("modeExport").setAttribute("aria-pressed", String(m === "export"));
  $("leftEdit").hidden = m !== "edit";
  $("rightEdit").hidden = m !== "edit";
  $("leftBuild").hidden = $("rightBuild").hidden = m !== "build";
  $("leftExport").hidden = $("rightExport").hidden = m !== "export";
  // Combinations and Random building show at the top of both Final Assembly and Export.
  const panel = m === "export" ? $("leftExport") : $("leftBuild");
  if ($("comboSec").parentElement !== panel) panel.prepend($("comboSec"));
  hover.visible = false;
  $("coord").textContent = "—";
  if (m !== "edit") renderBuildPanel();
  updateHint();
  render3D();
  requestAnimationFrame(() => { resize(); renderGrid(); fitView(); });
}
$("modeEdit").onclick = () => setMode("edit");
const toAssembled = (m) => () => {
  if (checks(P).some((c) => c[0] === "err")) toast("Fix the items under Checks to assemble a full building.");
  setMode(m);
};
$("modeBuild").onclick = toAssembled("build");
$("modeExport").onclick = toAssembled("export");
$("resetView").onclick = fitView;

/* ---------- project drawer ---------- */
$("projBtn").onclick = () => {
  const d = $("drawer");
  d.hidden = !d.hidden;
  $("projBtn").setAttribute("aria-expanded", String(!d.hidden));
  if (!d.hidden) $("projText").value = JSON.stringify(P);
  requestAnimationFrame(resize);
};
$("copyJson").onclick = () => {
  const t = JSON.stringify(P);
  $("projText").value = t;
  const fallback = () => { $("projText").focus(); $("projText").select(); toast("Text selected. Press Ctrl+C to copy."); };
  try { navigator.clipboard.writeText(t).then(() => toast("Project JSON copied"), fallback); } catch (e) { fallback(); }
};
/** Hands the browser a file to save. */
function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("dlJson").onclick = () => download("instrumentum-urbis-project.json", new Blob([JSON.stringify(P, null, 2)], { type: "application/json" }));
const gzip = async (bytes) =>
  new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
$("dlSchem").onclick = async () => {
  let r;
  try { r = toSchem(P); } catch (e) { return toast(e.message); }
  // .schem files are gzipped NBT.
  download(schemName(P) + ".schem", new Blob([await gzip(r.bytes)]));
  toast("Downloaded " + schemName(P) + ".schem");
};
/** Builds an Axiom blueprint file, thumbnail included. */
async function blueprintFile(p = P) {
  const parts = blueprintParts(p);
  return { bytes: packBlueprint(parts.header, await thumbnailPng(p), await gzip(parts.blocks)), blocks: parts.count };
}
$("dlBp").onclick = async () => {
  let bytes;
  try { ({ bytes } = await blueprintFile()); } catch (e) { return toast(e.message); }
  download(schemName(P) + ".bp", new Blob([bytes]));
  toast("Downloaded " + schemName(P) + ".bp");
};
/* ---------- building types ---------- */
function renderTypes() {
  const t = P.types;
  $("tyMid").checked = t.mid;
  $("tyCornerOn").checked = t.corner;
  $("tySharp").checked = t.sharp;
  $("tyChamfered").checked = t.chamfered;
  $("tyChamfer").value = t.chamfer;
  $("tyChamferVal").textContent = `${t.chamfer} block${t.chamfer === 1 ? "" : "s"}`;
  $("tyCorner").hidden = !t.corner;
  $("tyChamferFld").hidden = !t.chamfered;
}
/** Tick boxes: keep at least one building type, and at least one corner style when corners are on. */
const typeTick = (id, key, group, msg) => {
  $(id).onchange = (e) => {
    const t = P.types;
    if (!e.target.checked && group.every((k) => k === key || !t[k])) {
      e.target.checked = true;
      return toast(msg);
    }
    snapshot();
    t[key] = e.target.checked;
    save(); renderBuildPanel(); render3D(); fitView();
  };
};
const KINDS = ["mid", "corner"], STYLES = ["sharp", "chamfered"];
typeTick("tyMid", "mid", KINDS, "Keep at least one building type.");
typeTick("tyCornerOn", "corner", KINDS, "Keep at least one building type.");
typeTick("tySharp", "sharp", STYLES, "Keep sharp or chamfered ticked for corner buildings.");
typeTick("tyChamfered", "chamfered", STYLES, "Keep sharp or chamfered ticked for corner buildings.");
let chamferDrag = false;
$("tyChamfer").addEventListener("input", (e) => {
  if (!chamferDrag) { snapshot(); chamferDrag = true; }
  P.types.chamfer = +e.target.value;
  $("tyChamferVal").textContent = `${P.types.chamfer} block${P.types.chamfer === 1 ? "" : "s"}`;
  save(); render3D();
});
$("tyChamfer").addEventListener("change", () => { chamferDrag = false; renderBuildPanel(); });
$("pickType").onchange = (e) => { P.assembly.type = e.target.value; save(); renderBuildPanel(); render3D(); fitView(); };

/* ---------- roofs ---------- */
const curRoof = () => (P.roofs.length ? P.roofs[clamp(P.assembly.roof, 0, P.roofs.length - 1)] : null);
const cubeOptions = (sel) =>
  BLOCKS.filter((b) => b.shape === "cube").map((b) => `<option value="${b.id}"${b.id === sel ? " selected" : ""}>${escapeHtml(b.name)}</option>`).join("");
const edgeText = (e) => (e < 0 ? `inset ${-e}` : e > 0 ? `overhang ${e}` : "flush with the walls");

function renderRoofs() {
  const r = curRoof();
  $("roofEdit").hidden = !r;
  $("roofDup").disabled = $("roofDel").disabled = !r;
  if (!r) return;
  const sloped = SLOPED.has(r.type);
  $("roofName").value = r.name;
  $("roofType").value = r.type;
  $("roofRidge").value = r.ridge;
  $("roofHeight").value = r.height;
  $("roofHeightVal").textContent = `${r.height} block${r.height === 1 ? "" : "s"}`;
  $("roofEdge").value = r.edge;
  $("roofEdgeVal").textContent = edgeText(r.edge);
  $("roofFlip").checked = r.flip;
  $("roofGable").innerHTML = cubeOptions(r.gableBlock || P.coreBlock);
  $("roofParapet").checked = r.parapet;
  $("roofParapetBlock").innerHTML = cubeOptions(r.parapetBlock);
  $("roofDensity").value = Math.round(r.density * 100);
  $("roofDensityVal").textContent = Math.round(r.density * 100) + "%";
  $("roofBlend").value = Math.round(r.blend * 100);
  $("roofBlendVal").textContent = Math.round(r.blend * 100) + "%";
  const show = {
    sloped,
    flip: r.type === "sloped",
    gableBlock: sloped && r.ridge === "street",
    flat: r.type === "flat",
    parapetBlock: r.type === "garden" || (r.type === "flat" && r.parapet),
    garden: r.type === "garden",
    bands: r.type !== "garden",
    blend: sloped && r.bands.length > 1,
  };
  document.querySelectorAll("#roofEdit [data-for]").forEach((el) => { el.hidden = !show[el.dataset.for]; });
  $("roofBandsHint").textContent = sloped ? "(eaves at the top of the list, ridge at the bottom)" : "(a flat roof uses the first band)";
  renderBands(r);
}

/** One box per band; each band lists its materials with weights. */
function renderBands(r) {
  const box = $("roofBands");
  box.innerHTML = "";
  r.bands.forEach((band, bi) => {
    const d = document.createElement("div");
    d.className = "band";
    const label = r.bands.length === 1 ? "Whole roof" : bi === 0 ? "Band 1 · eaves" : bi === r.bands.length - 1 ? `Band ${bi + 1} · ridge` : `Band ${bi + 1}`;
    d.innerHTML = `<div class="bandhead"><span class="lbl">${label}</span>${r.bands.length > 1 ? `<button class="btn small danger" aria-label="Remove band ${bi + 1}">Remove band</button>` : ""}</div>`;
    if (r.bands.length > 1) d.querySelector(".bandhead button").onclick = () => { snapshot(); r.bands.splice(bi, 1); afterRoof(); };
    band.mix.forEach((m, mi) => {
      const row = document.createElement("div");
      row.className = "pw";
      const opts = MATERIALS.map((x) => `<option value="${x.id}"${x.id === m.material ? " selected" : ""}>${escapeHtml(x.name)}</option>`).join("");
      row.innerHTML = `<select aria-label="Band ${bi + 1} material ${mi + 1}">${opts}</select><input type="number" min="0" max="99" value="${m.weight}" aria-label="Weight"><button class="btn small danger" aria-label="Remove material"${band.mix.length > 1 ? "" : " disabled"}>✕</button>`;
      row.querySelector("select").onchange = (ev) => { snapshot(); m.material = ev.target.value; afterRoof(); };
      row.querySelector("input").onchange = (ev) => { snapshot(); m.weight = clamp(+ev.target.value || 0, 0, 99); afterRoof(); };
      row.querySelector("button").onclick = () => { snapshot(); band.mix.splice(mi, 1); afterRoof(); };
      d.appendChild(row);
    });
    const add = document.createElement("button");
    add.className = "btn small";
    add.textContent = "Add material";
    add.style.alignSelf = "flex-start";
    add.onclick = () => { snapshot(); band.mix.push({ material: band.mix[band.mix.length - 1].material, weight: 1 }); afterRoof(); };
    d.appendChild(add);
    box.appendChild(d);
  });
}

function afterRoof(refit = false) {
  save(); renderBuildPanel(); render3D();
  if (refit) fitView();
}
/** Select, tick box or text field: one undo step per change. */
const roofSet = (id, fn, refit = false) => {
  $(id).onchange = (e) => { const r = curRoof(); if (!r) return; snapshot(); fn(r, e.target); afterRoof(refit); };
};
roofSet("roofName", (r, t) => { r.name = t.value.trim() || "Roof"; });
roofSet("roofType", (r, t) => { r.type = t.value; }, true);
roofSet("roofRidge", (r, t) => { r.ridge = t.value; }, true);
roofSet("roofFlip", (r, t) => { r.flip = t.checked; });
roofSet("roofGable", (r, t) => { r.gableBlock = t.value; });
roofSet("roofParapet", (r, t) => { r.parapet = t.checked; });
roofSet("roofParapetBlock", (r, t) => { r.parapetBlock = t.value; });

/** Sliders: the view follows while dragging; the whole drag is one undo step. */
let roofDragging = false;
const roofSlider = (id, fn, text, refit = false) => {
  $(id).addEventListener("input", (e) => {
    const r = curRoof();
    if (!r) return;
    if (!roofDragging) { snapshot(); roofDragging = true; }
    fn(r, +e.target.value);
    $(id + "Val").textContent = text(r);
    save(); render3D();
  });
  $(id).addEventListener("change", () => { roofDragging = false; renderBuildPanel(); if (refit) fitView(); });
};
roofSlider("roofHeight", (r, v) => { r.height = v; }, (r) => `${r.height} block${r.height === 1 ? "" : "s"}`, true);
roofSlider("roofEdge", (r, v) => { r.edge = v; }, (r) => edgeText(r.edge));
roofSlider("roofDensity", (r, v) => { r.density = v / 100; }, (r) => Math.round(r.density * 100) + "%");
roofSlider("roofBlend", (r, v) => { r.blend = v / 100; }, (r) => Math.round(r.blend * 100) + "%");

$("roofBandAdd").onclick = () => {
  const r = curRoof();
  if (!r) return;
  snapshot();
  r.bands.push({ mix: [{ material: r.bands[r.bands.length - 1].mix[0].material, weight: 1 }] });
  afterRoof();
};
$("roofNew").onclick = () => {
  snapshot();
  P.roofs.push(roofDefaults({ name: `Roof ${P.roofs.length + 1}` }));
  P.assembly.roof = P.roofs.length - 1;
  afterRoof(true);
};
$("roofDup").onclick = () => {
  const r = curRoof();
  if (!r) return;
  snapshot();
  const c = JSON.parse(JSON.stringify(r));
  c.id = uid();
  c.name = r.name + " copy";
  P.roofs.splice(P.assembly.roof + 1, 0, c);
  P.assembly.roof += 1;
  afterRoof();
};
$("roofDel").onclick = () => {
  const r = curRoof();
  if (!r) return;
  snapshot();
  P.roofs.splice(P.assembly.roof, 1);
  P.assembly.roof = clamp(P.assembly.roof, 0, Math.max(0, P.roofs.length - 1));
  afterRoof(true);
  toast(`Deleted “${r.name}”. Ctrl+Z brings it back.`);
};

/* ---------- bulk export ---------- */
const FORMAT_NAMES = { bp: ".bp", schem: ".schem", both: ".bp + .schem" };
let bulkRun = null; // { cancelled } while a bulk export is running

/** Lets the page repaint and handle clicks. (setTimeout would be slowed to 1 s in a background tab.) */
const yieldToPage = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });

function renderBulk() {
  const B = P.bulk;
  const { n, total } = bulkCount(P);
  $("bulkFmt").value = B.format;
  $("bulkN").value = n;
  $("bulkN").max = total;
  $("bulkOf").textContent = n === total ? `(all ${total.toLocaleString()})` : `of ${total.toLocaleString()}`;
  $("bulkSeed").value = B.seed;
  $("bulkLimit").value = B.limit;
  // Random sample only means something when taking fewer than all.
  const some = n < total;
  $("bulkRand").checked = some && B.random;
  $("bulkRand").disabled = !some;
  $("bulkRandLbl").style.opacity = some ? "" : "0.5";
  if (!bulkRun) {
    const files = n * (B.format === "both" ? 2 : 1);
    $("bulkInfo").textContent = !n
      ? "Nothing to export: add a variant to every stage."
      : `${n.toLocaleString()} building${n === 1 ? "" : "s"}, ${files.toLocaleString()} ${FORMAT_NAMES[B.format]} file${files === 1 ? "" : "s"}` +
        (n === total ? "" : B.random ? ", picked at random" : ", the first in order") +
        (n > B.limit ? `. That’s more than ${B.limit.toLocaleString()}, so you’ll be asked first.` : ".");
    $("bulkGo").disabled = !n || checks(P).some((c) => c[0] === "err");
  }
}
const bulkSet = (fn) => (e) => { fn(e.target); save(); renderBulk(); };
$("bulkFmt").onchange = bulkSet((t) => { P.bulk.format = t.value; });
$("bulkN").onchange = bulkSet((t) => {
  const v = parseInt(t.value, 10);
  // Empty, or at least the total, means all combinations.
  P.bulk.amount = !(v > 0) || v >= comboCount(P).n ? null : v;
});
$("bulkRand").onchange = bulkSet((t) => { P.bulk.random = t.checked; });
$("bulkSeed").onchange = bulkSet((t) => { P.bulk.seed = Math.max(0, parseInt(t.value, 10) || 0); });
$("bulkLimit").onchange = bulkSet((t) => { P.bulk.limit = Math.max(1, parseInt(t.value, 10) || bulkDefaults().limit); });

$("bulkGo").onclick = async () => {
  const B = P.bulk;
  const combos = chooseCombos(P);
  if (!combos.length) return;
  if (combos.length > B.limit &&
      !confirm(`This will generate ${combos.length.toLocaleString()} buildings, more than your limit of ${B.limit.toLocaleString()}. It may take a while. Continue?`)) return;

  const run = (bulkRun = { cancelled: false });
  const P0 = JSON.parse(JSON.stringify(P)); // edits made while it runs don't mix into this export
  const fmts = B.format === "both" ? ["bp", "schem"] : [B.format];
  const zip = new ZipWriter();
  const rows = [];
  $("bulkGo").disabled = true;
  $("bulkStop").hidden = false;
  $("bulkProg").hidden = false;
  $("bulkProg").max = combos.length;
  try {
    for (let i = 0; i < combos.length; i++) {
      if (run.cancelled) { toast("Bulk export cancelled"); return; }
      $("bulkProg").value = i;
      $("bulkInfo").textContent = `Building ${i + 1} of ${combos.length.toLocaleString()}…`;
      const q = forCombo(P0, combos[i]);
      const name = schemName(q);
      for (const f of fmts) {
        // With both formats, each gets its own folder; otherwise the files sit at the top.
        const path = (fmts.length > 1 ? f + "/" : "") + name + "." + f;
        let blocks;
        if (f === "bp") {
          const r = await blueprintFile(q);
          zip.add(path, r.bytes);
          blocks = r.blocks;
        } else {
          const r = toSchem(q);
          zip.add(path, await gzip(r.bytes));
          blocks = r.blocks;
        }
        rows.push({ file: path, p: q, blocks });
      }
      await yieldToPage();
    }
    zip.add("index.csv", indexCsv(rows));
    const file = `instrumentum-urbis_${combos.length}-buildings.zip`;
    download(file, new Blob(zip.finish(), { type: "application/zip" }));
    toast(`Downloaded ${file} (${(zip.size / 1048576).toFixed(1)} MB)`);
  } catch (e) {
    toast("Bulk export stopped: " + e.message);
  } finally {
    bulkRun = null;
    $("bulkStop").hidden = true;
    $("bulkProg").hidden = true;
    renderBulk();
  }
};
$("bulkStop").onclick = () => { if (bulkRun) bulkRun.cancelled = true; };

function loadText(t) {
  let p;
  try { p = JSON.parse(t); } catch (e) { return toast("That isn’t valid JSON. Check that the whole text was pasted."); }
  if (!validProject(p)) return toast("That JSON isn’t an Instrumentum Urbis facade project.");
  snapshot();
  P = p;
  upgradeProject(P);
  afterStructural();
  fitView();
  toast("Project loaded");
}
$("loadJson").onclick = () => loadText($("projText").value);
$("fileJson").onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => loadText(String(r.result));
  r.readAsText(f);
  e.target.value = "";
};
let resetArm = 0;
$("resetSample").onclick = () => {
  const bt = $("resetSample");
  if (!resetArm) {
    bt.textContent = "Confirm: replace with sample";
    resetArm = setTimeout(() => { bt.textContent = "Reset to sample facade"; resetArm = 0; }, 3000);
    return;
  }
  clearTimeout(resetArm);
  resetArm = 0;
  bt.textContent = "Reset to sample facade";
  snapshot();
  P = sampleProject();
  afterStructural();
  fitView();
  toast("Sample facade restored. Ctrl+Z undoes this.");
};

/* ---------- keyboard shortcuts ---------- */
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input,select,textarea")) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
  if (mod || ui.mode !== "edit") return;
  const k = e.key.toLowerCase();
  if (k === "p") setTool("place");
  else if (k === "e") setTool("erase");
  else if (k === "i") setTool("pick");
  else if (k === "m") { ui.mirror = !ui.mirror; $("optMirror").checked = ui.mirror; toast("Mirror " + (ui.mirror ? "on" : "off")); }
  else if (k === "r") {
    const o = ["north", "east", "south", "west"];
    ui.facing = o[(o.indexOf(ui.facing) + 1) % 4];
    renderCurrent();
    toast("Stairs face " + ui.facing);
  }
});

/* ---------- theme changes ---------- */
const reTheme = () => { render3D(); renderGrid(); };
try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", reTheme); } catch (e) { /* old browser */ }
if (document.fonts) document.fonts.ready.then(reTheme);

/* ---------- boot ---------- */
export function start() {
  resize(); syncInputs(); renderLayers(); renderPalette(); renderCurrent(); setTool("place");
  renderVariants(); renderChecks(); renderBuildPanel(); render3D(); renderGrid(); fitView();
}
