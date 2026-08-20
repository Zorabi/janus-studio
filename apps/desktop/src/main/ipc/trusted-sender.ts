export type IpcWindowTarget = {
  isDestroyed(): boolean;
  webContents: {
    isDestroyed(): boolean;
  };
};

export function isTrustedIpcSender(sender: unknown, window: IpcWindowTarget | null): boolean {
  if (!window || window.isDestroyed()) return false;
  const contents = window.webContents;
  return !contents.isDestroyed() && sender === contents;
}
