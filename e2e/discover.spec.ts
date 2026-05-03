// e2e/discover.spec.ts
import { test, expect } from "@playwright/test";

// This test requires a seeded user with a complete profile + a precomputed
// snapshot. Set E2E_DISCOVER_USER_TOKEN to run; skipped otherwise.
test.describe("Discover golden path", () => {
  test.skip(!process.env.E2E_DISCOVER_USER_TOKEN, "needs seeded user token");

  test("desktop: lands, opens preview, saves, sees in saved-guides", async ({ page }) => {
    await page.goto("/workspace/career-compass");

    // Phase 9.3 changed lane labels to editorial copy; assert against the new copy.
    await expect(page.getByText("Next steps")).toBeVisible();
    await expect(page.getByText("Sideways moves")).toBeVisible();
    await expect(page.getByText("A different chapter")).toBeVisible();

    const firstCard = page.locator("[data-testid='guide-card']").first();
    await firstCard.click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.getByRole("button", { name: /save/i }).click();
    await page.goto("/workspace/saved-guides");
    await expect(page.getByText(/saved guides/i)).toBeVisible();
    await expect(page.locator("a", { hasText: /./ }).first()).toBeVisible();
  });

  test("mobile viewport renders lane tabs not canvas", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
    const page = await ctx.newPage();
    await page.goto("/workspace/career-compass");
    // Mobile DiscoverMobile renders Tabs with the original lane labels
    // ("Linear" / "Adjacent" / "Transformational"). Phase 9.3 only updated
    // the desktop canvas labels; mobile tab labels were left as-is.
    await expect(page.getByRole("tab", { name: /Linear/ })).toBeVisible();
    await ctx.close();
  });
});
