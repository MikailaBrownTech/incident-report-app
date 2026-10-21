import { expect, test, type Page } from "@playwright/test";
import { getCopy, type SkinKey } from "../src/copy";

const SKINS: SkinKey[] = ["haunted", "professional"];
const other = (s: SkinKey): SkinKey => (s === "haunted" ? "professional" : "haunted");

// Add dashboard, incidents list and incident detail here as those screens land (M1/M2).
const SCREENS = [
  { name: "landing", path: "/" },
  { name: "styleguide", path: "/dev/styleguide" },
];

async function useSkin(page: Page, skin: SkinKey) {
  await page.context().addCookies([
    { name: "crypt-skin", value: skin, url: "http://localhost:3000" },
  ]);
}

for (const skin of SKINS) {
  for (const screen of SCREENS) {
    test(`${screen.name} renders only the ${skin} skin`, async ({ page }) => {
      await useSkin(page, skin);
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
      const viewport = page.viewportSize()!;
      expect(main!.width).toBeGreaterThan(viewport.width * 0.9);

      await page.screenshot({
        path: `e2e/screenshots/${screen.name}-${skin}.png`,
        fullPage: true,
      });
    });
  }
}

test("defaults to haunted with no cookie", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-skin", "haunted");
});

test("toggle switches the whole app and persists across reloads and pages", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-skin", "haunted");

  await page.getByTestId("skin-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-skin", "professional");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    getCopy("professional").brand.tagline,
  );

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-skin", "professional");

  await page.goto("/dev/styleguide");
  await expect(page.locator("html")).toHaveAttribute("data-skin", "professional");
  await page.getByTestId("skin-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-skin", "haunted");
});
