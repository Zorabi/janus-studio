import { spawnSync } from "node:child_process";
import { verifyReleaseIdentity } from "./release-verify.mjs";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(args) {
  const result = spawnSync(pnpm, args, { stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

await verifyReleaseIdentity();
run(["i18n:generate"]);
await verifyReleaseIdentity();
run(["typecheck"]);
run(["test"]);
console.log("Release preflight passed: generated sources are clean, identity is aligned, typecheck and tests succeeded.");
