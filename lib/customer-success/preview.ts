/** Exact fixture-only route. App routes always retain their existing auth gates. */
export function isDevelopmentCsPreview(pathname: string, nodeEnv: string | undefined): boolean {
  return nodeEnv === "development" && pathname === "/cs-preview";
}
