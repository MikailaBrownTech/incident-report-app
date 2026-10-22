import { expect, test, type Browser } from "@playwright/test";
import { getCopy } from "../src/copy";
import { shoot, signInWithEmail, waitForLink } from "./helpers";

const run = Date.now();
const emailA = `alice-${run}@example.test`;
const emailB = `bob-${run}@example.test`;
const emailC = `carol-${run}@example.test`;
const emailD = `dave-${run}@example.test`;
const h = getCopy("haunted"); // every workspace starts HAUNTED and this spec never switches skin
const signUpButton = /send the invitation link/i;
const signInButton = /send the summoning link/i;

test.describe.configure({ mode: "serial" });

/** A fresh browser with no session at all (a bare newContext would inherit nothing, but be explicit). */
const freshContext = (browser: Browser) => browser.newContext({ storageState: { cookies: [], origins: [] } });

let inviteLink = "";

test("1. Alice signs up and creates the workspace Acme", async ({ page }) => {
  // The protected area sends signed-out visitors to sign-in with a callbackUrl.
  await page.goto("/app/acme/dashboard");
  await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fapp%2Facme%2Fdashboard/);
  await shoot(page, "sign-in");

  await signInWithEmail(page, emailA, { mode: "sign-up", button: signUpButton });
  await expect(page).toHaveURL(/\/onboarding$/); // no memberships yet

  // Slug follows the name until edited, and is validated inline.
  await page.getByLabel(h.onboarding.workspaceNameLabel).fill("Acme");
  await expect(page.getByLabel(h.onboarding.slugLabel)).toHaveValue("acme");
  await shoot(page, "onboarding");

  await page.getByLabel(h.onboarding.slugLabel).fill("admin");
  await page.getByRole("button", { name: h.onboarding.create }).click();
  await expect(page.getByText(h.onboarding.slugReserved)).toBeVisible();
  await page.getByLabel(h.onboarding.slugLabel).fill("Bad Slug!");
  await page.getByRole("button", { name: h.onboarding.create }).click();
  await expect(page.getByText(h.onboarding.slugInvalid)).toBeVisible();
  await page.getByLabel(h.onboarding.slugLabel).fill("acme");
  await page.getByRole("button", { name: h.onboarding.create }).click();

  await expect(page).toHaveURL(/\/app\/acme\/dashboard$/);
  await expect(page.locator("html")).toHaveAttribute("data-skin", "haunted");

  // /app remembers the last-used workspace.
  await page.goto("/app");
  await expect(page).toHaveURL(/\/app\/acme\/dashboard$/);
});

test("2. Alice invites Bob as a member", async ({ page, context }) => {
  await signInWithEmail(page, emailA, { callbackUrl: "/app", button: signInButton });
  await expect(page).toHaveURL(/\/app\/acme\/dashboard$/);
  await context.storageState({ path: "e2e/.results/alice.json" });

  await page.goto("/app/acme/settings/members");
  await page.locator("#invite-email").fill("not-an-email");
  await page.getByRole("button", { name: h.members.sendInvite }).click();
  await expect(page.getByText(getCopy("haunted").validation.invalidEmail)).toBeVisible();

  await page.locator("#invite-email").fill(emailB);
  await page.locator("#invite-role").selectOption("MEMBER");
  await page.getByRole("button", { name: h.members.sendInvite }).click();
  await expect(page.getByRole("status").filter({ hasText: h.members.inviteSent(emailB) })).toBeVisible();
  await expect(page.getByTestId(`invite-${emailB}`)).toBeVisible();

  inviteLink = await waitForLink(emailB, /\/invite\//);
  await shoot(page, "members-owner");
});

test("3. Bob accepts the invite and sees Acme in the switcher", async ({ browser }) => {
  // A signed-in stranger sees a clear mismatch message and a way to switch accounts.
  const carol = await freshContext(browser);
  const carolPage = await carol.newPage();
  await signInWithEmail(carolPage, emailC, { mode: "sign-up", callbackUrl: "/onboarding", button: signUpButton });
  await carolPage.goto(inviteLink);
  await expect(carolPage.getByText(h.invite.mismatchHeading)).toBeVisible();
  await expect(carolPage.getByText(h.invite.mismatchBody(emailB, emailC))).toBeVisible();
  await expect(carolPage.getByRole("button", { name: h.invite.switchAccount })).toBeVisible();
  await shoot(carolPage, "invite-mismatch");
  await carol.storageState({ path: "e2e/.results/carol.json" });
  await carol.close();

  const bob = await freshContext(browser);
  const page = await bob.newPage();
  await page.goto(inviteLink);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(h.invite.heading("Acme"));
  await shoot(page, "invite-accept-signed-out");

  await page.getByRole("link", { name: h.invite.signInToAccept }).click();
  await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Finvite%2F/);
  await page.locator("#email").fill(emailB);
  await page.getByRole("button", { name: signInButton }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await page.goto(await waitForLink(emailB, /magic-link\/verify/)); // returns to the invite page
  await expect(page.getByRole("button", { name: h.invite.accept })).toBeVisible();
  await shoot(page, "invite-accept");

  await page.getByRole("button", { name: h.invite.accept }).click();
  await expect(page).toHaveURL(/\/app\/acme\/dashboard$/);

  // The switcher lists Acme (open the menu first on a phone-sized screen).
  await shoot(page, "workspace-switcher", async (width) => {
    if (width < 768) {
      // the sidebar sits behind a menu button on phones
      const menu = page.getByRole("button", { name: h.a11y.openMenu });
      if (await menu.isVisible()) await menu.click();
    }
    const trigger = page.getByTestId("workspace-switcher");
    // state survives the resize, so only open it when it is closed
    if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
    await expect(page.getByRole("link", { name: "Acme", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: h.userMenu.newWorkspace })).toBeVisible();
  });

  await bob.storageState({ path: "e2e/.results/bob.json" });
  await bob.close();
});

test("4. Bob (a plain member) cannot use Members management", async ({ browser }) => {
  const bob = await browser.newContext({ storageState: "e2e/.results/bob.json" });
  const page = await bob.newPage();
  await page.goto("/app/acme/settings/members");

  await expect(page.getByText(h.members.readOnlyNote)).toBeVisible();
  await expect(page.locator("#invite-email")).toHaveCount(0);
  await expect(page.getByText(h.members.pendingInvites)).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(0); // no role selectors
  await expect(page.getByRole("button", { name: h.members.removeMember })).toHaveCount(0);
  // the only action available is leaving
  await expect(page.getByRole("button", { name: h.members.leave })).toHaveCount(1);
  await shoot(page, "members-member");

  // and the API agrees
  const invite = await page.request.post("/api/w/acme/invites", { data: { email: emailD, role: "MEMBER" } });
  expect(invite.status()).toBe(403);
  expect((await page.request.get("/api/w/acme/invites")).status()).toBe(403);
  await bob.close();
});

test("5. Carol creates Other and gets a 404 on /app/acme", async ({ browser }) => {
  const carol = await browser.newContext({ storageState: "e2e/.results/carol.json" });
  const page = await carol.newPage();
  await page.goto("/onboarding");
  await page.getByLabel(h.onboarding.workspaceNameLabel).fill("Other");
  await page.getByRole("button", { name: h.onboarding.create }).click();
  await expect(page).toHaveURL(/\/app\/other\/dashboard$/);

  expect((await page.goto("/app/acme/dashboard"))?.status()).toBe(404);
  expect((await page.goto("/app/acme/settings/members"))?.status()).toBe(404);
  await expect(page.getByText(emailA)).toHaveCount(0);
  expect((await page.request.get("/api/w/acme/members")).status()).toBe(404);
  expect((await page.request.get("/api/w/acme")).status()).toBe(404);
  await carol.close();
});

test("6. Alice promotes Bob to admin, then Bob can invite", async ({ browser }) => {
  const alice = await browser.newContext({ storageState: "e2e/.results/alice.json" });
  const alicePage = await alice.newPage();
  await alicePage.goto("/app/acme/settings/members");
  const bobRow = alicePage.getByTestId(`member-${emailB}`);
  await bobRow.getByRole("combobox").selectOption("ADMIN");
  await expect(alicePage.getByRole("status").filter({ hasText: h.members.roleChanged })).toBeVisible();
  await expect(bobRow.getByRole("combobox")).toHaveValue("ADMIN");

  // the owner row can't be demoted from here: it's the only owner
  const own = alicePage.getByTestId(`member-${emailA}`);
  await own.getByRole("combobox").selectOption("MEMBER");
  await expect(alicePage.getByRole("alert").filter({ hasText: h.members.lastOwner })).toBeVisible();
  await expect(own.getByRole("combobox")).toHaveValue("OWNER");

  const bob = await browser.newContext({ storageState: "e2e/.results/bob.json" });
  const bobPage = await bob.newPage();
  await bobPage.goto("/app/acme/settings/members");
  await expect(bobPage.locator("#invite-email")).toBeVisible();
  await bobPage.locator("#invite-email").fill(emailD);
  await bobPage.getByRole("button", { name: h.members.sendInvite }).click();
  await expect(bobPage.getByRole("status").filter({ hasText: h.members.inviteSent(emailD) })).toBeVisible();

  // an admin still can't touch the owner
  const ownerRow = bobPage.getByTestId(`member-${emailA}`);
  await expect(ownerRow.getByRole("combobox")).toHaveCount(0);
  await expect(ownerRow.getByRole("button")).toHaveCount(0);

  // confirm dialog guards destructive actions: cancelling leaves the invite in place
  await bobPage.getByTestId(`invite-${emailD}`).getByRole("button", { name: h.members.revoke }).click();
  await expect(bobPage.getByRole("dialog")).toBeVisible();
  await bobPage.getByRole("button", { name: h.actions.cancel }).click();
  await expect(bobPage.getByTestId(`invite-${emailD}`)).toBeVisible();
  await bobPage.getByTestId(`invite-${emailD}`).getByRole("button", { name: h.members.revoke }).click();
  await bobPage.getByRole("dialog").getByRole("button", { name: h.members.revoke }).click();
  await expect(bobPage.getByTestId(`invite-${emailD}`)).toHaveCount(0);
  await expect(bobPage.getByRole("status").filter({ hasText: h.members.inviteRevoked })).toBeVisible();

  await alice.close();
  await bob.close();
});
