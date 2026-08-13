const REDACTED = "[REDACTED]";
const MAX_DEPTH = 12;

const sensitiveKeyPattern = /(?:password|passwd|passphrase|secret|token|authorization|proxyauthorization|cookie|setcookie|privatekey|clientkey|apikey|accesskey|credential|passwordcipher|headers|customheaders)$/i;

function normalizedKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function isSensitiveDiagnosticKey(key: string): boolean {
  return sensitiveKeyPattern.test(normalizedKey(key));
}

export function redactDiagnosticText(value: string): string {
  return value
    .replace(
      /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/gi,
      REDACTED,
    )
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s/@]+)(@)/gi, `$1${REDACTED}$3`)
    .replace(
      /(["'](?:password|passwd|passphrase|secret|token|authorization|proxy-authorization|api[-_]?key|access[-_]?token|refresh[-_]?token)["']\s*:\s*["'])([^"']*)(["'])/gi,
      `$1${REDACTED}$3`,
    )
    .replace(/((?:proxy-)?authorization\s*[:=]\s*)(?:bearer|basic)\s+[^\s,;]+/gi, `$1${REDACTED}`)
    .replace(/((?:x-)?api[-_ ]?key\s*[:=]\s*)[^\s,;]+/gi, `$1${REDACTED}`)
    .replace(/((?:--)?(?:password|passwd|passphrase|secret|token)\s+)[^\s]+/gi, `$1${REDACTED}`)
    .replace(
      /((?:password|passwd|passphrase|secret|access[-_ ]?token|refresh[-_ ]?token)\s*[:=]\s*)(["']?)[^\s,"';}\]]+/gi,
      `$1$2${REDACTED}`,
    )
    .replace(/([?&](?:token|access_token|refresh_token|api_key)=)[^&#\s]+/gi, `$1${REDACTED}`);
}

function redactError(error: Error, seen: WeakSet<object>, depth: number): Record<string, unknown> {
  const output: Record<string, unknown> = {
    name: redactDiagnosticText(error.name),
    message: redactDiagnosticText(error.message),
  };
  if (error.stack) output.stack = redactDiagnosticText(error.stack);
  if ("cause" in error && error.cause !== undefined) {
    output.cause = redactValue(error.cause, seen, depth + 1);
  }
  for (const [key, value] of Object.entries(error)) {
    if (key === "name" || key === "message" || key === "stack" || key === "cause") continue;
    output[key] = isSensitiveDiagnosticKey(key)
      ? REDACTED
      : redactValue(value, seen, depth + 1);
  }
  return output;
}

function redactValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (depth > MAX_DEPTH) return "[MAX_DEPTH]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return redactDiagnosticText(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol" || typeof value === "function") return `[${typeof value}]`;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (value instanceof Error) return redactError(value, seen, depth);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen, depth + 1));
  if (value instanceof Map) {
    return [...value.entries()].map(([key, item]) => {
      const redactedKey = redactValue(key, seen, depth + 1);
      const redactedItem = typeof key === "string" && isSensitiveDiagnosticKey(key)
        ? REDACTED
        : redactValue(item, seen, depth + 1);
      return [redactedKey, redactedItem];
    });
  }
  if (value instanceof Set) {
    return [...value].map((item) => redactValue(item, seen, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = isSensitiveDiagnosticKey(key)
      ? REDACTED
      : redactValue(item, seen, depth + 1);
  }
  return output;
}

function redactExplicitText(value: unknown, sensitiveTexts: string[]): unknown {
  if (typeof value === "string") {
    return sensitiveTexts.reduce(
      (result, sensitiveText) => result.split(sensitiveText).join(REDACTED),
      value,
    );
  }
  if (Array.isArray(value)) return value.map((item) => redactExplicitText(item, sensitiveTexts));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, redactExplicitText(item, sensitiveTexts)]),
  );
}

export function redactDiagnosticValue(value: unknown, sensitiveTexts: string[] = []): unknown {
  const redacted = redactValue(value, new WeakSet<object>(), 0);
  const explicitTexts = [...new Set(sensitiveTexts.filter((text) => text.length > 0))]
    .sort((left, right) => right.length - left.length);
  return explicitTexts.length > 0 ? redactExplicitText(redacted, explicitTexts) : redacted;
}

export function redactDiagnosticRecord(value?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!value) return undefined;
  return redactDiagnosticValue(value) as Record<string, unknown>;
}

export { REDACTED as DIAGNOSTIC_REDACTED_VALUE };
