import assert from "node:assert/strict";
import test from "node:test";
import {
  createDockerServerPath,
  dockerCliCandidates,
  dockerExecAsRoot,
  parseDockerContainers,
  validateDockerTarget,
} from "../../apps/desktop/src/main/services/docker-transfer.ts";

test("parses running Docker containers without using shell output columns", () => {
  const containers = parseDockerContainers([
    JSON.stringify({ ID: "abc123", Names: "janusgraph", Image: "janusgraph/janusgraph:1.1", Status: "Up 2 hours" }),
    "not-json",
    JSON.stringify({ ID: "", Names: "missing-id" }),
  ].join("\n"));
  assert.deepEqual(containers, [{
    id: "abc123",
    name: "janusgraph",
    image: "janusgraph/janusgraph:1.1",
    status: "Up 2 hours",
  }]);
});

test("creates isolated container paths and rejects unsafe Docker targets", () => {
  assert.match(createDockerServerPath("JSON"), /^\/tmp\/janus-studio-[0-9a-f-]+\.json$/);
  assert.equal(validateDockerTarget("janusgraph-1"), "janusgraph-1");
  assert.throws(() => validateDockerTarget("janusgraph; rm -rf /"), /格式无效/);
  assert.deepEqual(
    dockerExecAsRoot("janusgraph-1", "chmod", "0644", "/tmp/data.graphson"),
    ["exec", "--user", "0", "janusgraph-1", "chmod", "0644", "/tmp/data.graphson"],
  );
});

test("finds Docker CLIs outside the reduced macOS GUI application PATH", () => {
  const candidates = dockerCliCandidates({
    platform: "darwin",
    pathValue: "/usr/bin:/bin",
    homeDirectory: "/Users/tester",
  });
  assert.ok(candidates.includes("/usr/local/bin/docker"));
  assert.ok(candidates.includes("/Applications/Docker.app/Contents/Resources/bin/docker"));
  assert.ok(candidates.includes("/Applications/OrbStack.app/Contents/MacOS/xbin/docker"));
  assert.ok(candidates.includes("/Users/tester/.docker/bin/docker"));
});
