import { spawnSync } from "node:child_process";
import process from "node:process";

const compose = ["compose", "-f", "tests/compat/docker-compose.yml"];
const environment = {
  ...process.env,
  JANUSGRAPH_VERSION: process.env.JANUSGRAPH_VERSION ?? "1.1.0",
};

function run(args, options = {}) {
  const result = spawnSync("docker", args, {
    cwd: new URL("../../", import.meta.url),
    env: environment,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `docker ${args.join(" ")} failed`);
  }
  return result.stdout;
}

try {
  run([...compose, "up", "-d", "--remove-orphans"]);
  const test = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", "tests/integration/janusgraph-live.test.ts"],
    {
      cwd: new URL("../../", import.meta.url),
      env: { ...environment, JANUSGRAPH_COMPAT_LIVE: "1" },
      stdio: "inherit",
    },
  );
  if (test.status !== 0) process.exitCode = test.status ?? 1;
} finally {
  if (process.exitCode) {
    run([...compose, "logs", "--no-color"], { capture: false });
  }
  run([...compose, "down", "--volumes", "--remove-orphans"]);
}
