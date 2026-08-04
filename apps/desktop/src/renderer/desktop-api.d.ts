import type { DesktopApi } from "@janusgraph/domain";

declare global {
  interface Window {
    janusGraphDesktop?: DesktopApi;
  }
}

export {};
