import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  classifyLinuxVerification,
  classifyMacVerification,
  classifyWindowsVerification,
  summarizeArtifactVerification,
} from "../../scripts/release-artifact-verification.mjs";
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
  const releaseMetadata = await readFile("scripts/release-metadata.mjs", "utf8");
  assert.equal(rootPackage.scripts["release:verify"], "node scripts/release-verify.mjs");
  assert.equal(rootPackage.scripts["release:metadata"], "node scripts/release-metadata.mjs");
  assert.equal(rootPackage.scripts["release:preflight"], "node scripts/release-preflight.mjs");
  assert.equal(rootPackage.scripts["release:inspect"], "node scripts/release-artifact-verification.mjs");
  assert.equal(rootPackage.scripts["release:sign-linux"], "node scripts/release-sign-linux.mjs");
  assert.equal(rootPackage.scripts["release:upgrade-smoke"], "node scripts/release-upgrade-smoke.mjs");
  assert.match(buildWorkflow, /pnpm release:preflight/);
  assert.match(releaseWorkflow, /pnpm release:preflight/);
  assert.match(releaseWorkflow, /pnpm release:metadata/);
  assert.match(releaseWorkflow, /macos-15-intel/);
  assert.match(releaseWorkflow, /pnpm release:inspect/);
  assert.match(releaseWorkflow, /pnpm release:sign-linux/);
  assert.match(releaseWorkflow, /pnpm release:upgrade-smoke/);
  assert.match(releaseWorkflow, /JANUS_STUDIO_REQUIRE_OFFICIAL_RELEASE: "1"/);
  assert.doesNotMatch(releaseWorkflow, /node -e .*Tag must equal/);
  assert.match(releaseMetadata, /signing\.officialReady === true/);
  assert.doesNotMatch(releaseMetadata, /Boolean\(identity\.tag\)/);
});

test("classifies actual platform verification instead of configured credentials", () => {
  assert.deepEqual(
    classifyMacVerification({
      codesignStatus: 0,
      codesignDetails: "Authority=Developer ID Application: Example Corp (TEAM123)",
      staplerStatus: 0,
      gatekeeperStatus: 0,
    }),
    { signature: "verified", notarization: "verified", installability: "passed", officialReady: true },
  );
  assert.equal(classifyMacVerification({ codesignStatus: 0, codesignDetails: "Signature=adhoc", staplerStatus: 1, gatekeeperStatus: 1 }).officialReady, false);
  assert.equal(classifyWindowsVerification({ status: "NotSigned" }).signature, "unsigned");
  assert.equal(classifyWindowsVerification({ status: "Valid" }).officialReady, true);
  assert.equal(classifyLinuxVerification({ packageCheckPassed: true, detachedSignaturePassed: true, fingerprintMatches: null }).officialReady, false);
  assert.equal(classifyLinuxVerification({ packageCheckPassed: true, detachedSignaturePassed: true, fingerprintMatches: true }).officialReady, true);
});

test("requires every artifact to pass before a release is official", () => {
  const report = summarizeArtifactVerification("linux", [
    { signature: "verified", notarization: "not-applicable", installability: "passed", officialReady: true },
    { signature: "unsigned", notarization: "not-applicable", installability: "passed", officialReady: false },
  ]);
  assert.equal(report.officialReady, false);
  assert.equal(report.signature, "unsigned");
  assert.equal(report.installability, "passed");
});
