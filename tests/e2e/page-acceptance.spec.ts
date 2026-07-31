import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pageTestCases } from "../coverage/page-test-cases";

type AcceptanceRoute = {
  path: string;
};

const adminRoutes: AcceptanceRoute[] = pageTestCases
  .filter((item) => item.path !== "/" && item.path !== "/login")
  .map((item) => ({ path: item.path }));

function slug(path: string) {
  return path === "/" ? "root" : path.replace(/^\//, "").replaceAll("/", "-");
}

async function captureEvidence(page: Page, testInfo: TestInfo, evidenceName: string) {
  const directory = path.join(
    process.cwd(),
    "test-results",
    "acceptance-evidence",
    testInfo.project.name,
  );
  await mkdir(directory, { recursive: true });
  const screenshotPath = path.join(directory, `${evidenceName}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await testInfo.attach(`${evidenceName}.png`, {
    path: screenshotPath,
    contentType: "image/png",
  });
}

async function setInput(page: Page, selector: string, value: string) {
  const input = page.locator(selector);
  await input.evaluate((element, nextValue) => {
    const inputElement = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(inputElement, "");
    inputElement.dispatchEvent(new Event("input", { bubbles: true }));
    inputElement.dispatchEvent(new Event("change", { bubbles: true }));
    setter?.call(inputElement, nextValue);
    inputElement.dispatchEvent(new Event("input", { bubbles: true }));
    inputElement.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await expect(input).toHaveValue(value);
}

async function login(page: Page) {
  await page.goto("/login");
  await setInput(page, "#username", "admin");
  await setInput(page, "#password", "123456");
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/);
}

async function setPreferences(
  page: Page,
  preferences: { themeMode: "light" | "dark"; layoutMode: "side" | "top" | "mix" | "columns" },
) {
  await page.addInitScript((value) => {
    window.localStorage.setItem(
      "admin-base-preferences",
      JSON.stringify({ ...value, locale: "zh-CN" }),
    );
  }, preferences);
}

async function assertRoute(
  page: Page,
  testInfo: TestInfo,
  route: AcceptanceRoute,
  evidenceName: string,
) {
  const failedResponses: string[] = [];
  const pageErrors: string[] = [];
  const responseListener = (response: { status: () => number; url: () => string }) => {
    if (response.status() >= 500 && response.url().includes("/api/")) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  };
  const errorListener = (error: Error) => pageErrors.push(error.message);
  page.on("response", responseListener);
  page.on("pageerror", errorListener);

  await page.goto(route.path);
  await expect(page.locator("main")).toBeVisible();
  if (route.path === "/dashboard") {
    await expect(page.getByText("今日登录成功", { exact: true })).toBeVisible();
  } else {
    await expect(page.locator("main h1").first()).toBeVisible();
  }
  await expect(page.getByText("403", { exact: true })).not.toBeVisible();
  await expect(page.getByText(/Application error|Internal Server Error/i)).not.toBeVisible();

  const documentOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(documentOverflow, `${route.path} must not overflow the page viewport`).toBeLessThanOrEqual(2);
  expect(pageErrors, `${route.path} emitted browser page errors`).toEqual([]);
  expect(failedResponses, `${route.path} returned failing API responses`).toEqual([]);

  await captureEvidence(page, testInfo, evidenceName);
  page.off("response", responseListener);
  page.off("pageerror", errorListener);
}

test("anonymous root redirects to the login page", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Admin Base" })).toBeVisible();
  await captureEvidence(page, testInfo, "login-root");
});

for (const route of adminRoutes) {
  test(`light route acceptance ${route.path}`, async ({ page }, testInfo) => {
    await setPreferences(page, { themeMode: "light", layoutMode: "side" });
    await login(page);
    await assertRoute(page, testInfo, route, `light-${slug(route.path)}`);
  });

  test(`dark route acceptance ${route.path}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "Dark route sweep runs on desktop");
    await setPreferences(page, { themeMode: "dark", layoutMode: "side" });
    await login(page);
    await assertRoute(page, testInfo, route, `dark-${slug(route.path)}`);
    await expect(page.locator("html")).toHaveAttribute("data-admin-theme", "dark");
  });
}

for (const layoutMode of ["top", "mix", "columns"] as const) {
  test(`${layoutMode} layout keeps system page reachable`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "Layout sweep runs on desktop");
    await setPreferences(page, { themeMode: "light", layoutMode });
    await login(page);
    await assertRoute(
      page,
      testInfo,
      { path: "/system/user" },
      `layout-${layoutMode}`,
    );
    await expect(page.locator("html")).toHaveAttribute("data-admin-layout", layoutMode);
  });
}
