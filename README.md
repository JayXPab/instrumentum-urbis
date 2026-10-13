# Instrumentum Urbis

*Minecraft cities at scale.*

A facade editor that generates many unique Minecraft buildings from a few
hand-built pieces. You design Base, Body and Capital variants around a
Core Wall, and the tool stacks them into buildings of any height, with side and
back walls for buildings that stand wall to wall.

Status: early prototype. See `CLAUDE.md` for the design decisions and roadmap,
and `docs/concept.pdf` for the original concept.

## Run it

You need [Node.js](https://nodejs.org) 22 or newer.

```
npm install
npm run dev
```

Then open http://localhost:5173 in your browser.

The finished browser version is kept at the git tag `web-v1.0`.

## Desktop app (Windows)

The editor also runs as a desktop app built with [Tauri](https://tauri.app).
One-time setup on Windows 10 or 11:

1. Install [Node.js](https://nodejs.org) 22 or newer (if not already).
2. Install the **Microsoft C++ Build Tools**: download "Build Tools for Visual
   Studio" from https://visualstudio.microsoft.com/visual-cpp-build-tools/, run
   it, tick **Desktop development with C++**, and install.
3. Install **Rust**: download and run `rustup-init.exe` from
   https://rustup.rs, and accept the defaults.
4. WebView2 is already part of Windows 10 (recent updates) and Windows 11. If
   the app window stays blank, install the "Evergreen Bootstrapper" from
   https://developer.microsoft.com/microsoft-edge/webview2/.
5. Close and reopen your terminal so it finds the new tools.
6. Keep the project folder **outside OneDrive** (for example `C:\dev\instrumentum-urbis`).
   The desktop build writes thousands of files into `src-tauri\target\` (over
   1 GB), and OneDrive would try to upload them all and lock them while it does.

Then, in the project folder:

```
npm install
npm run desktop
```

The first run compiles for several minutes (it builds two pieces at a time so
it doesn't run out of memory); after that it opens quickly. Changes
to the editor's code show up in the window straight away.

If a build stops with "memory allocation failed" or "invalid metadata files",
delete the folder `src-tauri\target` (a crashed build leaves broken files
there), close other programs, and run `npm run desktop` again.

To build an installer: `npm run desktop:build`. The installers land in
`src-tauri\target\release\bundle\` (`msi\` and `nsis\`).

## Using the editor

- **Stage editor**: pick Base, Body or Capital, then a variant. Click in the 3D
  view to place blocks, right-click or Shift-click to erase, drag to orbit.
  The elevation grid on the right edits one depth layer at a time.
- **Assembled building**: choose variants and a floor count, or press
  **Random building**. Repeated body floors are faded so the original stands out.
- Shortcuts: P place, E erase, I pick, M mirror, R rotate stairs,
  Ctrl+Z undo, Ctrl+Shift+Z redo.

## Tests

```
npm test
```
