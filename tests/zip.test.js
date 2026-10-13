// Tests for the zip writer in src/core/zip.js. Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, ZipWriter, concat, readStoredZip } from "../src/core/zip.js";

const enc = new TextEncoder();

test("CRC-32 matches the standard check value", () => {
  assert.equal(crc32(enc.encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test("files go in and come back out unchanged", () => {
  const z = new ZipWriter(new Date(2026, 9, 12, 14, 30, 0));
  const bin = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7) & 255);
  z.add("index.csv", "file,blocks\r\na.bp,10\r\n");
  z.add("bp/facade_b1-b1-c1_3fl.bp", bin);
  z.add("bp/Café façade.bp", enc.encode("é"));
  const files = readStoredZip(concat(z.finish()));
  assert.deepEqual([...files.keys()], ["index.csv", "bp/facade_b1-b1-c1_3fl.bp", "bp/Café façade.bp"]);
  assert.deepEqual(files.get("bp/facade_b1-b1-c1_3fl.bp"), bin);
  assert.equal(new TextDecoder().decode(files.get("index.csv")), "file,blocks\r\na.bp,10\r\n");
});

test("the zip starts with a local header and stamps the date", () => {
  const z = new ZipWriter(new Date(2026, 9, 12, 14, 30, 0));
  z.add("a.txt", "a");
  const bytes = concat(z.finish());
  const dv = new DataView(bytes.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  assert.equal(dv.getUint16(10, true), (14 << 11) | (30 << 5)); // 14:30:00
  assert.equal(dv.getUint16(12, true), ((2026 - 1980) << 9) | (10 << 5) | 12); // 12 Oct 2026
});

test("an empty zip is just the end record", () => {
  assert.equal(concat(new ZipWriter().finish()).length, 22);
});

test("the same name twice is refused", () => {
  const z = new ZipWriter();
  z.add("a.bp", "1");
  assert.throws(() => z.add("a.bp", "2"), /already/);
});
