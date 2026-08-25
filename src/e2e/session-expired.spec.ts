import { test, expect } from "@playwright/test";

// Real-user invariant: if my session goes away mid-session, the next page I hit
// must NOT keep showing me the chat surface. The (authenticated) layout calls
// getCurrentUser() which throws "User not found" without a NextAuth session
// (features/auth-page/helpers.ts), so the composer should disappear.
//
// We simulate session loss by clearing the auth cookie from the browser
// context — the same effect as session expiry / logout in another tab.
test.describe("session-expired", () => {
  test("clearing the auth cookie hides the chat surface on next navigation", async ({ page, context }) => {
    // Sanity: authenticated user reaches the composer.
    await page.goto("/chat/temporary");
    const textarea = page.getByPlaceholder("Type your message...").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });

    // Drop the NextAuth session cookie (both possible names depending on protocol).
    const cookies = await context.cookies();
    const sessionCookieNames = cookies
      .filter((c) => /next-auth\.session-token$/.test(c.name))
      .map((c) => c.name);
    expect(sessionCookieNames.length).toBeGreaterThan(0);
    await context.clearCookies({ name: sessionCookieNames[0] });

    // Hard navigate (don't trust client-side caching).
    await page.goto("/chat/temporary", { waitUntil: "domcontentloaded" });

    // The chat composer must NOT be present without a session.
    await expect(textarea).toBeHidden({ timeout: 10_000 });
  });
});
