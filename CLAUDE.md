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
npm run desktop        # open the desktop app (Tauri) with live reload
npm run desktop:build  # build the Windows installer into src-tauri/target/release/bundle/
```

The desktop commands need Rust and, on Windows, the Microsoft C++ Build Tools
(see `README.md`). The first desktop run compiles for a few minutes; later runs
are quick.

## Web app and desktop app

The web app prototype is finished and frozen at the git tag **`web-v1.0`**
(roadmap steps 1–9). To get it back: `git checkout web-v1.0`, then
`npm install` and `npm run dev`. From that tag on, the main code is the desktop
app: same editor, run inside a Tauri window, and it may gain features the
browser cannot do (reading the Minecraft installation, saving into folders).
`npm run dev` still opens it in a browser for quick testing, but browser-only
use is no longer a goal.

The owner uses Windows 10 (laptop) and Windows 11 (desktop), so the desktop app
targets Windows first. Claude's cloud sessions run Linux: they can compile the
app and take screenshots of it, but every desktop step must be tried on Windows.

Windows lessons so far: Vite must not watch `src-tauri/` (the compiler locks its
files: EBUSY crash); the first Rust build ran the laptop out of memory, so
`src-tauri/.cargo/config.toml` limits it to 2 jobs and libraries build without
debug info; the project must live outside OneDrive. The owner downloads branch
ZIPs (no Git yet), so make sure fixes are on the branch they download.

## Tech stack

- Plain JavaScript (ES modules), built with Vite. Moving to TypeScript is planned
  once the core model settles; JSDoc types are used meanwhile.
- three.js for the 3D view.
- Node's built-in test runner for tests (no test framework dependency).
- Tauri 2 for the desktop app: a small Rust program (`src-tauri/`) that opens the
  editor in a window (WebView2 on Windows). Later, a Java mod (Fabric) like Axiom.

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
  project.js          loading: upgrades older project formats, fills defaults
  nbt.js              NBT (Minecraft binary format) writer/reader, varints
  schem.js            assembled building -> Sponge v3 .schem; pane connections
  blueprint.js        assembled building -> Axiom .bp (16³ sections, file layout)
  litematic.js        assembled building -> Litematica .litematic (version 7)
  bulk.js             combination generator: all / first N / random sample, seeds
  zip.js              minimal stored (uncompressed) zip writer
  roof.js             roof styles: shapes, materials/gradient, garden planting
  corner.js           corner buildings: turned side facade, merge/trim, chamfer
  colour.js           colour variants: white slot blocks, main and base colours
  import.js           reading .schem/.litematic/.bp; turning blocks into variants
  models.js           Minecraft's blockstates/models: pick a model, follow parents,
                      find textures (editor drawing only; the mod won't need it)
src/ui/               everything that touches the screen
  app.js              editor state, 3D view, elevation grid, panels, undo
  meshes.js           block-state -> three.js meshes, guide lines, labels
  desktop.js          desktop-only calls (folder picker, find/save files, game files); folder settings
  textures.js         block textures from the copied game files: swatches, picture URLs, caches
src-tauri/             desktop app shell (Rust): window, settings, later file access
  tauri.conf.json     app name, window size, which commands build the editor
  src/lib.rs          the Rust program; registers plugins and commands
  src/folders.rs      finding mod folders in launchers; saving files into folders
  src/assets.rs       finding the game jar; copying block textures/models out; reading them
  .cargo/config.toml  2 build jobs (the laptop ran out of memory)
  capabilities/       what the editor page is allowed to ask Rust to do
vite.config.js        dev server on port 5173 (the desktop app expects it)
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

## Editor steps

The top bar has three steps:

1. **Stage editor**: draw the base, body and capital variants block by block.
2. **Final Assembly**: choose a building (variants, roof, floors, depth) and set
   roofs, floor range, depth range, party walls and display options.
3. **Export**: single-building downloads and bulk export. Future export
   features go here.

Final Assembly and Export show the same building in 3D, with settings on both
sides of the view (left: what to build; right: roofs, party walls, display, or
bulk export). The Combinations section (with Random building) is one element that
moves to the top of whichever left panel is open. A marker shows the paste point
(the block at 0,0,0). "Fade repeated body floors" starts off.

## Design decisions

- **Stages**: Base, Body, Capital. Each stage has any number of variants.
  All variants in a stage share that stage's floor height.
- **Floors**: minimum 3 (one base, one body, one capital). Extra floors repeat
  the body. Within one building, every body floor is the **same variant**;
  variety comes between buildings, not between floors.
- **Combinations** = bases × bodies × capitals × roofs × floor counts × depths ×
  building types (mid-row, corner, chamfered corner) × colours × base colours.
  Ranges are inclusive.
- **Colour variants**: white wool, terracotta, concrete, concrete powder and
  carpet anywhere in a facade are colour slots. With colour variants on, each
  building turns every slot into one colour (`assembly.colour`). Optionally the
  base stage has its own colour (`assembly.baseColour`), e.g. for awnings.
  Colours only multiply the combinations where there are white slots for them
  to colour. Roofs and party walls are never recoloured. File names end
  `_red` and `_base-white`. Off by default.
- **Depth range**: how far back the building goes, Core Wall to back wall. Never
  less than the facade's back depth + 2. The `_Nd` file-name part and ", N deep"
  in titles appear only when the range has more than one value.
- **Depth rule**: a facade is never thicker than its width. Front depth and back
  depth must each be ≤ xMax (half the width). The editor enforces this.
- **Party walls**: for buildings that stand wall to wall, the side walls (outer
  columns) and back wall are filled from a user-chosen block palette with
  weights. They only fill cells the facade leaves empty. A seed makes the result
  repeatable.
- **Corners**:
  - Building types are ticked in Final Assembly: mid-row and corner; corners
    sharp and/or chamfered (chamfer 1–3). `assembly.type` is `mid`, `c` or
    `c-ch`; file names end `_c` or `_c-ch`. Older `cl`/`cr` types and
    left/right ticks load as one corner type.
  - One hand only: the side street is on the right (+x). Users mirror a corner
    in WorldEdit or Axiom for the other hand.
  - The corner plot is as deep as the mid-row buildings (the chosen depth), and
    never narrower than the facade: plot = max(depth, width), square, reaching
    inward (−x) and back (−z) from the corner column. The facade sits at the
    corner on each street; extra length repeats the facade's end column (the
    front repeats its inner column, the side its corner column, turned).
  - The side facade is the front turned a quarter turn; the Core Walls share
    exactly one column. Recesses point inward, ornament outward. No party wall
    on the side street; party walls at the plot's inner side and back.
  - Collisions: **merge** (same block stays; two stairs combine into a corner
    stair), otherwise **trim** (Core Wall block on a Core Wall plane, air
    elsewhere). Ornament on both corner columns continues round the corner,
    mitred.
  - Chamfer: cuts c blocks off the corner and closes it with a stepped diagonal
    wall in the corner column's blocks. A band 1 block out follows the steps;
    deeper ornament is trimmed.
  - Roofs on corners are L-shaped and join the mid-row roofs seamlessly: each
    wing uses the mid-row outline for the same depth, height and edge; hip at
    the outer corner, valley inside. A plot wider than the depth gets a flat
    patch in its inner back corner. Chamfers clip roofs.
- **Minecraft version** is chosen first; only Java 1.21.11 for now. Block names
  and states must come from the chosen version.
- **Block states** are stored as strings like
  `minecraft:stone_brick_stairs[facing=north,half=top]`. Stair `facing` is the
  side the tall half is on.

## Export

- **.schem** is Sponge Schematic v3 (gzipped NBT), as WorldEdit 7.3+ reads it.
  Download it from the Export step.
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
- **.litematic** is Litematica's format version 7 (gzipped NBT): metadata (with
  an optional 140 px preview, one ARGB int per pixel) and one region whose
  Position is its lowest corner relative to the paste point. Blocks run x, then
  z, then y; air is palette entry 0; max(2, ceil(log2 palette)) bits per entry,
  packed tightly so an entry may run on into the next long (unlike chunks and
  .bp). Field names checked against Litematica's source (LTS/1.21.11 branch of
  sakura-ryoko/litematica) and Litemapy.
- Bulk export formats are tick boxes (`bulk.formats`); with more than one, each
  format gets its own folder in the zip. Older `bulk.format` loads as a list.
- Data version per game version is in `DATA_VERSIONS` (1.21.11 = 4671).
- **Save to folders** (desktop app only, Export step): one folder per format.
  With a folder set, the export buttons say "Save" and write straight there;
  without, they download as in the browser. Folders belong to the computer, not
  the project: they live in localStorage `instrumentum-urbis.folders.v1`, never
  in the project JSON. **Find game folders** lists every game folder (the
  official `.minecraft`, and each Modrinth, CurseForge, Prism, PolyMC,
  ATLauncher, GDLauncher and FTB profile at their default places) with the mod
  folders it has (`config/axiom/blueprints`, `config/worldedit/schematics`,
  `schematics`); folders with mods first. **Use** points every format at that
  one profile, and a format whose mod isn't there is cleared (downloads).
  Anything else is picked per format with Choose…. Rust saves only plain file names
  (no `/`, `\`, `..`) inside the chosen folder.
- Bulk export in the desktop app can save **files in each format's folder**
  (optionally in a subfolder, default `instrumentum-urbis`) instead of one .zip;
  `index.csv` goes with the first format's files.
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

## Import

- **Import schematic…** in the Stage editor's Stages section opens an import
  view (mode `import`): left panel settings, 3D in the middle, "What will
  happen" and Import/Cancel on the right.
- Reads WorldEdit `.schem` (Sponge v2 and v3), Litematica `.litematic` (all
  regions, negative sizes) and Axiom `.bp`. Air, void air and structure voids
  are dropped; unknown blocks are kept as they are.
- Settings (in the turned import's coordinates): turns (street side to +z),
  Core Wall layer (slider, or click a block), left/right edges, bottom/top rows,
  and either a whole facade (base rows from the bottom, body the floor above,
  capital rows from the top) or one stage. First guesses: Core Wall = fullest z
  layer, edges and rows = everything.
- The marked middle becomes x = 0. Width: padded with the Core Wall block or
  trimmed evenly. Depth: front/back grow to fit, up to the depth rule; deeper
  blocks are cut. Height: an empty stage takes the import's height; otherwise
  the user picks "keep stage height" (trim/pad the import) or "change stage
  height" (trim/pad its other variants). Padding rows are Core Wall blocks.
- Not supported: MCEdit `.schematic` (pre-1.13) and Structure Block `.nbt`.

## Minecraft textures (desktop app)

- Read from the user's own **game jar** (`<version>.jar`, a zip every launcher
  keeps); never shipped. Project → Minecraft textures: **Find Minecraft** looks
  for the jar of the chosen version in the official `.minecraft\versions`,
  Modrinth `meta\versions`, CurseForge `Install\versions`, Prism/PolyMC
  `libraries\com\mojang\minecraft`, ATLauncher and FTB; **Choose game jar…**
  for anything else.
- **Use** copies `assets/minecraft/` `textures/block`, `models/block`,
  `blockstates` and `textures/colormap` into the app's local data folder
  (`<AppData>\Local\io.github.jayxpab.instrumentumurbis\minecraft\<version>\`,
  with `source.json` saying which jar). The jar is only read. After that the
  app reads those copies (`read_asset`), so the jar may move or update freely.
- A block's texture: blockstate → variant (stored properties must match;
  missing ones match anything; the first of a random list) → model → parents
  (child textures win, nearest elements win) → `#refs`. The palette swatch
  draws the block's front: each element's north face in order (`frontLayers`),
  so a grass block is its side plus the fringe; without elements it takes
  `all`, `side`, `texture`, `cross`, `pane`, … in that order.
- **Tints**: faces marked `tintindex` are coloured like the game does (grey
  texture × colour, see-through kept). Grass and leaves use the **forest
  biome** colours (`FOREST`: grass `#79c05a`, foliage `#59ae30`); birch
  `#80a755`, spruce `#619961` and lily pad `#208030` are fixed. Which blocks
  are tinted is a table (`TINTS` in models.js): the game decides this in code,
  not in the jar's files.
- Without copied files, or in the browser, blocks stay flat colours.
- Not yet: the 3D view still uses flat colours (roadmap 10.4).

## Project file

The editor saves the project in the browser (localStorage key
`instrumentum-urbis.project.v1`) and can copy or load it as JSON. The JSON has
`format: "instrumentum-urbis/facade"` and `formatVersion: 2`. If the shape
changes, bump `formatVersion` and keep loading older files: `upgradeProject` in
`src/core/project.js` brings any older file up to date (its header lists the
versions). Optional additions that fill in defaults on load (like `bulk`) don't
need a bump.

- v1: one `buildingDepth`. v2: `depthMin`/`depthMax` and `assembly.depth`.

## Roadmap

1. ✅ Data model
2. ✅ 3D viewer
3. ✅ Stage editor (3D clicking + elevation grid, mirror, undo)
4. ✅ Assembly (stacked floors, repeated floors marked, party walls)
5. ✅ Export: WorldEdit `.schem`, Axiom `.bp` and Litematica `.litematic`, all
   checked in game on 1.21.11.
6. ✅ Combination generator with bulk export (checked in game with Axiom)
7. ✅ Corners: sharp and chamfered, merge/trim, plot as deep as the mid-row
   buildings, L-shaped roofs that join the mid-row roofs (checked in game).
   Later: repeating facade bays instead of a continued wall.
8. ✅ Roofs: gable, sloped, mansard, convex mansard, flat, garden; materials and
   gradient bands (checked in game). Later: dormers, hipped mid-row roofs.
9. ✅ Schematic import: .schem/.litematic/.bp, Core Wall and edges, whole facade
   or one stage, recentred to x = 0 (checked in game).
10. 🔶 Desktop app (Tauri). Web app frozen at tag `web-v1.0`. Steps:
    1. ✅ Tauri shell: the editor opens in its own window (`npm run desktop`),
       checked on the owner's Windows 10 laptop.
    2. ✅ Save to folders: a folder per format, Find game folders picks a
       whole profile across launchers, bulk export as loose files (checked on
       Windows with Modrinth).
    3. 🔶 Game files: find the game jar across launchers, copy block
       textures/models/blockstates out once, palette and current-block
       swatches show real textures; grass and leaves in forest colours. Built and tested in the Linux app with a
       pretend jar (awaiting a Windows check with the real 1.21.11 jar).
    4. ⬜ Draw blocks with textures, then with their real models.
    5. ⬜ Windows installer and app icon.
11. ⬜ In-game mod (Fabric).

## Known limits

- Blocks are drawn as flat colours, not textures. Stair, pane and plant shapes are simplified.
- Blocks outside the catalogue (doors, shelves, lanterns… e.g. from imports) are
  kept and exported exactly, but the 3D view shows them as magenta placeholder
  cubes. To be fixed with real models in the desktop app (see roadmap 10).
- Cloud sessions can't download Mojang's files (blocked), so texture tests use
  a pretend jar with the same layout.
- Testing the desktop app in a cloud session: `npx tauri build --debug --no-bundle`,
  then drive it with `tauri-driver` (cargo install) and `WebKitWebDriver`
  (apt `webkit2gtk-driver`) under `xvfb-run`; WebDriver on port 4444.
- `npm run desktop` (dev) and the installed app have separate storage (different
  page origins), so a project saved in one isn't in the other. Copy it across
  with Project → JSON until this is handled (roadmap 10.5).
- Testing: the `editor-scratch` launch config runs a second dev server on port 5174.
  It has its own browser storage, so tests there never touch the owner's project.
- Stair shapes (inner/outer corners) are not worked out on export; stairs export
  as straight unless the stored state says otherwise.
