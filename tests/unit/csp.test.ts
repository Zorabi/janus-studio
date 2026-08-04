import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("allows blob-backed graph images without broadening script permissions", async () => {
  const html = await readFile("apps/desktop/index.html", "utf8");
  const policy = html.match(/Content-Security-Policy"\s+content="([^"]+)"/)?.[1] ?? "";

  assert.match(policy, /img-src[^;]*\bblob:/);
  assert.doesNotMatch(policy, /script-src[^;]*\bblob:/);
});
