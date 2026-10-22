import { expect, test, type Page } from "@playwright/test";
import { getCopy, type SkinKey } from "../src/copy";

const SKINS: SkinKey[] = ["haunted", "professional"];
const other = (s: SkinKey): SkinKey => (s === "haunted" ? "professional" : "haunted");

// Signed-out screens. Workspace screens (dashboard, settings, members) are covered in
// auth.spec.ts; add incidents list / incident detail there as those screens land.
const SCREENS = [
  { name: "landing", path: "/" },
  { name: "login", path: "/login" },
];

async function useSkin(page: Page, skin: SkinKey, baseURL: string) {
  await page.context().addCookies([{ name: "crypt-skin", value: skin, url: baseURL }]);
}

for (const skin of SKINS) {
  for (const screen of SCREENS) {
    test(`${screen.name} renders only the ${skin} skin`, async ({ page, baseURL }) => {
      await useSkin(page, skin, baseURL!);
      await page.goto(screen.path);

      await expect(page.locator("html")).toHaveAttribute("data-skin", skin);
      // Exactly one skin scope in the DOM: no split views or nested overrides.
      await expect(page.locator("[data-skin]")).toHaveCount(1);
      await expect(page.locator("main")).toHaveCount(1);

      // The other skin's wording must not appear anywhere on the page.
      const body = await page.locator("body").innerText();
      expect(body).not.toContain(getCopy(other(skin)).brand.tagline);
      expect(body).toContain(getCopy(skin).brand.name);

      // Layout sanity: content is a single column of the viewport, not two panels.
      const main = await page.locator("main").boundingBox();
      expect(main!.width).toBeGreaterThan(page.viewportSize()!.width * 0.9);

      await page.screenshot({ path: `e2e/screenshots/${screen.name}-${skin}.png`, fullPage: true });
    });
  }
}

test("defaults to haunted with no cookie", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-skin", "haunted");
});

test("toggle switches the whole app and persists across reloads and pages", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("skin-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-skin", "professional");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(getCopy("professional").brand.tagline);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-skin", "professional");

  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("data-skin", "professional");
  await page.getByTestId("skin-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-skin", "haunted");
});

// The dev styleguide exists only in `next dev`; this run is a production build.
test("the dev styleguide is not part of the production build", async ({ page }) => {
  const response = await page.goto("/dev/styleguide");
  expect(response?.status()).toBe(404);
});
