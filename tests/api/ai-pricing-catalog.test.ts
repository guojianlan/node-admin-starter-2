import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "@/server/app";
import { sqlite } from "@/server/db";
import { getAdminTestPassword } from "../helpers/auth";
import { resetTestDatabase } from "../helpers/db";

type ApiResponse<T = unknown> = {
  success: boolean;
  msg: string;
  data?: T;
};

async function readJson<T = unknown>(response: Response) {
  return (await response.json()) as ApiResponse<T>;
}

async function login() {
  const response = await app.request("/api/system/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: getAdminTestPassword() }),
  });
  return String((await readJson<{ token: string }>(response)).data?.token ?? "");
}

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

function catalogFixture() {
  return Object.fromEntries([
    [
      "sample_spec",
      {
        litellm_provider: "openai",
        input_cost_per_token: 1e-6,
        output_cost_per_token: 2e-6,
      },
    ],
    ...(Array.from({ length: 120 }, (_, index) => {
      const modelId = index === 0 ? "gpt-catalog-test" : `gpt-catalog-${index}`;
      return [
        modelId,
        {
          litellm_provider: "openai",
          mode: "chat",
          input_cost_per_token: index === 0 ? 2.5e-6 : 1e-6,
          cache_read_input_token_cost: index === 0 ? 0.25e-6 : 0.1e-6,
          cache_creation_input_token_cost: index === 0 ? 3.125e-6 : 1.25e-6,
          output_cost_per_token: index === 0 ? 15e-6 : 5e-6,
          max_input_tokens: index === 0 ? 400000 : 128000,
          max_output_tokens: index === 0 ? 128000 : 16384,
        },
      ];
    }) as Array<[string, Record<string, unknown>]>),
  ]);
}

async function createModel(token: string) {
  const providerResponse = await app.request("/api/system/ai/provider", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      name: "Pricing OpenAI",
      code: "pricing-openai",
      providerType: "openai",
      baseUrl: "https://api.openai.test/v1",
      apiKey: "pricing-secret",
      status: 1,
    }),
  });
  expect(providerResponse.status).toBe(200);
  const provider = (await sqlite
    .prepare("SELECT id FROM sys_ai_provider WHERE code = ? AND deleted_at IS NULL")
    .get("pricing-openai")) as { id: number };
  const modelResponse = await app.request("/api/system/ai/model", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      providerId: provider.id,
      name: "Catalog Test",
      modelId: "gpt-catalog-test",
      modelType: "chat",
      inputPrice: "1",
      outputPrice: "6",
      currency: "USD",
      status: 1,
    }),
  });
  expect(modelResponse.status).toBe(200);
  return (await sqlite
    .prepare("SELECT id FROM sys_ai_model WHERE model_id = ? AND deleted_at IS NULL")
    .get("gpt-catalog-test")) as { id: number };
}

describe("AI pricing catalog", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetTestDatabase();
  }, 120000);

  it("refreshes a validated catalog, keeps a last-known-good snapshot and is hash-idempotent", async () => {
    const token = await login();
    const unauthorized = await app.request("/api/system/ai/pricing/catalog/status");
    expect(unauthorized.status).toBe(401);

    const initial = await readJson<{ ready: boolean }>(
      await app.request("/api/system/ai/pricing/catalog/status", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(initial.data?.ready).toBe(false);

    const body = JSON.stringify(catalogFixture());
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(body, {
            status: 200,
            headers: { "content-type": "application/json", "content-length": String(body.length) },
          }),
      ),
    );
    const first = await readJson<{ changed: boolean; modelCount: number; sourceHash: string }>(
      await app.request("/api/system/ai/pricing/catalog/refresh", {
        method: "POST",
        headers: authHeaders(token),
      }),
    );
    expect(first.data).toMatchObject({ changed: true, modelCount: 120 });
    expect(first.data?.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    const sampleCount = (await sqlite
      .prepare(
        "SELECT COUNT(1)::int AS total FROM sys_ai_pricing_catalog_item WHERE catalog_key = ?",
      )
      .get("sample_spec")) as { total: number };
    expect(sampleCount.total).toBe(0);

    const second = await readJson<{ changed: boolean; snapshotId: number }>(
      await app.request("/api/system/ai/pricing/catalog/refresh", {
        method: "POST",
        headers: authHeaders(token),
      }),
    );
    expect(second.data?.changed).toBe(false);
    const snapshotCount = (await sqlite
      .prepare("SELECT COUNT(1)::int AS total FROM sys_ai_pricing_catalog_snapshot")
      .get()) as { total: number };
    expect(snapshotCount.total).toBe(1);

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ broken: { input_cost_per_token: 1e-6 } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const rejected = await app.request("/api/system/ai/pricing/catalog/refresh", {
      method: "POST",
      headers: authHeaders(token),
    });
    expect(rejected.status).toBe(502);
    const retained = (await sqlite
      .prepare("SELECT COUNT(1)::int AS total FROM sys_ai_pricing_catalog_snapshot")
      .get()) as { total: number };
    expect(retained.total).toBe(1);

    const operation = (await sqlite
      .prepare(
        `SELECT success, risk_level AS "riskLevel" FROM sys_operation_log
         WHERE module = 'system.aiModel' AND action = 'refreshPricingCatalog'
         ORDER BY id DESC LIMIT 1`,
      )
      .get()) as { success: boolean; riskLevel: string };
    expect(operation).toEqual({ success: false, riskLevel: "medium" });
  });

  it("previews exact provider-model matches, applies selected fields and resets provenance on manual edits", async () => {
    const token = await login();
    const model = await createModel(token);
    const body = JSON.stringify(catalogFixture());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 })),
    );
    expect(
      (
        await app.request("/api/system/ai/pricing/catalog/refresh", {
          method: "POST",
          headers: authHeaders(token),
        })
      ).status,
    ).toBe(200);

    const preview = await readJson<{
      candidates: Array<{
        id: number;
        catalogKey: string;
        inputPrice: string;
        diff: Record<string, { changed: boolean }>;
      }>;
    }>(
      await app.request(`/api/system/ai/model/${model.id}/pricing/preview`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(preview.data?.candidates).toHaveLength(1);
    expect(preview.data?.candidates[0]).toMatchObject({
      catalogKey: "gpt-catalog-test",
      inputPrice: "2.5",
    });
    expect(preview.data?.candidates[0].diff.inputPrice.changed).toBe(true);

    const apply = await app.request(`/api/system/ai/model/${model.id}/pricing/apply`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({
        catalogItemId: preview.data?.candidates[0].id,
        fields: ["inputPrice", "cachedInputPrice", "outputPrice", "contextWindow"],
      }),
    });
    expect(apply.status).toBe(200);
    const applied = (await sqlite
      .prepare(
        `SELECT input_price AS "inputPrice", cached_input_price AS "cachedInputPrice",
                cache_write_price AS "cacheWritePrice", output_price AS "outputPrice",
                context_window AS "contextWindow", pricing_source_type AS "pricingSourceType",
                pricing_catalog_key AS "pricingCatalogKey", pricing_source_hash AS "pricingSourceHash",
                pricing_synced_at AS "pricingSyncedAt"
         FROM sys_ai_model WHERE id = ?`,
      )
      .get(model.id)) as Record<string, unknown>;
    expect(applied).toMatchObject({
      inputPrice: "2.5",
      cachedInputPrice: "0.25",
      cacheWritePrice: null,
      outputPrice: "15",
      contextWindow: 400000,
      pricingSourceType: "catalog",
      pricingCatalogKey: "gpt-catalog-test",
    });
    expect(applied.pricingSourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(applied.pricingSyncedAt).toBeTruthy();

    const applyOperation = (await sqlite
      .prepare(
        `SELECT success, risk_level AS "riskLevel" FROM sys_operation_log
         WHERE module = 'system.aiModel' AND action = 'applyCatalogPricing'
         ORDER BY id DESC LIMIT 1`,
      )
      .get()) as { success: boolean; riskLevel: string };
    expect(applyOperation).toEqual({ success: true, riskLevel: "high" });

    const manual = await app.request(`/api/system/ai/model/${model.id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ inputPrice: "3" }),
    });
    expect(manual.status).toBe(200);
    const manuallyUpdated = (await sqlite
      .prepare(
        `SELECT input_price AS "inputPrice", pricing_source_type AS "pricingSourceType",
                pricing_catalog_key AS "pricingCatalogKey", pricing_source_hash AS "pricingSourceHash",
                pricing_synced_at AS "pricingSyncedAt"
         FROM sys_ai_model WHERE id = ?`,
      )
      .get(model.id)) as Record<string, unknown>;
    expect(manuallyUpdated).toEqual({
      inputPrice: "3",
      pricingSourceType: "manual",
      pricingCatalogKey: null,
      pricingSourceHash: null,
      pricingSyncedAt: null,
    });
  });
});
