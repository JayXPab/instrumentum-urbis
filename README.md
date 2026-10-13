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
