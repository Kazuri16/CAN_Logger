import { test, expect } from "@playwright/test";

test("app shell renders without the login gate when auth is off", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Vehicle Health Dashboard");
  await expect(page.locator("#loginScreen")).toBeHidden();
  await expect(page.locator("#pageTitle")).toHaveText("Home");
});

test("sidebar navigation switches pages", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Alerts", exact: true }).click();
  await expect(page.locator("#pageTitle")).toHaveText("Alerts");
  await expect(page.locator("#alertsPage")).toHaveClass(/active/);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator("#pageTitle")).toHaveText("Settings");
});

test("no console errors on load", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  await expect(page.locator("#pageTitle")).toHaveText("Home");

  expect(errors).toEqual([]);
});
