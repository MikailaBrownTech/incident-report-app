import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const outboxFile = (to: string) => `.dev-outbox/${to.replace(/[^a-z0-9@._-]/gi, "_")}.json`;

/** Latest dev-outbox message for an address (see src/server/email/send.ts). */
export async function latestMail(to: string): Promise<{ subject: string; text: string }> {
  await expect
    .poll(async () => readFile(outboxFile(to), "utf8").then(() => true, () => false), { timeout: 15_000 })
    .toBe(true);
  return JSON.parse(await readFile(outboxFile(to), "utf8"));
}

/** Wait for a mail to `to` whose link matches `pattern`, and return that link. */
export async function waitForLink(to: string, pattern: RegExp): Promise<string> {
  let link = "";
  await expect
    .poll(
      async () => {
        const url = /https?:\/\/\S+/.exec((await latestMail(to)).text)?.[0] ?? "";
        link = pattern.test(url) ? url : "";
        return link;
      },
      { timeout: 20_000 },
    )
    .not.toBe("");
  return link;
}

/**
 * Full magic-link flow through the real UI. `callbackUrl` is where the link should land.
 * Ends on whatever page the link redirects to.
 */
export async function signInWithEmail(
  page: Page,
  email: string,
  options: { mode?: "sign-in" | "sign-up"; callbackUrl?: string; button: RegExp },
) {
  const { mode = "sign-in", callbackUrl, button } = options;
  const query = callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : "";
  await page.goto(`/${mode}${query}`);
  await page.locator("#email").fill(email);
  await page.getByRole("button", { name: button }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await page.goto(await waitForLink(email, /magic-link\/verify/));
}

/** Screenshot at desktop (1440) and phone (390) widths, leaving the page at its original size. */
export async function shoot(page: Page, name: string, prepare?: (width: number) => Promise<void>) {
  const original = page.viewportSize();
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await prepare?.(width);
    await page.screenshot({ path: `e2e/screenshots/${name}-${width}.png`, fullPage: true });
  }
  if (original) await page.setViewportSize(original);
}
