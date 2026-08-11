import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, posix, win32 } from "node:path";
import type { DockerContainerInfo } from "@janusgraph/domain";

const dockerTargetPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

export function validateDockerTarget(value: string): string {
  const target = value.trim();
  if (!dockerTargetPattern.test(target)) {
    throw new Error("Docker 容器名称或 ID 格式无效");
  }
  return target;
}

export function createDockerServerPath(extension = "graphson"): string {
  const safeExtension = extension.toLowerCase().replace(/[^a-z0-9]/g, "") || "graphson";
  return `/tmp/janus-studio-${randomUUID()}.${safeExtension}`;
}

export function dockerExecAsRoot(containerId: string, ...command: string[]): string[] {
  return ["exec", "--user", "0", validateDockerTarget(containerId), ...command];
}

export function dockerCliCandidates({
  platform = process.platform,
  pathValue = process.env.PATH ?? "",
  homeDirectory = homedir(),
  programFiles = process.env.ProgramFiles ?? "C:\\Program Files",
}: {
  platform?: NodeJS.Platform;
  pathValue?: string;
  homeDirectory?: string;
  programFiles?: string;
} = {}): string[] {
  const pathDelimiter = platform === "win32" ? ";" : ":";
  const pathJoin = platform === "win32" ? win32.join : join;
  const binary = platform === "win32" ? "docker.exe" : "docker";
  const fromPath = pathValue
    .split(pathDelimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => pathJoin(entry, binary));
  const known = platform === "darwin"
    ? [
        "/usr/local/bin/docker",
        "/opt/homebrew/bin/docker",
        "/Applications/Docker.app/Contents/Resources/bin/docker",
        "/Applications/OrbStack.app/Contents/MacOS/xbin/docker",
        posix.join(homeDirectory, ".docker/bin/docker"),
        posix.join(homeDirectory, ".rd/bin/docker"),
      ]
    : platform === "win32"
      ? [win32.join(programFiles, "Docker", "Docker", "resources", "bin", "docker.exe")]
      : [
          "/usr/local/bin/docker",
          "/usr/bin/docker",
          "/snap/bin/docker",
          posix.join(homeDirectory, ".docker/bin/docker"),
          posix.join(homeDirectory, ".rd/bin/docker"),
        ];
  return [...new Set([...fromPath, ...known])];
}

export function parseDockerContainers(output: string): DockerContainerInfo[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const value = JSON.parse(line) as Record<string, unknown>;
        const id = String(value.ID ?? "").trim();
        const name = String(value.Names ?? "").trim();
        if (!id || !name) return [];
        return [{
          id,
          name,
          image: String(value.Image ?? ""),
          status: String(value.Status ?? value.State ?? ""),
        }];
      } catch {
        return [];
      }
    });
}
