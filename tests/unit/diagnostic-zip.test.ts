import assert from "node:assert/strict";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import { createZipArchive } from "../../apps/desktop/src/main/diagnostics/zip-archive.ts";

function readLocalEntries(archive: Buffer): Map<string, string> {
  const entries = new Map<string, string>();
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const contentStart = nameStart + nameLength + extraLength;
    const name = archive.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const content = inflateRawSync(archive.subarray(contentStart, contentStart + compressedSize)).toString("utf8");
    entries.set(name, content);
    offset = contentStart + compressedSize;
  }
  return entries;
}

test("creates a standard ZIP containing every requested diagnostic document", () => {
  const archive = createZipArchive([
    { name: "summary.json", content: "{\"safe\":true}" },
    { name: "logs.ndjson", content: "{\"level\":\"error\"}\n" },
    { name: "README.txt", content: "Janus Studio diagnostics" },
  ], new Date("2026-08-13T14:00:00.000Z"));

  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.equal(archive.includes(Buffer.from("PK\x05\x06", "binary")), true);
  assert.deepEqual([...readLocalEntries(archive)], [
    ["summary.json", "{\"safe\":true}"],
    ["logs.ndjson", "{\"level\":\"error\"}\n"],
    ["README.txt", "Janus Studio diagnostics"],
  ]);
});

test("rejects empty, duplicate and unsafe ZIP entries", () => {
  assert.throws(() => createZipArchive([]), /at least one entry/);
  assert.throws(() => createZipArchive([
    { name: "summary.json", content: "a" },
    { name: "summary.json", content: "b" },
  ]), /Duplicate ZIP entry/);
  assert.throws(() => createZipArchive([{ name: "../secret", content: "x" }]), /Unsafe ZIP entry/);
});
