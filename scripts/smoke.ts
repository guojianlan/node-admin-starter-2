import "../src/server/load-dotenv";

type ApiResponse<T = unknown> = {
  success: boolean;
  data?: T;
  msg?: string;
};

const baseUrl = (process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const username = process.env.SMOKE_USERNAME || "admin";
const password = process.env.SMOKE_PASSWORD || process.env.ADMIN_BASE_ADMIN_PASSWORD || "123456";

async function check(name: string, run: () => Promise<void>) {
  try {
    await run();
    console.log(`[OK] ${name}`);
  } catch (error) {
    console.error(`[FAIL] ${name}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

async function expectOk(path: string) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
}

await check("login page", () => expectOk("/login"));
await check("health api", () => expectOk("/api/health"));
await check("ready api", async () => {
  const response = await fetch(`${baseUrl}/api/ready`);
  if (![200, 503].includes(response.status)) {
    throw new Error(`/api/ready returned ${response.status}`);
  }
});

let token = "";
await check("login api", async () => {
  const response = await fetch(`${baseUrl}/api/system/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = (await response.json()) as ApiResponse<{ token: string }>;
  if (!response.ok || !body.success || !body.data?.token) {
    throw new Error(body.msg || `login returned ${response.status}`);
  }
  token = body.data.token;
});

await check("authenticated info", async () => {
  const response = await fetch(`${baseUrl}/api/system/info`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`/api/system/info returned ${response.status}`);
});

for (const path of ["/dashboard", "/system/user", "/system/notice"]) {
  await check(`page ${path}`, () => expectOk(path));
}

console.log(`Smoke checks passed for ${baseUrl}`);
