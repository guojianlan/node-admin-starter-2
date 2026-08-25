import { expect, test, type Page } from "@playwright/test";
import type { Locator } from "@playwright/test";

async function setLocatorInput(input: Locator, value: string) {
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

async function setInput(page: Page, selector: string, value: string) {
  await setLocatorInput(page.locator(selector), value);
}

async function login(page: Page, username = "admin", password = "123456") {
  await page.goto("/login");
  await page.locator('button[type="submit"]').waitFor();
  await setInput(page, "#username", username);
  await setInput(page, "#password", password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/dashboard");
}

async function gotoAdminPage(page: Page, path: string, heading: string) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto(path);
    const headingLocator = page.getByRole("heading", { name: heading });
    try {
      await expect(headingLocator).toBeVisible();
      return;
    } catch (error) {
      const stillLoading = await page
        .getByText("加载后台权限...")
        .isVisible()
        .catch(() => false);
      if (!stillLoading || attempt === 1) throw error;
    }
  }
}

async function openSearchForm(page: Page) {
  const form = page.locator(".admin-search-form").first();
  if (await form.isVisible().catch(() => false)) return form;
  await page.locator(".admin-search-toggle").first().click();
  await expect(form).toBeVisible();
  return form;
}

async function confirmModal(page: Page) {
  await page
    .locator(".ant-modal")
    .getByRole("button", { name: /确\s*定|OK/ })
    .click();
}

async function clickFirstTableAction(page: Page, name: string) {
  const button = page.getByRole("button", { name }).first();
  if ((page.viewportSize()?.width ?? 0) < 768) {
    await page
      .locator(".admin-table-wrapper .ant-table-content, .admin-table-wrapper .ant-table-body")
      .first()
      .evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
  }
  await button.click();
}

async function getSearchSelectText(page: Page, label: string) {
  return page.locator(".admin-search-form").evaluate((root, labelText) => {
    const item = Array.from(root.querySelectorAll(".ant-form-item")).find(
      (element) => element.querySelector("label")?.textContent?.trim() === labelText,
    );
    const selectedText = item?.querySelector(".ant-select-selection-item")?.textContent?.trim();
    if (selectedText) return selectedText;
    const text = item?.textContent?.replace(/\s+/g, "").trim() ?? "";
    return text.startsWith(labelText) ? text.slice(labelText.length) : text;
  }, label);
}

test("login, search URL state, refresh, back and reset", async ({ page }) => {
  await login(page);
  await gotoAdminPage(page, "/system/user", "用户列表");

  await page.getByPlaceholder("搜索表格内容").fill("admin");
  await page.getByPlaceholder("搜索表格内容").press("Enter");
  await expect(page).toHaveURL(/keyword=admin/);
  await expect(page.getByText("admin@xinadmin.test")).toBeVisible();

  await page.reload();
  await expect(page.getByPlaceholder("搜索表格内容")).toHaveValue("admin");
  await expect(page.getByText("admin@xinadmin.test")).toBeVisible();

  await page.getByPlaceholder("搜索表格内容").fill("");
  await page.getByPlaceholder("搜索表格内容").press("Enter");
  await expect(page).not.toHaveURL(/keyword=admin/);

  await page.goBack();
  await expect(page).toHaveURL(/keyword=admin/);
  await expect(page.getByPlaceholder("搜索表格内容")).toHaveValue("admin");
});

test("user form validation and created user appears in list", async ({ page, request }) => {
  await login(page);
  await gotoAdminPage(page, "/system/user", "用户列表");

  await page.getByTestId("admin-create-button").click();
  await expect(page.getByTestId("admin-entity-form")).toBeVisible();
  await confirmModal(page);
  await expect(page.getByText("请输入用户名")).toBeVisible();
  await page
    .locator(".ant-modal")
    .getByRole("button", { name: /取\s*消|Cancel/ })
    .click();

  const suffix = Date.now().toString().slice(-6);
  const token = await page.evaluate(() => window.localStorage.getItem("admin-base-token"));
  const createResponse = await request.post("/api/system/user", {
    headers: { authorization: `Bearer ${token}` },
    data: {
      username: `tester${suffix}`,
      password: "123456",
      nickname: `测试用户${suffix}`,
      sex: 0,
      deptId: 1,
      status: 1,
      roleIds: [],
    },
  });
  expect(createResponse.ok()).toBeTruthy();
  await page.getByPlaceholder("搜索表格内容").fill(`tester${suffix}`);
  await page.getByPlaceholder("搜索表格内容").press("Enter");
  await expect(page).toHaveURL(new RegExp(`keyword=tester${suffix}`));
  await expect(page.getByText(`tester${suffix}`)).toBeVisible();
});

test("system management edit forms preload existing data", async ({ page }) => {
  await login(page);

  await gotoAdminPage(page, "/system/user", "用户列表");
  await clickFirstTableAction(page, "编辑");
  await expect(page.getByTestId("admin-entity-form")).toBeVisible();
  await expect(page.locator(".ant-modal input#username")).toHaveValue("admin");
  await expect(page.locator(".ant-modal input#nickname")).toHaveValue("超级管理员");
  await page.keyboard.press("Escape");

  await gotoAdminPage(page, "/system/role", "角色管理");
  await clickFirstTableAction(page, "编辑");
  await expect(page.getByTestId("admin-entity-form")).toBeVisible();
  await expect(page.locator(".ant-modal input#name")).not.toHaveValue("");
  await expect(page.locator(".ant-modal input#code")).not.toHaveValue("");
  await page.keyboard.press("Escape");

  await gotoAdminPage(page, "/system/dict", "字典管理");
  await clickFirstTableAction(page, "编辑");
  await expect(page.getByTestId("admin-entity-form")).toBeVisible();
  await expect(page.locator(".ant-modal input#name")).toHaveValue("状态");
  await expect(page.locator(".ant-modal input#code")).toHaveValue("status");
  await page.keyboard.press("Escape");

  await gotoAdminPage(page, "/system/config", "系统配置");
  await page.locator(".system-menu-row").first().getByRole("button", { name: "编辑" }).click();
  await expect(page.getByTestId("admin-entity-form")).toBeVisible();
  await expect(page.locator(".ant-modal input#name")).toHaveValue("基础配置");
  await expect(page.locator(".ant-modal input#code")).toHaveValue("basic");
  await page.keyboard.press("Escape");

  await page.locator(".system-config-item").first().getByRole("button", { name: "编辑" }).click();
  await expect(page.getByTestId("admin-entity-form")).toBeVisible();
  await expect(page.locator(".ant-modal input#key")).toHaveValue("site_name");
  await expect(page.locator(".ant-modal input#title")).toHaveValue("站点名称");
});

test("URL select filters decode labels and apply numeric filters", async ({ page }) => {
  await login(page);

  await gotoAdminPage(page, "/system/user?sex=1", "用户列表");
  await openSearchForm(page);
  await expect.poll(() => getSearchSelectText(page, "性别")).toBe("男");
  const userRows = page.locator(".ant-table-tbody tr:not(.ant-table-measure-row)");
  await expect(userRows).toHaveCount(1);
  await expect(userRows.first().locator("td").nth(1)).toHaveText("demo");
  await expect(userRows.first().locator("td").nth(3)).toHaveText("男");

  await gotoAdminPage(page, "/system/role?status=1", "角色管理");
  await openSearchForm(page);
  await expect.poll(() => getSearchSelectText(page, "状态")).toBe("启用");

  await gotoAdminPage(page, "/system/dict?status=1", "字典管理");
  await openSearchForm(page);
  await expect.poll(() => getSearchSelectText(page, "状态")).toBe("启用");
});

test("list search forms are collapsed by default and dict items stay on the dict page", async ({
  page,
}) => {
  await login(page);

  await gotoAdminPage(page, "/system/user", "用户列表");
  await expect(page.locator(".admin-search-form")).toHaveCount(0);
  const userSearchForm = await openSearchForm(page);
  await expect(userSearchForm.locator('label[for="sex"]')).toBeVisible();

  await gotoAdminPage(page, "/system/dict", "字典管理");
  await expect(page.locator(".admin-search-form")).toHaveCount(0);
  await openSearchForm(page);
  const dictRows = page.locator(".ant-table-tbody tr:not(.ant-table-measure-row)");
  await expect(dictRows).not.toHaveCount(0);
  await dictRows.first().click();
  await expect(page).toHaveURL(/\/system\/dict\?[^#]*dictId=1/);
  await expect(page).not.toHaveURL(/\/system\/dict\/item/);
  await expect(page.locator(".system-dict-title").getByText("status")).toBeVisible();
  const itemRows = page
    .locator(".ant-table")
    .last()
    .locator(".ant-table-tbody tr:not(.ant-table-measure-row)");
  await expect(itemRows).toHaveCount(2);
  await expect(itemRows.first()).toContainText("启用");
});

test("unauthorized user only sees permitted shell and no system menu", async ({
  page,
  request,
}) => {
  const loginResponse = await request.post("/api/system/login", {
    data: { username: "admin", password: "123456" },
  });
  const loginBody = await loginResponse.json();
  const token = loginBody.data.token as string;
  const suffix = Date.now().toString().slice(-6);
  const username = `viewer${suffix}`;

  await request.post("/api/system/user", {
    headers: { authorization: `Bearer ${token}` },
    data: {
      username,
      password: "123456",
      nickname: "无权限用户",
      sex: 0,
      deptId: 1,
      status: 1,
      roleIds: [],
    },
  });

  await login(page, username, "123456");
  await expect(page.locator(".dashboard-page")).toBeVisible();
  await expect(page.getByText("系统管理")).not.toBeVisible();

  await page.goto("/system/user");
  await expect(page.getByText("403")).toBeVisible();
});
