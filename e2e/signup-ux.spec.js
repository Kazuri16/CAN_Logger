import { test, expect } from "@playwright/test";

test.describe("Signup UX Enhancements", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Ensure login screen is visible
    await expect(page.locator("#loginScreen")).toBeVisible();
  });

  test("login screen renders with signup toggle", async ({ page }) => {
    await expect(page.locator("#authToggle")).toHaveText("New here? Create an account");
    await expect(page.locator("#loginEmail")).toBeVisible();
    await expect(page.locator("#loginPassword")).toBeVisible();
  });

  test("clicking signup toggle switches to signup mode", async ({ page }) => {
    const toggle = page.locator("#authToggle");
    await toggle.click();
    await page.waitForTimeout(300); // wait for JS to update DOM

    // Verify mode changed
    await expect(page.locator("#loginTitle")).toHaveText("Create account");
    await expect(page.locator("#authSubmit")).toHaveText("Create account");
    await expect(toggle).toHaveText("Have an account? Sign in");

    // Confirm password field should appear
    await expect(page.locator("#confirmPassword")).toBeVisible();
  });

  test("password strength meter appears and updates", async ({ page }) => {
    // Switch to signup mode first
    await page.locator("#authToggle").click();

    // Type a weak but valid password (8+ chars, no uppercase/numbers/symbols)
    const passwordInput = page.locator("#loginPassword");
    await passwordInput.fill("abcdefgh");
    await passwordInput.blur();
    await page.waitForTimeout(100);

    // Strength indicator should be visible with "Weak" label
    await expect(page.locator("#passwordStrength")).not.toBeHidden();
    await expect(page.locator("#strengthLabel")).toHaveText("Weak");

    // Type a strong password
    await passwordInput.fill("Abcdefg1!");
    await passwordInput.blur();
    await page.waitForTimeout(100);
    await expect(page.locator("#strengthLabel")).toHaveText("Strong");
  });

  test("email validation shows feedback on blur", async ({ page }) => {
    const emailInput = page.locator("#loginEmail");
    const hint = page.locator("#emailHint");

    // Type invalid email
    await emailInput.fill("invalid-email");
    await emailInput.blur();

    // Should show error
    await expect(hint).not.toBeEmpty();
    await expect(hint).toHaveClass(/text-danger/);

    // Type valid email
    await emailInput.fill("user@example.com");
    await emailInput.blur();

    // Should show success
    await expect(hint).toHaveText(/Valid email/);
    await expect(hint).toHaveClass(/text-success/);
  });

  test("confirm password validation on blur", async ({ page }) => {
    // Switch to signup mode
    await page.locator("#authToggle").click();
    await page.waitForTimeout(300);

    const passwordInput = page.locator("#loginPassword");
    const confirmInput = page.locator("#confirmPassword");
    const hint = page.locator("#confirmHint");

    // Fill passwords
    await passwordInput.fill("Testpass123");
    await confirmInput.fill("different");
    await confirmInput.blur();

    // Should show error
    await expect(hint).toHaveText(/match/i);
    await expect(hint).toHaveClass(/text-danger/);

    // Fill matching password
    await confirmInput.fill("Testpass123");
    await confirmInput.blur();

    // Should show success
    await expect(hint).toHaveText(/match/i);
    await expect(hint).toHaveClass(/text-success/);
  });

  test("toggling back to login hides confirm password", async ({ page }) => {
    // Switch to signup
    await page.locator("#authToggle").click();
    await page.waitForTimeout(500); // wait for JS to update DOM
    await expect(page.locator("#confirmPassword")).toBeVisible();

    // Switch back to login
    await page.locator("#authToggle").click();
    await page.waitForTimeout(300);
    await expect(page.locator("#confirmPassword")).toBeHidden();
    await expect(page.locator("#loginTitle")).toHaveText("Sign in");
    await expect(page.locator("#authSubmit")).toHaveText("Sign in");
  });
});
