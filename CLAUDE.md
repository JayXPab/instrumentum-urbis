# Instrumentum Urbis

A tool for bulk-generating unique Minecraft building facades for city building.
The full concept is in `docs/concept.pdf`. This file records the decisions made
since then and how the code is organised. Claude Code reads it at the start of
every session, so keep it up to date when a design decision changes.

## About the owner

The project owner is new to programming. When working on this project:

- Explain changes in plain language: what changed, why, and how to try it.
- Work in small steps that can be tried in the browser after each one.
- Before a large change, describe the plan and wait for approval.
- Commit after each working step with a clear message, so any step can be undone.
- Run `npm test` before committing. Add tests for any new rule in `src/core`.

## Running it

```
npm install      # first time only, and after dependencies change
npm run dev      # start the editor at http://localhost:5173
npm test         # run the core tests
npm run build    # production build into dist/
```

## Tech stack

- Plain JavaScript (ES modules), built with Vite. Moving to TypeScript is planned
  once the core model settles; JSDoc types are used meanwhile.
- three.js for the 3D view.
- Node's built-in test runner for tests (no test framework dependency).
- Planned: wrap as a desktop app with Tauri; later, a Java mod (Fabric) like Axiom.

## Code layout

```
index.html            page markup
src/main.js           entry point
src/styles.css        styles (colour tokens on :root, dark mode via prefers-color-scheme)
src/core/             the facade rules: NO DOM, NO three.js
  blocks.js           block catalogue, block-state parsing ("id[prop=value]")
  facade.js           coordinates, bounds, mirror rule, variants, validation
  assemble.js         stacking stages into a building, party walls, combination count
  sample.js           the sample facade the editor opens with
  nbt.js              NBT (Minecraft binary format) writer/reader, varints
  schem.js            assembled building -> Sponge v3 .schem; pane connections
  blueprint.js        assembled building -> Axiom .bp (16³ sections, file layout)
  bulk.js             combination generator: all / first N / random sample, seeds
  zip.js              minimal stored (uncompressed) zip writer
  roof.js             roof styles: shapes, materials/gradient, garden planting
src/ui/               everything that touches the screen
  app.js              editor state, 3D view, elevation grid, panels, undo
  meshes.js           block-state -> three.js meshes, guide lines, labels
tests/                tests for src/core (one file per area)
docs/concept.pdf      original concept document
```

Keep `src/core` free of browser and three.js code. It is the part that will be
ported to Java for the mod, and the part the tests cover.

## Coordinate system (relative to the Core Wall)

- **x**: across the facade. Left is −x, right is +x. x = 0 is the centre column.
  - Odd width: x runs −w/2 … +w/2 and the mirror axis passes through x = 0.
  - Even width: x = 0 is the **right-hand block of the middle two**. The range is
    −w/2 … w/2 − 1 and the mirror axis sits at x = −0.5.
- **y**: up. Each stage starts at y = 0.
- **z**: 0 is the Core Wall. +z is ornament in front of the wall, −z is
  recesses (windows, curtains, doors) behind it. +z points away from the
  building toward the street, which is south in Minecraft.

## Design decisions

- **Stages**: Base, Body, Capital. Each stage has any number of variants.
  All variants in a stage share that stage's floor height.
- **Floors**: minimum 3 (one base, one body, one capital). Extra floors repeat
  the body. Within one building, every body floor is the **same variant**;
  variety comes between buildings, not between floors.
- **Combinations** = bases × bodies × capitals × floor counts in range.
- **Depth rule**: a facade is never thicker than its width. Front depth and back
  depth must each be ≤ xMax (half the width). The editor enforces this.
- **Party walls**: for buildings that stand wall to wall, the side walls (outer
  columns) and back wall are filled from a user-chosen block palette with
  weights. They only fill cells the facade leaves empty. A seed makes the result
  repeatable.
- **Corners** (not built yet):
  - Sharp corner: two perpendicular facades whose Core Walls meet, sharing
    exactly one vertical column. Inner faces face inward, outer faces outward.
  - Chamfered corner: an extra wall at 45°.
  - Collisions at a corner: first try to **merge** the features (two stairs
    become a corner stair). If they can't merge, **trim both walls** so they
    form a clean corner.
- **Minecraft version** is chosen first; only Java 1.21.11 for now. Block names
  and states must come from the chosen version.
- **Block states** are stored as strings like
  `minecraft:stone_brick_stairs[facing=north,half=top]`. Stair `facing` is the
  side the tall half is on.

## Export

- **.schem** is Sponge Schematic v3 (gzipped NBT), as WorldEdit 7.3+ reads it.
  Download it from the Assembled building view.
- Our axes match Minecraft: +x east, +y up, +z south. No rotation on export.
- The **paste point** (where the player stands for `//paste`) is the bottom of
  the Core Wall's centre column: x = 0, y = 0, z = 0.
- **.bp** is an Axiom blueprint: magic `0x0AE5BB36`, then length-prefixed header
  NBT, PNG thumbnail and gzipped block NBT. The layout comes from Axiom's
  open-source server plugin (`BlueprintIo.java`, `BlueprintHeader.java`). Blocks are
  16³ sections packed like Minecraft chunks; empty cells are `void_air`, so placing
  a blueprint never erases what is already there (unlike `.schem`, which writes air).
  The thumbnail is a 256 px render of the building made in the browser.
- `.bp` writes every block property (`fullState`), filling defaults the editor
  leaves out. `.schem` writes states as stored.
- Data version per game version is in `DATA_VERSIONS` (1.21.11 = 4671).
- The editor stores bare glass panes; the exporter adds their north/south/east/west
  connections. Other blocks are exported exactly as stored.

## Bulk export

- Combinations are numbered with floors counting fastest, then capital, body,
  base (`comboAt`). "How many" below the total takes the first N in that order,
  or, with **Random sample** ticked, N different ones picked with the bulk seed.
  Random sample is only available when taking fewer than all.
- Each building's party-wall seed is a hash of the bulk seed and its combination,
  so the same settings always give the same buildings.
- One `.zip` per run. One format: files at the top level. Both: `bp/` and
  `schem/` folders. `index.csv` lists file, variant names, floors, seed, blocks.
- Above the "ask before" limit (default 200) the editor asks first.
- `.bp` headers carry a readable title ("Shopfront / Three windows / Cornice,
  5 floors"); file names stay short (`facade_b1-b2-c1_5fl`).

## Roofs

- A roof style is settings, not drawn blocks: type (gable, sloped, mansard,
  convex mansard, flat, garden), ridge (along the street, or gable to the street),
  height (any number of blocks), edge (−3 inset … +2 overhang), bands.
- Sloped types are an outline across the slope, rounded to half blocks: half step
  = bottom slab, full step = stair (tall half uphill), peak/level = block, with
  blocks underneath down to the lower neighbour. Gable ends are filled: party-wall
  blocks on party walls, the gable block at a street-facing front.
- Gradient: bands from eaves to ridge, each a weighted mix of materials (a full
  block with matching stairs and slab, `MATERIALS`); `blend` softens band borders.
  Flat roofs use the first band.
- Garden: walled (parapet block, 2 high), grass blocks, plants by density.
- Roof styles multiply the combinations. With none, buildings have flat tops and
  file names have no `-rN`. The roof has its own random numbers and the party-wall
  seed ignores the roof, so changing roofs never changes the walls.
- Edge applies to the eave sides only; flat and garden roofs ignore it.

## Project file

The editor saves the project in the browser (localStorage key
`instrumentum-urbis.project.v1`) and can copy or load it as JSON. The JSON has
`format: "instrumentum-urbis/facade"` and `formatVersion: 1`. If the shape
changes, bump `formatVersion` and keep loading older files. Optional additions
that fill in defaults on load (like `bulk`, added after v1) don't need a bump.

## Roadmap

1. ✅ Data model
2. ✅ 3D viewer
3. ✅ Stage editor (3D clicking + elevation grid, mirror, undo)
4. ✅ Assembly (stacked floors, repeated floors marked, party walls)
5. 🔶 Export: WorldEdit `.schem` ✅ (checked in game on 1.21.11). Axiom `.bp` ✅
   (checked in game on 1.21.11). Next: Litematica `.litematic`.
6. ✅ Combination generator with bulk export (checked in game with Axiom)
7. ⬜ Corners: sharp, then chamfered, with the merge/trim rule
8. 🔶 Roofs: gable, sloped, mansard, convex mansard, flat, garden; materials and
   gradient bands: built (awaiting in-game check). Later: dormers, hipped roofs.
9. ⬜ Schematic import (user defines the Core Wall; validate and recentre x = 0)
10. ⬜ Desktop app (Tauri); later the in-game mod

## Known limits

- Blocks are drawn as flat colours, not textures. Stair, pane and plant shapes are simplified.
- Testing: the `editor-scratch` launch config runs a second dev server on port 5174.
  It has its own browser storage, so tests there never touch the owner's project.
- Stair shapes (inner/outer corners) are not worked out on export; stairs export
  as straight unless the stored state says otherwise.
