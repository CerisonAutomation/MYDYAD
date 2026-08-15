import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test("renders the first page", async ({ electronApp }) => {
  const page = await electronApp.firstWindow();
  await page.waitForSelector("h1");
  const text = await page.locator("h1").textContent();
  expect(text).toBe("What do you want to build?");
});
