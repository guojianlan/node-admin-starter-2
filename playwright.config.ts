import { defineConfig, devices } from "@playwright/test";

const e2eDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://admin_base:admin_base@localhost:5432/admin_base_test";
const e2eDatabaseName = new URL(e2eDatabaseUrl).pathname.replace(/^\//, "");
const e2ePort = 3101;

if (!/_test$/.test(e2eDatabaseName)) {
  throw new Error(`Playwright requires an isolated *_test database, received ${e2eDatabaseName}`);
}

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  workers: 1,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${e2ePort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `pnpm db:reset && pnpm exec next dev -H 0.0.0.0 -p ${e2ePort}`,
    url: `http://127.0.0.1:${e2ePort}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: e2eDatabaseUrl,
      ADMIN_BASE_ALLOW_DB_RESET: "true",
      ADMIN_BASE_RESET_DATABASE_NAME: e2eDatabaseName,
      ADMIN_BASE_SECRET_KEY: "playwright-admin-base-secret",
      ADMIN_BASE_ADMIN_PASSWORD: "123456",
      LOG_LEVEL: "silent",
    },
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 960 } },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 5"] },
    },
  ],
});
