import assert from "node:assert/strict";
import test from "node:test";
import { isTrustedIpcSender, type IpcWindowTarget } from "../../apps/desktop/src/main/ipc/trusted-sender.ts";

function activeWindow(contents: IpcWindowTarget["webContents"]): IpcWindowTarget {
  return {
    isDestroyed: () => false,
    webContents: contents,
  };
}

test("accepts IPC only from the current live window", () => {
  const contents = { isDestroyed: () => false };
  assert.equal(isTrustedIpcSender(contents, activeWindow(contents)), true);
  assert.equal(isTrustedIpcSender({ isDestroyed: () => false }, activeWindow(contents)), false);
});

test("rejects IPC safely when the application window was closed", () => {
  assert.equal(isTrustedIpcSender({}, null), false);

  const destroyedWindow = {
    isDestroyed: () => true,
    get webContents(): IpcWindowTarget["webContents"] {
      throw new Error("destroyed BrowserWindow.webContents must not be accessed");
    },
  };
  assert.equal(isTrustedIpcSender({}, destroyedWindow), false);
});

test("rejects destroyed web contents and stale senders after window recreation", () => {
  const oldContents = { isDestroyed: () => true };
  const currentContents = { isDestroyed: () => false };
  assert.equal(isTrustedIpcSender(oldContents, activeWindow(oldContents)), false);
  assert.equal(isTrustedIpcSender(oldContents, activeWindow(currentContents)), false);
  assert.equal(isTrustedIpcSender(currentContents, activeWindow(currentContents)), true);
});
