import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  loadSettings,
} from "../../apps/desktop/src/renderer/lib/settings.ts";

function installLocalStorage(values: Record<string, string>) {
  const storage = new Map(Object.entries(values));
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
}

test("uses spacious graph defaults as the minimum while preserving larger values", () => {
  installLocalStorage({
    "janusgraph.settings.v8": JSON.stringify({
      graphLayoutConfiguration: {
        force: { linkDistance: 300 },
        hierarchical: { levelGap: 150, nodeGap: 230 },
        radial: { ringGap: 100 },
        grid: { columnGap: 240, rowGap: 100 },
      },
    }),
  });

  try {
    const settings = loadSettings();
    assert.equal(settings.graphLayoutConfiguration.force.linkDistance, 300);
    assert.equal(
      settings.graphLayoutConfiguration.hierarchical.levelGap,
      DEFAULT_SETTINGS.graphLayoutConfiguration.hierarchical.levelGap,
    );
    assert.equal(settings.graphLayoutConfiguration.hierarchical.nodeGap, 230);
    assert.equal(
      settings.graphLayoutConfiguration.radial.ringGap,
      DEFAULT_SETTINGS.graphLayoutConfiguration.radial.ringGap,
    );
    assert.equal(settings.graphLayoutConfiguration.grid.columnGap, 240);
    assert.equal(
      settings.graphLayoutConfiguration.grid.rowGap,
      DEFAULT_SETTINGS.graphLayoutConfiguration.grid.rowGap,
    );
  } finally {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});
