export function formatDate(value: string, locale = "zh-CN"): string {
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "操作失败，请稍后重试";
  return error.message.replace(
    /^Error invoking remote method '[^']+': Error:\s*/,
    "",
  );
}
