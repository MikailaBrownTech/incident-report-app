import { expect, test } from "@playwright/test";
import { getCopy } from "../src/copy";
import { linkFromMail, signIn } from "./helpers";

const run = Date.now();
const ownerEmail = `owner-${run}@example.test`;
const guestEmail = `guest-${run}@example.test`;
const strangerEmail = `stranger-${run}@example.test`;
const haunted = getCopy("haunted");
const professional = getCopy("professional");
const OWNER_STATE = "e2e/.results/owner-state.json";

let slug = "";

// Magic-link sign-in is slow, so each person signs in exactly once; the owner's session is
// saved and reused by the tests after this one.
test.describe("owner onboarding", () => {
  test.describe.configure({ mode: "serial" });

  test("sign in with a magic link, then create a workspace", async ({ page, context }) => {
    await page.goto("/w/does-not-exist/dashboard");
    await expect(page).toHaveURL(/\/login\?next=/); // signed-out visitors go to login

    await signIn(page, ownerEmail);
    await expect(page).toHaveURL(/\/onboarding$/); // no workspace yet

    await page.getByLabel(haunted.onboarding.workspaceNameLabel).fill("Night Shift");
    await page.getByRole("button", { name: haunted.onboarding.create }).click();
    await expect(page).toHaveURL(/\/w\/night-shift\/dashboard$/);
    slug = new URL(page.url()).pathname.split("/")[2];

    await expect(page.locator("html")).toHaveAttribute("data-skin", "haunted");
    await expect(page.locator("[data-skin]")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(haunted.dashboard.heading);
    await page.screenshot({ path: "e2e/screenshots/dashboard-haunted.png", fullPage: true });
    await context.storageState({ path: OWNER_STATE });
  });
});

test.describe("as the signed-in owner", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ storageState: OWNER_STATE });

  test("the skin toggle saves on the workspace and survives clearing cookies", async ({ page, context }) => {
    await page.goto(`/w/${slug}/dashboard`);
    await page.getByTestId("skin-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-skin", "professional");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(professional.dashboard.heading);
    await expect(page.locator("[data-skin]")).toHaveCount(1);
    await page.screenshot({ path: "e2e/screenshots/dashboard-professional.png", fullPage: true });

    // The cookie is only a pre-login default; inside the workspace the DB value wins.
    await context.clearCookies({ name: "crypt-skin" });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-skin", "professional");

    await page.goto(`/w/${slug}/settings`);
    await page.screenshot({ path: "e2e/screenshots/settings-professional.png", fullPage: true });
  });

  test("invite a teammate who accepts from the emailed link", async ({ page, browser }) => {
    await page.goto(`/w/${slug}/settings/members`);
    await page.getByLabel(professional.members.emailLabel).fill(guestEmail);
    await page.getByRole("button", { name: professional.actions.invite }).click();
    await expect(page.getByRole("status")).toContainText(guestEmail);

    const inviteLink = await linkFromMail(guestEmail);
    expect(new URL(inviteLink).pathname).toMatch(/^\/invite\//);

    // Explicitly empty: a new context otherwise inherits the owner's saved session.
    const guest = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const guestPage = await guest.newPage();
    await guestPage.goto(inviteLink);
    // A fresh browser has no skin cookie, so the invite page uses the pre-login default.
    await guestPage.getByRole("link", { name: haunted.invite.signInToAccept }).click();
    await expect(guestPage).toHaveURL(/\/login\?next=%2Finvite/);
    // Sign in via magic link; it returns to the invite page.
    await guestPage.getByLabel(/email/i).fill(guestEmail);
    await guestPage.getByRole("button", { name: /summoning link|sign-in link/i }).click();
    await expect(guestPage.getByRole("status")).toBeVisible();
    await expect.poll(async () => (await linkFromMail(guestEmail)).includes("magic-link")).toBe(true);
    await guestPage.goto(await linkFromMail(guestEmail));
    await guestPage.getByRole("button", { name: haunted.invite.accept }).click();
    await expect(guestPage).toHaveURL(new RegExp(`/w/${slug}/dashboard$`));
    await guest.close();

    await page.reload();
    await expect(page.getByText(guestEmail, { exact: true })).toBeVisible(); // in the members list
  });
});

test("a signed-in non-member gets a 404 for someone else's workspace", async ({ page }) => {
  await signIn(page, strangerEmail);
  await expect(page).toHaveURL(/\/onboarding$/);

  expect((await page.goto(`/w/${slug}/dashboard`))?.status()).toBe(404);
  expect((await page.goto(`/w/${slug}/settings/members`))?.status()).toBe(404);
  await expect(page.getByText("Night Shift")).toHaveCount(0);
});
