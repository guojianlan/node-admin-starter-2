import crypto from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { domainToASCII } from "node:url";
import { HTTPException } from "hono/http-exception";
import { sqlite } from "@/server/db";
import { getAdminBaseEnv } from "@/server/env";
import { assertTenantAccess } from "./saas-control-plane-service";

export type SaaSTenantBrandingInput = {
  productName?: string | null;
  logoFileId?: number | null;
  primaryColor?: string | null;
  themeMode?: "light" | "dark" | "system";
  locale?: string;
  timezone?: string;
  emailFromName?: string | null;
  supportEmail?: string | null;
};

type DomainResolver = (hostname: string) => Promise<string[][]>;

function tokenHash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function normalizeTenantHostname(value: string) {
  const raw = value.trim().toLowerCase().replace(/\.$/, "");
  if (!raw || raw.includes("://") || raw.includes("/") || raw.includes(":")) {
    throw new HTTPException(400, { message: "自定义域名只能填写 hostname，不能包含协议、路径或端口" });
  }
  const hostname = domainToASCII(raw).toLowerCase();
  if (
    !hostname ||
    hostname.length > 253 ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    !hostname.includes(".") ||
    !hostname.split(".").every((label) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    )
  ) {
    throw new HTTPException(400, { message: "请输入有效的公网自定义域名" });
  }
  return hostname;
}

async function assertTenantBrandLogo(tenantId: number, logoFileId: number | null | undefined) {
  if (!logoFileId) return;
  const file = await sqlite
    .prepare(
      `SELECT binding.file_id AS "fileId"
       FROM saas_file_binding binding
       INNER JOIN sys_file file ON file.id = binding.file_id
       WHERE binding.tenant_id = ? AND binding.file_id = ? AND file.deleted_at IS NULL
       LIMIT 1`,
    )
    .get(tenantId, logoFileId);
  if (!file) throw new HTTPException(404, { message: "Tenant 品牌 Logo 文件不存在" });
}

async function platformBrandingDefaults() {
  const rows = (await sqlite
    .prepare(
      `SELECT key, "values" AS value FROM sys_config_items
       WHERE key IN ('site_name', 'site_logo') AND status = 1 AND deleted_at IS NULL`,
    )
    .all()) as Array<{ key: string; value: string }>;
  const values = new Map(rows.map((row) => [row.key, row.value]));
  return {
    productName: values.get("site_name") || "Admin Base",
    logoUrl: values.get("site_logo") || null,
  };
}

export async function getEffectiveTenantBranding(tenantId: number) {
  const platform = await platformBrandingDefaults();
  const branding = (await sqlite
    .prepare(
      `SELECT branding.id, branding.tenant_id AS "tenantId", branding.product_name AS "productName",
        branding.logo_file_id AS "logoFileId", branding.primary_color AS "primaryColor",
        branding.theme_mode AS "themeMode", branding.locale, branding.timezone,
        branding.email_from_name AS "emailFromName", branding.support_email AS "supportEmail",
        file.url AS "logoUrl", branding.updated_at AS "updatedAt"
       FROM saas_tenant_branding branding
       LEFT JOIN sys_file file ON file.id = branding.logo_file_id AND file.deleted_at IS NULL
       WHERE branding.tenant_id = ? LIMIT 1`,
    )
    .get(tenantId)) as
    | {
        id: number;
        tenantId: number;
        productName: string | null;
        logoFileId: number | null;
        primaryColor: string | null;
        themeMode: "light" | "dark" | "system";
        locale: string;
        timezone: string;
        emailFromName: string | null;
        supportEmail: string | null;
        logoUrl: string | null;
        updatedAt: string;
      }
    | undefined;
  return {
    tenantId,
    source: branding ? ("tenant" as const) : ("platform" as const),
    productName: branding?.productName || platform.productName,
    logoFileId: branding?.logoFileId ?? null,
    logoUrl: branding?.logoUrl || platform.logoUrl,
    primaryColor: branding?.primaryColor || "#1677ff",
    themeMode: branding?.themeMode || "system",
    locale: branding?.locale || "zh-CN",
    timezone: branding?.timezone || "Asia/Shanghai",
    emailFromName: branding?.emailFromName || branding?.productName || platform.productName,
    supportEmail: branding?.supportEmail || null,
    updatedAt: branding?.updatedAt ?? null,
  };
}

export async function getTenantBranding(input: { userId: number; tenantId: number }) {
  await assertTenantAccess({ userId: input.userId, tenantId: input.tenantId });
  return getEffectiveTenantBranding(input.tenantId);
}

export async function upsertTenantBranding(
  input: { userId: number; tenantId: number } & SaaSTenantBrandingInput,
) {
  await assertTenantAccess({
    userId: input.userId,
    tenantId: input.tenantId,
    roles: ["owner", "admin"],
  });
  await assertTenantBrandLogo(input.tenantId, input.logoFileId);
  await sqlite
    .prepare(
      `INSERT INTO saas_tenant_branding
        (tenant_id, product_name, logo_file_id, primary_color, theme_mode, locale, timezone,
         email_from_name, support_email, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id) DO UPDATE SET
         product_name = excluded.product_name,
         logo_file_id = excluded.logo_file_id,
         primary_color = excluded.primary_color,
         theme_mode = excluded.theme_mode,
         locale = excluded.locale,
         timezone = excluded.timezone,
         email_from_name = excluded.email_from_name,
         support_email = excluded.support_email,
         updated_by = excluded.updated_by,
         updated_at = now()` ,
    )
    .run(
      input.tenantId,
      input.productName?.trim() || null,
      input.logoFileId ?? null,
      input.primaryColor?.trim().toLowerCase() || null,
      input.themeMode ?? "system",
      input.locale?.trim() || "zh-CN",
      input.timezone?.trim() || "Asia/Shanghai",
      input.emailFromName?.trim() || null,
      input.supportEmail?.trim().toLowerCase() || null,
      input.userId,
      input.userId,
    );
  return getEffectiveTenantBranding(input.tenantId);
}

export async function listTenantDomains(input: { userId: number; tenantId: number }) {
  await assertTenantAccess({ userId: input.userId, tenantId: input.tenantId });
  return sqlite
    .prepare(
      `SELECT id, tenant_id AS "tenantId", hostname, status,
        verification_token_prefix AS "verificationTokenPrefix", challenge_name AS "challengeName",
        is_primary AS "isPrimary", certificate_status AS "certificateStatus",
        last_checked_at AS "lastCheckedAt", verified_at AS "verifiedAt", revoked_at AS "revokedAt",
        failure_reason AS "failureReason", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM saas_tenant_domain WHERE tenant_id = ? ORDER BY is_primary DESC, id DESC`,
    )
    .all(input.tenantId);
}

export async function createTenantDomain(input: {
  userId: number;
  tenantId: number;
  hostname: string;
  isPrimary?: boolean;
}) {
  await assertTenantAccess({
    userId: input.userId,
    tenantId: input.tenantId,
    roles: ["owner", "admin"],
  });
  const hostname = normalizeTenantHostname(input.hostname);
  const token = `sab-domain-${crypto.randomBytes(24).toString("base64url")}`;
  const challengeName = `_admin-base-verification.${hostname}`;
  const existing = (await sqlite
    .prepare("SELECT id, tenant_id AS \"tenantId\", status FROM saas_tenant_domain WHERE hostname = ?")
    .get(hostname)) as { id: number; tenantId: number; status: string } | undefined;
  if (existing && (existing.tenantId !== input.tenantId || existing.status !== "revoked")) {
    throw new HTTPException(409, { message: "该自定义域名已经登记" });
  }
  let id: number;
  if (existing) {
    await sqlite
      .prepare(
        `UPDATE saas_tenant_domain SET status = 'pending', verification_token_hash = ?,
          verification_token_prefix = ?, challenge_name = ?, is_primary = ?,
          certificate_status = 'not_requested', last_checked_at = NULL, verified_at = NULL,
          revoked_at = NULL, failure_reason = NULL, updated_by = ?, updated_at = now()
         WHERE id = ?`,
      )
      .run(tokenHash(token), token.slice(0, 16), challengeName, input.isPrimary ?? false, input.userId, existing.id);
    id = existing.id;
  } else {
    const result = await sqlite
      .prepare(
        `INSERT INTO saas_tenant_domain
          (tenant_id, hostname, verification_token_hash, verification_token_prefix,
           challenge_name, is_primary, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .run(
        input.tenantId,
        hostname,
        tokenHash(token),
        token.slice(0, 16),
        challengeName,
        input.isPrimary ?? false,
        input.userId,
        input.userId,
      );
    id = Number(result.lastInsertRowid);
  }
  return {
    id,
    hostname,
    challengeName,
    verificationValue: `admin-base-verification=${token}`,
    verificationToken: token,
  };
}

export async function verifyTenantDomain(input: {
  userId: number;
  tenantId: number;
  id: number;
  resolveTxt?: DomainResolver;
}) {
  await assertTenantAccess({
    userId: input.userId,
    tenantId: input.tenantId,
    roles: ["owner", "admin"],
  });
  const domain = (await sqlite
    .prepare(
      `SELECT id, hostname, status, verification_token_hash AS "verificationTokenHash",
        challenge_name AS "challengeName", is_primary AS "isPrimary"
       FROM saas_tenant_domain WHERE id = ? AND tenant_id = ?`,
    )
    .get(input.id, input.tenantId)) as
    | {
        id: number;
        hostname: string;
        status: string;
        verificationTokenHash: string;
        challengeName: string;
        isPrimary: boolean;
      }
    | undefined;
  if (!domain) throw new HTTPException(404, { message: "Tenant 自定义域名不存在" });
  if (domain.status === "revoked") {
    throw new HTTPException(409, { message: "已撤销域名需要重新登记后验证" });
  }
  let records: string[][] = [];
  try {
    records = await (input.resolveTxt ?? resolveTxt)(domain.challengeName);
  } catch {
    records = [];
  }
  const values = records.map((parts) => parts.join("").trim());
  const matched = values.some((value) => {
    if (!value.startsWith("admin-base-verification=")) return false;
    const token = value.slice("admin-base-verification=".length);
    return tokenHash(token) === domain.verificationTokenHash;
  });
  if (!matched) {
    await sqlite
      .prepare(
        `UPDATE saas_tenant_domain SET status = 'failed', last_checked_at = now(),
          failure_reason = 'DNS TXT challenge 不匹配', updated_by = ?, updated_at = now()
         WHERE id = ? AND tenant_id = ?`,
      )
      .run(input.userId, input.id, input.tenantId);
    throw new HTTPException(422, { message: "DNS TXT challenge 尚未生效或内容不匹配" });
  }
  await sqlite.transaction(async (tx) => {
    if (domain.isPrimary) {
      await tx
        .prepare(
          `UPDATE saas_tenant_domain SET is_primary = false, updated_at = now()
           WHERE tenant_id = ? AND id <> ?`,
        )
        .run(input.tenantId, input.id);
    }
    await tx
      .prepare(
        `UPDATE saas_tenant_domain SET status = 'verified', certificate_status = 'pending',
          last_checked_at = now(), verified_at = now(), revoked_at = NULL,
          failure_reason = NULL, updated_by = ?, updated_at = now()
         WHERE id = ? AND tenant_id = ?`,
      )
      .run(input.userId, input.id, input.tenantId);
  });
  return { id: input.id, hostname: domain.hostname, status: "verified" as const, certificateStatus: "pending" as const };
}

export async function revokeTenantDomain(input: { userId: number; tenantId: number; id: number }) {
  await assertTenantAccess({
    userId: input.userId,
    tenantId: input.tenantId,
    roles: ["owner", "admin"],
  });
  const updated = await sqlite
    .prepare(
      `UPDATE saas_tenant_domain SET status = 'revoked', is_primary = false,
        certificate_status = 'not_requested', revoked_at = now(), updated_by = ?, updated_at = now()
       WHERE id = ? AND tenant_id = ? AND status <> 'revoked' RETURNING id`,
    )
    .get(input.userId, input.id, input.tenantId);
  if (!updated) throw new HTTPException(404, { message: "可撤销的 Tenant 自定义域名不存在" });
  return { id: input.id };
}

export async function getTenantPublicBaseUrl(tenantId: number) {
  const domain = (await sqlite
    .prepare(
      `SELECT hostname FROM saas_tenant_domain
       WHERE tenant_id = ? AND status = 'verified' AND is_primary = true
         AND certificate_status = 'active'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(tenantId)) as { hostname: string } | undefined;
  return domain ? `https://${domain.hostname}` : getAdminBaseEnv().publicUrl;
}
