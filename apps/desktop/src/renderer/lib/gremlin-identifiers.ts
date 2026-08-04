export function safeIdentifier(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? value : "graph";
}

export function stringLiteral(value: string): string {
  return JSON.stringify(value);
}
