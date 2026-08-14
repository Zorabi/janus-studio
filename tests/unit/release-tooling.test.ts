import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { verifyReleaseIdentity } from "../../scripts/release-verify.mjs";

test("keeps release identity aligned across package metadata and readmes", async () => {
  const identity = await verifyReleaseIdentity({ allowDirty: true, tag: "v0.2.0" });
  assert.equal(identity.version, "0.2.0");
  assert.equal(identity.nodeVersion, "22.17.0");
  assert.equal(identity.packageManager, "pnpm@8.11.0");
});

test("keeps release workflows behind repository-owned verification and metadata commands", async () => {
  const rootPackage = JSON.parse(await readFile("package.json", "utf8"));
  const buildWorkflow = await readFile(".github/workflows/build.yml", "utf8");
  const releaseWorkflow = await readFile(".github/workflows/release.yml", "utf8");
  assert.equal(rootPackage.scripts["release:verify"], "node scripts/release-verify.mjs");
  assert.equal(rootPackage.scripts["release:metadata"], "node scripts/release-metadata.mjs");
  assert.equal(rootPackage.scripts["release:preflight"], "node scripts/release-preflight.mjs");
  assert.match(buildWorkflow, /pnpm release:preflight/);
  assert.match(releaseWorkflow, /pnpm release:preflight/);
  assert.match(releaseWorkflow, /pnpm release:metadata/);
  assert.match(releaseWorkflow, /JANUS_STUDIO_REQUIRE_OFFICIAL_RELEASE: "1"/);
  assert.doesNotMatch(releaseWorkflow, /node -e .*Tag must equal/);
});
