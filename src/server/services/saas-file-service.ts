import { HTTPException } from "hono/http-exception";
import { sqlite, type DbClient } from "@/server/db";
import {
  deleteUnreferencedStoredFile,
  readStoredObject,
  uploadFileToDefaultStorage,
  type FileObjectRow,
} from "./storage-service";
import {
  assertSaaSResourceScope,
  buildSaaSObjectPrefix,
  revalidateSaaSResourceScope,
  type SaaSResourceIdentity,
  type SaaSResourceScope,
} from "./saas-resource-scope-service";

type SaaSFileRow = SaaSResourceIdentity & {
  id: number;
  fileId: number;
  objectKey: string;
  resourceType: string | null;
  resourceId: string | null;
  purpose: string | null;
  originalName: string;
  filename: string;
  path: string;
  url: string;
  size: number;
  ext: string | null;
  mime: string | null;
  type: string;
  sha256: string | null;
  createdAt: string;
};

function normalizeResourceBinding(input: {
  resourceType?: string | null;
  resourceId?: string | number | null;
  purpose?: string | null;
}) {
  const resourceType = input.resourceType?.trim() || null;
  const resourceId = input.resourceId == null ? null : String(input.resourceId).trim() || null;
  if (Boolean(resourceType) !== Boolean(resourceId)) {
    throw new HTTPException(400, { message: "resourceType 与 resourceId 必须同时提供" });
  }
  return {
    resourceType,
    resourceId,
    purpose: input.purpose?.trim() || null,
  };
}

async function getSaaSFileRow(fileId: number, dbClient: DbClient = sqlite) {
  return (await dbClient
    .prepare(
      `SELECT binding.id, binding.file_id AS "fileId",
        binding.tenant_id AS "tenantId", binding.workspace_id AS "workspaceId",
        binding.object_key AS "objectKey", binding.resource_type AS "resourceType",
        binding.resource_id AS "resourceId", binding.purpose,
        file.original_name AS "originalName", file.filename, file.path, file.url,
        file.size, file.ext, file.mime, file.type, file.sha256,
        binding.created_at AS "createdAt"
       FROM saas_file_binding binding
       INNER JOIN sys_file file ON file.id = binding.file_id AND file.deleted_at IS NULL
       WHERE binding.file_id = ?
       LIMIT 1`,
    )
    .get(fileId)) as SaaSFileRow | undefined;
}

export async function assertSaaSFileScope(
  scope: SaaSResourceIdentity,
  fileId: number,
  dbClient: DbClient = sqlite,
) {
  const row = await getSaaSFileRow(fileId, dbClient);
  assertSaaSResourceScope(scope, row);
  return row;
}

export async function uploadSaaSFile(input: {
  userId: number;
  scope: SaaSResourceScope;
  file: File;
  resourceType?: string | null;
  resourceId?: string | number | null;
  purpose?: string | null;
}) {
  const scope = await revalidateSaaSResourceScope({ userId: input.userId, scope: input.scope });
  const binding = normalizeResourceBinding(input);
  const objectPrefix = buildSaaSObjectPrefix(scope);
  const uploaded = await uploadFileToDefaultStorage({
    file: input.file,
    groupId: null,
    userId: input.userId,
    usageType: "user_content",
    pathPrefix: objectPrefix,
    metadata: {
      saasScoped: true,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
    },
  });
  const fileId = Number(uploaded.id);

  try {
    const fileRow = (await sqlite
      .prepare("SELECT path FROM sys_file WHERE id = ? AND deleted_at IS NULL")
      .get(fileId)) as { path: string } | undefined;
    if (!fileRow?.path.startsWith(`${objectPrefix}/`)) {
      throw new Error("SaaS 文件对象路径没有使用服务端 Tenant / Workspace 前缀");
    }
    await revalidateSaaSResourceScope({ userId: input.userId, scope });
    await sqlite
      .prepare(
        `INSERT INTO saas_file_binding
          (tenant_id, workspace_id, file_id, object_key, resource_type, resource_id, purpose,
           created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        scope.tenantId,
        scope.workspaceId,
        fileId,
        fileRow.path,
        binding.resourceType,
        binding.resourceId,
        binding.purpose,
        input.userId,
        input.userId,
      );
    return assertSaaSFileScope(scope, fileId);
  } catch (error) {
    await deleteUnreferencedStoredFile({ fileId, usageType: "user_content" }).catch(
      () => undefined,
    );
    throw error;
  }
}

export async function listSaaSFiles(input: {
  scope: SaaSResourceIdentity;
  page: number;
  pageSize: number;
  keyword?: string;
}) {
  const values: Array<string | number> = [input.scope.tenantId, input.scope.workspaceId];
  const where = ["binding.tenant_id = ?", "binding.workspace_id = ?", "file.deleted_at IS NULL"];
  if (input.keyword?.trim()) {
    where.push("(file.original_name ILIKE ? OR binding.resource_id ILIKE ?)");
    values.push(`%${input.keyword.trim()}%`, `%${input.keyword.trim()}%`);
  }
  const whereSql = where.join(" AND ");
  const total = (await sqlite
    .prepare(
      `SELECT COUNT(*)::int AS total
       FROM saas_file_binding binding
       INNER JOIN sys_file file ON file.id = binding.file_id
       WHERE ${whereSql}`,
    )
    .get(...values)) as { total: number };
  const rows = (await sqlite
    .prepare(
      `SELECT binding.id, binding.file_id AS "fileId",
        binding.tenant_id AS "tenantId", binding.workspace_id AS "workspaceId",
        binding.object_key AS "objectKey", binding.resource_type AS "resourceType",
        binding.resource_id AS "resourceId", binding.purpose,
        file.original_name AS "originalName", file.filename, file.path, file.url,
        file.size, file.ext, file.mime, file.type, file.sha256,
        binding.created_at AS "createdAt"
       FROM saas_file_binding binding
       INNER JOIN sys_file file ON file.id = binding.file_id
       WHERE ${whereSql}
       ORDER BY binding.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...values, input.pageSize, (input.page - 1) * input.pageSize)) as SaaSFileRow[];
  return { data: rows, page: input.page, pageSize: input.pageSize, total: Number(total.total) };
}

export async function getSaaSFile(scope: SaaSResourceIdentity, fileId: number) {
  return assertSaaSFileScope(scope, fileId);
}

export async function readSaaSFile(scope: SaaSResourceIdentity, fileId: number) {
  await assertSaaSFileScope(scope, fileId);
  const row = (await sqlite
    .prepare(
      `SELECT file.original_name AS "originalName", file.filename, file.path, file.mime,
        file.storage_id AS "storageId", COALESCE(storage.type, 'local') AS "storageType",
        storage.endpoint, storage.region, storage.bucket, storage.access_key AS "accessKey",
        storage.secret_key_encrypted AS "secretKeyEncrypted", storage.root_path AS "rootPath"
       FROM sys_file file
       INNER JOIN saas_file_binding binding ON binding.file_id = file.id
       LEFT JOIN sys_storage storage ON storage.id = file.storage_id
       WHERE file.id = ? AND file.deleted_at IS NULL`,
    )
    .get(fileId)) as (FileObjectRow & { originalName: string }) | undefined;
  if (!row) throw new HTTPException(404, { message: "SaaS 文件不存在" });
  return { row, buffer: await readStoredObject(row) };
}

export async function updateSaaSFileBinding(input: {
  userId: number;
  scope: SaaSResourceScope;
  fileId: number;
  resourceType?: string | null;
  resourceId?: string | number | null;
  purpose?: string | null;
}) {
  const scope = await revalidateSaaSResourceScope({ userId: input.userId, scope: input.scope });
  await assertSaaSFileScope(scope, input.fileId);
  const binding = normalizeResourceBinding(input);
  await sqlite
    .prepare(
      `UPDATE saas_file_binding
       SET resource_type = ?, resource_id = ?, purpose = ?, updated_by = ?, updated_at = now()
       WHERE file_id = ? AND tenant_id = ? AND workspace_id = ?`,
    )
    .run(
      binding.resourceType,
      binding.resourceId,
      binding.purpose,
      input.userId,
      input.fileId,
      scope.tenantId,
      scope.workspaceId,
    );
  return assertSaaSFileScope(scope, input.fileId);
}
