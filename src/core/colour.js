// Colour variants: white wool, terracotta, concrete, concrete powder and carpet
// in a facade are colour slots. Each building takes one colour for all of them;
// optionally the base stage takes its own, separate colour (awnings and the like).
// Pure functions, no DOM, no three.js.

import { COLOURS, isColourSlot } from "./blocks.js";
import { STAGES } from "./facade.js";

/** Colour settings saved with the project. */
export const coloursDefaults = () => ({ on: false, list: [...COLOURS], baseOn: false, baseList: [...COLOURS] });

/** Which stages contain colour slots: the base, and the rest (body and capital). */
export function slotsIn(p) {
  const has = (kind) => p.stages[kind].some((v) => Object.values(v.blocks).some(isColourSlot));
  return { base: has("base"), rest: STAGES.filter((k) => k !== "base").some(has) };
}

/** Ticked colours in Minecraft's order, or white alone if none are ticked. */
const ticked = (list) => {
  const out = COLOURS.filter((c) => (list || []).includes(c));
  return out.length ? out : ["white"];
};

/**
 * The colours a project's buildings come in. `main` colours the body and
 * capital (and the base, unless it has its own); `base` colours the base.
 * A list of [null] means that colour isn't used: switched off, or there are
 * no white slot blocks for it to colour.
 * @returns {{main: (string|null)[], base: (string|null)[]}}
 */
export function colourLists(p) {
  const c = { ...coloursDefaults(), ...p.colours };
  const slots = slotsIn(p);
  const separate = c.on && c.baseOn && slots.base;
  const mainUsed = c.on && (slots.rest || (slots.base && !separate));
  return { main: mainUsed ? ticked(c.list) : [null], base: separate ? ticked(c.baseList) : [null] };
}

/**
 * The colours of the building in p.assembly, or null where colour isn't used.
 * @returns {{main: string|null, base: string|null}}
 */
export function buildingColours(p) {
  const { main, base } = colourLists(p);
  const pick = (list, want) => (list[0] === null ? null : list.includes(want) ? want : list[0]);
  return { main: pick(main, p.assembly.colour), base: pick(base, p.assembly.baseColour) };
}

/** The colour a stage's slots take in this building, or null to leave them white. */
export function colourFor(p, kind) {
  const { main, base } = buildingColours(p);
  return kind === "base" && base ? base : main;
}
