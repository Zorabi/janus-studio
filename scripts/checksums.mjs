import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("apps/desktop/out/make");
const output = path.join(root, `SHA256SUMS-${process.platform}-${process.arch}.txt`);

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const location = path.join(directory, entry.name);
    const details = await lstat(location);
    if (details.isSymbolicLink()) continue;
    if (details.isDirectory()) result.push(...await files(location));
    else if (
      details.isFile() &&
      entry.name !== ".DS_Store" &&
      !entry.name.startsWith("SHA256SUMS-") &&
      details.size > 0
    ) result.push(location);
  }
  return result;
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

const entries = [];
for (const file of (await files(root)).sort()) {
  entries.push(`${await sha256(file)}  ${path.relative(root, file).replaceAll(path.sep, "/")}`);
}
await writeFile(output, `${entries.join("\n")}\n`, "utf8");
console.log(`Wrote ${entries.length} checksums to ${output}`);
