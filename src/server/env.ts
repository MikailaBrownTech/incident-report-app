/** Public base URL of the app (used in emailed links and by Better Auth). */
export function appUrl(): string {
  return process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
}
