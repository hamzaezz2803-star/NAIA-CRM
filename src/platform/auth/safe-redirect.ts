const DEFAULT_REDIRECT_PATH = "/dashboard";

export function sanitizeRedirectPath(
  value: FormDataEntryValue | string | null | undefined,
  fallback = DEFAULT_REDIRECT_PATH,
) {
  if (typeof value !== "string") {
    return fallback;
  }

  const path = value.trim();

  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.startsWith("/login") ||
    path.includes("\\")
  ) {
    return fallback;
  }

  return path;
}
