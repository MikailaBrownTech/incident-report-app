import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

/** Latest dev-outbox message for an address (see src/server/email/send.ts). */
export async function latestMail(to: string): Promise<{ subject: string; text: string }> {
  const file = `.dev-outbox/${to.replace(/[^a-z0-9@._-]/gi, "_")}.json`;
  await expect
    .poll(async () => readFile(file, "utf8").then(() => true, () => false), { timeout: 15_000 })
    .toBe(true);
  return JSON.parse(await readFile(file, "utf8"));
}

export async function linkFromMail(to: string): Promise<string> {
  const { text } = await latestMail(to);
  const url = /https?:\/\/\S+/.exec(text)?.[0];
  if (!url) throw new Error(`no link in mail to ${to}`);
  return url;
}

/** Full magic-link sign-in through the real UI. Ends on whatever page the link redirects to. */
export async function signIn(page: Page, email: string, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByRole("button", { name: /summoning link|sign-in link/i }).click();
  await expect(page.getByRole("status")).toBeVisible();
  const link = await linkFromMail(email);
  await page.goto(link);
}
