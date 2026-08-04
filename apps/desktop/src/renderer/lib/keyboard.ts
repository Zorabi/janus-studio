export function shortcutFromEvent(event: KeyboardEvent): string | null {
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("Mod");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  const key =
    event.code === "Space"
      ? "Space"
      : event.code === "BracketLeft" || event.code === "BracketRight"
        ? event.code
        : event.key.length === 1
          ? event.key.toUpperCase()
          : event.key;
  if (["Meta", "Control", "Alt", "Shift"].includes(key)) return null;
  if (parts.length === 0 && !/^F\d{1,2}$/.test(key)) return null;
  return [...parts, key].join("+");
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  return shortcutFromEvent(event) === shortcut;
}

export function shortcutLabel(shortcut: string): string {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  return shortcut
    .replace("Mod", isMac ? "⌘" : "Ctrl")
    .replace("Alt", isMac ? "⌥" : "Alt")
    .replace("Shift", isMac ? "⇧" : "Shift")
    .replace("BracketLeft", "[")
    .replace("BracketRight", "]")
    .replaceAll("+", isMac ? " " : " + ");
}
