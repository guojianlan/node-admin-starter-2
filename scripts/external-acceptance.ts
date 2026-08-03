import { chromium } from "@playwright/test";

try {
  process.loadEnvFile?.(".env");
} catch {
  // CI and explicitly configured shells may not have a local .env file.
}

type ApiEnvelope<T> = {
  success: boolean;
  msg: string;
  data?: T;
};

type PageResult<T> = {
  data: T[];
  total: number;
};

type ResourceRow = {
  id: number;
  code?: string;
  key?: string;
  isDefault?: boolean;
  isSystem?: boolean;
};

const appBaseUrl = (process.env.ACCEPTANCE_APP_BASE_URL || "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);
const minioBaseUrl = "http://127.0.0.1:19000";
const mailpitBaseUrl = "http://127.0.0.1:18025";
const keycloakBaseUrl = "http://127.0.0.1:18080";
const mockBaseUrl = "http://127.0.0.1:18081";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function waitFor(url: string, label: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`${label} 未就绪：${lastError}`);
}

async function rawApi(path: string, init: RequestInit = {}, token?: string) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData))
    headers.set("content-type", "application/json");
  return fetch(`${appBaseUrl}${path}`, { ...init, headers });
}

async function api<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const response = await rawApi(path, init, token);
  const text = await response.text();
  let body: ApiEnvelope<T>;
  try {
    body = JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    throw new Error(`${init.method || "GET"} ${path} 返回非 JSON：${response.status} ${text}`);
  }
  if (!response.ok || !body.success) {
    throw new Error(`${init.method || "GET"} ${path} 失败：${response.status} ${body.msg}`);
  }
  return body.data as T;
}

async function login() {
  const password = process.env.ADMIN_BASE_ADMIN_PASSWORD || "123456";
  const options = await api<{ captchaEnabled: boolean }>("/api/system/login/options");
  let captchaPayload: Record<string, string> = {};
  if (options.captchaEnabled) {
    const captcha = await api<{ captchaId: string; debugCode?: string }>(
      "/api/system/login/captcha",
    );
    assert(captcha.debugCode, "本地验收启用了验证码，但接口未返回 debugCode");
    captchaPayload = { captchaId: captcha.captchaId, captchaCode: captcha.debugCode };
  }
  const result = await api<{ token: string }>("/api/system/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password, ...captchaPayload }),
  });
  assert(result.token, "管理员登录未返回 token");
  return result.token;
}

async function list<T extends ResourceRow>(path: string, token: string) {
  return api<PageResult<T>>(`${path}?page=1&pageSize=200`, {}, token);
}

async function findByCode<T extends ResourceRow>(path: string, code: string, token: string) {
  const result = await list<T>(path, token);
  return result.data.find((item) => item.code === code || item.key === code);
}

async function removeResource(path: string, id: number, token: string) {
  await api(`${path}/${id}`, { method: "DELETE" }, token);
}

async function resetMockRequests() {
  const response = await fetch(`${mockBaseUrl}/__admin/reset`, { method: "POST" });
  assert(response.ok, "外部 Mock 请求记录清理失败");
}

async function acceptS3(token: string) {
  await waitFor(`${minioBaseUrl}/minio/health/live`, "MinIO");
  const path = "/api/system/storage";
  const code = "acceptance-minio";
  const rows = await list<ResourceRow>(path, token);
  const originalDefault = rows.data.find((item) => item.isDefault);
  assert(originalDefault, "没有可恢复的默认存储");
  let storage = await findByCode<ResourceRow>(path, code, token);
  let fileId: number | null = null;

  try {
    if (storage?.isDefault) {
      await api(`/api/system/storage/default/${originalDefault.id}`, { method: "PUT" }, token);
    }
    if (storage && !storage.isSystem) await removeResource(path, storage.id, token);
    await api(
      path,
      {
        method: "POST",
        body: JSON.stringify({
          name: "MinIO 本地验收",
          code,
          type: "s3",
          endpoint: minioBaseUrl,
          region: "us-east-1",
          bucket: "admin-base-acceptance",
          accessKey: "admin-base-minio",
          secretKey: "admin-base-minio-secret",
          baseUrl: `${minioBaseUrl}/admin-base-acceptance`,
          status: 1,
          sort: 999,
        }),
      },
      token,
    );
    storage = await findByCode<ResourceRow>(path, code, token);
    assert(storage, "MinIO 存储创建后未找到");
    await api(
      "/api/system/storage/test",
      {
        method: "POST",
        body: JSON.stringify({ id: storage.id }),
      },
      token,
    );
    await api(`/api/system/storage/default/${storage.id}`, { method: "PUT" }, token);

    const marker = `Admin Base MinIO acceptance ${Date.now()}`;
    const form = new FormData();
    form.append(
      "file",
      new File([marker], `minio-acceptance-${Date.now()}.txt`, { type: "text/plain" }),
    );
    const upload = await api<{ id: number }>(
      "/api/system/file/list/upload",
      { method: "POST", body: form },
      token,
    );
    fileId = upload.id;
    const download = await rawApi(`/api/system/file/list/download/${fileId}`, {}, token);
    assert(download.ok, `MinIO 文件下载失败：${download.status}`);
    assert((await download.text()) === marker, "MinIO 下载内容与上传内容不一致");
    process.stdout.write("[S3] PASS MinIO 连接、上传、下载和内容校验\n");
  } finally {
    if (fileId) {
      await api(`/api/system/file/list/force/${fileId}`, { method: "DELETE" }, token).catch(
        () => {},
      );
    }
    await api(`/api/system/storage/default/${originalDefault.id}`, { method: "PUT" }, token).catch(
      () => {},
    );
    if (storage && !storage.isSystem) await removeResource(path, storage.id, token).catch(() => {});
  }
}

async function acceptSmtp(token: string) {
  await waitFor(`${mailpitBaseUrl}/api/v1/info`, "Mailpit");
  const path = "/api/system/mail/account";
  const code = "acceptance-mailpit";
  let account = await findByCode<ResourceRow>(path, code, token);
  try {
    if (account && !account.isSystem) await removeResource(path, account.id, token);
    await api(
      path,
      {
        method: "POST",
        body: JSON.stringify({
          name: "Mailpit 本地验收",
          code,
          host: "127.0.0.1",
          port: 11025,
          secure: false,
          username: null,
          password: null,
          fromName: "Admin Base",
          fromEmail: "admin-base@local.test",
          status: 1,
          sort: 999,
        }),
      },
      token,
    );
    account = await findByCode<ResourceRow>(path, code, token);
    assert(account, "Mailpit 邮件账号创建后未找到");
    const subject = `Admin Base SMTP acceptance ${Date.now()}`;
    await api(
      "/api/system/mail/account/test",
      {
        method: "POST",
        body: JSON.stringify({
          id: account.id,
          to: "acceptance@local.test",
          subject,
          text: "Mailpit local acceptance OK",
        }),
      },
      token,
    );
    const response = await fetch(`${mailpitBaseUrl}/api/v1/messages`);
    const messages = (await response.json()) as { messages?: Array<{ Subject?: string }> };
    assert(
      messages.messages?.some((message) => message.Subject === subject),
      "Mailpit 未收到测试邮件",
    );
    process.stdout.write("[SMTP] PASS Mailpit 连接、发送和收件箱校验\n");
  } finally {
    if (account && !account.isSystem) await removeResource(path, account.id, token).catch(() => {});
  }
}

async function acceptSms(token: string) {
  await waitFor(`${mockBaseUrl}/health`, "External Mock");
  await resetMockRequests();
  const path = "/api/system/sms/provider";
  const code = "acceptance-sms";
  let provider = await findByCode<ResourceRow>(path, code, token);
  try {
    if (provider && !provider.isSystem) await removeResource(path, provider.id, token);
    await api(
      path,
      {
        method: "POST",
        body: JSON.stringify({
          name: "SMS Webhook 本地验收",
          code,
          provider: "webhook",
          endpoint: `${mockBaseUrl}/sms/send`,
          accessKey: "acceptance-sms-access",
          secretKey: "acceptance-sms-secret",
          signature: "Admin Base",
          templateCode: "LOCAL_ACCEPTANCE",
          status: 1,
          sort: 999,
        }),
      },
      token,
    );
    provider = await findByCode<ResourceRow>(path, code, token);
    assert(provider, "SMS Provider 创建后未找到");
    await api(
      "/api/system/sms/provider/test",
      {
        method: "POST",
        body: JSON.stringify({
          id: provider.id,
          to: "13800000000",
          content: "Admin Base SMS acceptance OK",
          variables: { code: "123456" },
        }),
      },
      token,
    );
    const response = await fetch(`${mockBaseUrl}/__admin/requests?kind=sms`);
    const result = (await response.json()) as {
      requests?: Array<{ body?: { to?: string; content?: string } }>;
    };
    const received = result.requests?.at(-1)?.body;
    assert(received?.to === "13800000000", "SMS Mock 收件号码不正确");
    assert(received?.content === "Admin Base SMS acceptance OK", "SMS Mock 内容不正确");
    process.stdout.write("[SMS] PASS Webhook 鉴权、发送和请求内容校验\n");
  } finally {
    if (provider && !provider.isSystem)
      await removeResource(path, provider.id, token).catch(() => {});
  }
}

async function acceptAi(token: string) {
  await waitFor(`${mockBaseUrl}/health`, "External Mock");
  await resetMockRequests();
  const providerPath = "/api/system/ai/provider";
  const providerCode = "acceptance-ai";
  let provider = await findByCode<ResourceRow>(providerPath, providerCode, token);
  let model: ResourceRow | undefined;
  try {
    if (provider && !provider.isSystem) await removeResource(providerPath, provider.id, token);
    await api(
      providerPath,
      {
        method: "POST",
        body: JSON.stringify({
          name: "OpenAI-compatible 本地验收",
          code: providerCode,
          providerType: "openai-compatible",
          baseUrl: `${mockBaseUrl}/v1`,
          apiKey: "acceptance-ai-key",
          status: 1,
          sort: 999,
        }),
      },
      token,
    );
    provider = await findByCode<ResourceRow>(providerPath, providerCode, token);
    assert(provider, "AI Provider 创建后未找到");

    for (const payload of [
      { id: provider.id, mode: "listModels" },
      { id: provider.id, mode: "chat", modelId: "mock-chat", input: "reply OK" },
      { id: provider.id, mode: "embedding", modelId: "mock-embedding", input: "embed OK" },
    ]) {
      await api(
        "/api/system/ai/provider/test",
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
        token,
      );
    }
    const providerStream = await rawApi(
      "/api/system/ai/provider/test/stream",
      {
        method: "POST",
        body: JSON.stringify({
          id: provider.id,
          mode: "chat",
          modelId: "mock-chat",
          input: "stream OK",
          maxOutputTokens: 256,
          timeoutMs: 30_000,
        }),
      },
      token,
    );
    const providerStreamText = await providerStream.text();
    assert(providerStream.ok, `AI Provider 流式测试失败：${providerStream.status}`);
    assert(providerStreamText.includes("Local acceptance stream OK"), "AI Provider 流内容不正确");

    await api(
      "/api/system/ai/model",
      {
        method: "POST",
        body: JSON.stringify({
          providerId: provider.id,
          name: "Local Mock Chat",
          modelId: "mock-chat",
          modelType: "chat",
          capabilitiesJson: JSON.stringify({ stream: true }),
          contextWindow: 32_768,
          maxOutputTokens: 4_096,
          currency: "USD",
          status: 1,
          sort: 999,
        }),
      },
      token,
    );
    const models = await api<PageResult<ResourceRow & { modelId?: string; providerId?: number }>>(
      `/api/system/ai/model?page=1&pageSize=200&providerId=${provider.id}`,
      {},
      token,
    );
    model = models.data.find((item) => item.modelId === "mock-chat");
    assert(model, "AI 模型创建后未找到");
    const modelStream = await rawApi(
      "/api/system/ai/model/test/stream",
      {
        method: "POST",
        body: JSON.stringify({
          id: model.id,
          input: "model stream OK",
          maxOutputTokens: 256,
          timeoutMs: 30_000,
        }),
      },
      token,
    );
    const modelStreamText = await modelStream.text();
    assert(modelStream.ok, `AI 模型流式测试失败：${modelStream.status}`);
    assert(modelStreamText.includes("Local acceptance stream OK"), "AI 模型流内容不正确");
    process.stdout.write("[AI] PASS 模型列表、Chat、Embedding、Provider/模型流式调用\n");
  } finally {
    if (model) await removeResource("/api/system/ai/model", model.id, token).catch(() => {});
    if (provider && !provider.isSystem) {
      await removeResource(providerPath, provider.id, token).catch(() => {});
    }
  }
}

async function acceptOauth(token: string) {
  await waitFor(
    `${keycloakBaseUrl}/realms/admin-base/.well-known/openid-configuration`,
    "Keycloak",
    180_000,
  );
  const path = "/api/system/oauth/provider";
  const key = "keycloak-local";
  let provider = await findByCode<ResourceRow>(path, key, token);
  const browser = await chromium.launch({ headless: true });
  try {
    await api(`/api/system/profile/oauth/${key}/unbind`, { method: "DELETE" }, token).catch(
      () => {},
    );
    if (provider && !provider.isSystem) await removeResource(path, provider.id, token);
    await api(
      path,
      {
        method: "POST",
        body: JSON.stringify({
          key,
          name: "Keycloak 本地验收",
          enabled: true,
          authUrl: `${keycloakBaseUrl}/realms/admin-base/protocol/openid-connect/auth`,
          tokenUrl: `${keycloakBaseUrl}/realms/admin-base/protocol/openid-connect/token`,
          userInfoUrl: `${keycloakBaseUrl}/realms/admin-base/protocol/openid-connect/userinfo`,
          clientId: "admin-base-local",
          clientSecret: "admin-base-local-secret",
          scopes: ["openid", "profile", "email"],
          userMapping: {
            id: "sub",
            username: "preferred_username",
            email: "email",
            nickname: "name",
          },
          autoCreateUser: false,
          status: 1,
          sort: 999,
        }),
      },
      token,
    );
    provider = await findByCode<ResourceRow>(path, key, token);
    assert(provider, "Keycloak OAuth Provider 创建后未找到");
    await api(
      "/api/system/oauth/provider/test",
      {
        method: "POST",
        body: JSON.stringify({ id: provider.id }),
      },
      token,
    );

    const page = await browser.newPage();
    const oauthTokenPromise = new Promise<string>((resolve) => {
      page.on("response", async (response) => {
        if (!response.url().includes(`/api/system/oauth/${key}/callback`)) return;
        const location = await response.headerValue("location");
        if (!location) return;
        const oauthToken = new URL(location, appBaseUrl).searchParams.get("oauthToken");
        if (oauthToken) resolve(oauthToken);
      });
    });
    await page.goto(`${appBaseUrl}/api/system/oauth/${key}/redirect`);
    await page.locator("#username").fill("admin-local-oauth");
    await page.locator("#password").fill("local-oauth-password");
    await page.locator("#kc-login").click();
    const oauthToken = await Promise.race([
      oauthTokenPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("OAuth callback 未返回登录 token")), 30_000),
      ),
    ]);
    const info = await api<{ user: { username: string } }>("/api/system/info", {}, oauthToken);
    assert(info.user.username === "admin", "Keycloak 邮箱没有匹配到本地 admin 用户");
    await api(`/api/system/profile/oauth/${key}/unbind`, { method: "DELETE" }, oauthToken);
    process.stdout.write("[OAuth] PASS Keycloak redirect、state、callback、用户匹配和解绑\n");
  } finally {
    await browser.close();
    await api(`/api/system/profile/oauth/${key}/unbind`, { method: "DELETE" }, token).catch(
      () => {},
    );
    if (provider && !provider.isSystem)
      await removeResource(path, provider.id, token).catch(() => {});
  }
}

const tasks: Record<string, (token: string) => Promise<void>> = {
  s3: acceptS3,
  smtp: acceptSmtp,
  oauth: acceptOauth,
  sms: acceptSms,
  ai: acceptAi,
};

async function main() {
  await waitFor(`${appBaseUrl}/api/health`, "Admin Base");
  const token = await login();
  const targets = process.argv.slice(2);
  const selected = targets.length ? targets : ["s3", "smtp", "oauth", "sms", "ai"];
  for (const target of selected) {
    const task = tasks[target];
    if (!task) throw new Error(`未知验收项：${target}`);
    await task(token);
  }
  process.stdout.write(`[External Acceptance] PASS ${selected.join(", ")}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
