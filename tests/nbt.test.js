// Tests for the NBT writer in src/core/nbt.js. Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { nbt, TAG, writeNbt, readNbt, varints, readVarints } from "../src/core/nbt.js";

const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

test("NBT matches the reference 'hello world' file byte for byte", () => {
  // The standard example from the NBT specification.
  const bytes = writeNbt(nbt.compound({ name: nbt.string("Bananrama") }), "hello world");
  assert.deepEqual([...bytes], [
    10, 0, 11, ...ascii("hello world"),
    8, 0, 4, ...ascii("name"), 0, 9, ...ascii("Bananrama"),
    0,
  ]);
});

test("numbers are written big-endian at the right width", () => {
  const bytes = writeNbt(nbt.compound({ s: nbt.short(258), i: nbt.int(-2), a: nbt.intArray([1]) }));
  assert.deepEqual([...bytes], [
    10, 0, 0,
    2, 0, 1, ...ascii("s"), 0x01, 0x02,
    3, 0, 1, ...ascii("i"), 0xff, 0xff, 0xff, 0xfe,
    11, 0, 1, ...ascii("a"), 0, 0, 0, 1, 0, 0, 0, 1,
    0,
  ]);
});

test("every tag type survives a write and read round trip", () => {
  const root = nbt.compound({
    b: nbt.byte(-5), s: nbt.short(-300), i: nbt.int(123456), l: nbt.long(2n ** 40n),
    f: nbt.float(1.5), d: nbt.double(-0.25), str: nbt.string("minecraft:stone_bricks"),
    ba: nbt.byteArray([1, 2, 255]), ia: nbt.intArray([-1, 0, 7]), la: nbt.longArray([1, -1]),
    list: nbt.list(TAG.Int, [nbt.int(1), nbt.int(2)]), empty: nbt.list(TAG.Compound, []),
    nested: nbt.compound({ x: nbt.int(9) }),
  });
  const { name, root: back } = readNbt(writeNbt(root, "r"));
  assert.equal(name, "r");
  assert.deepEqual(back, root);
});

test("a list refuses items of mixed types", () => {
  assert.throws(() => writeNbt(nbt.compound({ l: nbt.list(TAG.Int, [nbt.int(1), nbt.short(2)]) })));
});

test("varints use one byte below 128 and more above", () => {
  assert.deepEqual([...varints([0, 1, 127])], [0, 1, 127]);
  assert.deepEqual([...varints([128])], [0x80, 0x01]);
  assert.deepEqual([...varints([300])], [0xac, 0x02]);
  assert.deepEqual(readVarints(varints([0, 127, 128, 300, 70000])), [0, 127, 128, 300, 70000]);
});
