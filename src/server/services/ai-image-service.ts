import { generateImage } from "ai";
import { sqlite } from "@/server/db";
import {
  beginAiInvocation,
  beginAiInvocationAttempt,
  finishAiInvocation,
  finishAiInvocationAttempt,
} from "./ai-reliability-service";
import { getAiImageRuntimeConfig } from "./ai-provider-service";
import { buildAiSdkImageRuntime } from "./ai-sdk-runtime";
import { readStoredObject, storeGeneratedImage, type FileObjectRow } from "./storage-service";
import { recordBackgroundOperationLog } from "./operation-log-service";

type ImageTransformInput = {
  fileId: number;
  instruction: string;
  modelId?: number;
  size?: string;
  style?: string;
};

type ImageTransformContext = {
  userId?: number;
  requestId?: string;
  runId?: number;
  hasAbility: (ability: string) => Promise<boolean>;
};

function isImageFile(row: { mime?: string | null; type?: string | null; ext?: string | null }) {
  const ext = String(row.ext ?? "").toLowerCase();
  return row.mime?.startsWith("image/") || row.type === "image" || ["jpg", "jpeg", "png", "gif", "webp"].includes(ext);
}

async function getSourceFile(fileId: number, context: ImageTransformContext) {
  const row = (await sqlite
    .prepare(
      `SELECT
        f.id,
        f.original_name AS "originalName",
        f.filename,
        f.path,
        f.url,
        f.mime,
        f.type,
        f.ext,
        f.usage_type AS "usageType",
        f.uploader_id AS "uploaderId",
        f.storage_id AS "storageId",
        COALESCE(s.type, 'local') AS "storageType",
        s.endpoint,
        s.region,
        s.bucket,
        s.access_key AS "accessKey",
        s.secret_key_encrypted AS "secretKeyEncrypted",
        s.root_path AS "rootPath"
       FROM sys_file f
       LEFT JOIN sys_storage s ON s.id = f.storage_id
       WHERE f.id = ? AND f.deleted_at IS NULL
       LIMIT 1`,
    )
    .get(fileId)) as
    | (FileObjectRow & {
        id: number;
        originalName: string;
        mime: string | null;
        type: string | null;
        ext: string | null;
        usageType: string;
        uploaderId: number | null;
      })
    | undefined;

  if (!row || !isImageFile(row)) throw new Error("图片输入文件不存在，或文件类型不是图片");
  const canReadAny =
    (await context.hasAbility("system.file.query")) ||
    (await context.hasAbility("system.file.download"));
  if (!canReadAny && row.uploaderId !== context.userId) {
    throw new Error("没有读取这张图片的权限");
  }
  return row;
}

function providerImageOptions(input: ImageTransformInput, providerCode: string) {
  const options: Record<string, string> = {};
  if (input.style?.trim()) options.style = input.style.trim().slice(0, 80);
  return Object.keys(options).length ? { [providerCode]: options } : undefined;
}

export async function executeImageTransform(
  input: ImageTransformInput & { configJson?: string | null },
  context: ImageTransformContext,
) {
  if (!context.userId) throw new Error("图片工作流需要登录用户上下文");
  const file = await getSourceFile(input.fileId, context);
  let configuredModelId = input.modelId;
  if (!configuredModelId && input.configJson) {
    try {
      const config = JSON.parse(input.configJson) as { modelId?: number };
      configuredModelId = Number(config.modelId) || undefined;
    } catch {
      throw new Error("图片 Tool 配置不是有效 JSON");
    }
  }

  const runtimeConfig = await getAiImageRuntimeConfig(configuredModelId);
  if (runtimeConfig.model.capabilities.imageEdit === false) {
    throw new Error("当前 Image 模型未启用图片编辑能力");
  }
  const runtime = buildAiSdkImageRuntime(runtimeConfig.provider, runtimeConfig.model);
  const invocationId = await beginAiInvocation({
    purpose: "agent",
    sourceType: "image_transform",
    sourceId: input.fileId,
    requestId: context.requestId,
    userId: context.userId,
    runId: context.runId,
    modelId: runtimeConfig.model.id,
  });
  const attemptStartedAt = performance.now();
  const attemptId = await beginAiInvocationAttempt({
    invocationId,
    attemptNo: 1,
    config: runtimeConfig,
  });

  try {
    const sourceBuffer = await readStoredObject(file);
    const instruction = input.instruction.trim();
    const result = await generateImage({
      model: runtime.model,
      prompt: {
        text: `${instruction}\n\n保留原图主体和主要构图，只进行创意改造；输出一张适合直接展示的图片。`,
        images: [`data:${file.mime || "image/png"};base64,${sourceBuffer.toString("base64")}`],
      },
      n: 1,
      size: input.size as `${number}x${number}` | undefined,
      // Provider-specific image options are intentionally limited to a small,
      // JSON-safe allowlist; the SDK type is generic over provider names.
      providerOptions: providerImageOptions(input, runtimeConfig.provider.code) as never,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(runtimeConfig.provider.timeoutMs),
    });
    const generated = await storeGeneratedImage({
      name: `funny-${file.originalName || "image"}`,
      mime: result.image.mediaType,
      buffer: Buffer.from(result.image.uint8Array),
      userId: context.userId,
      metadata: {
        sourceFileId: file.id,
        instruction,
        providerCode: runtimeConfig.provider.code,
        modelId: runtimeConfig.model.id,
        modelIdentifier: runtimeConfig.model.modelId,
      },
    });
    const latencyMs = Math.round(performance.now() - attemptStartedAt);
    await finishAiInvocationAttempt({
      id: attemptId,
      status: "completed",
      config: runtimeConfig,
      usage: result.usage,
      latencyMs,
    });
    await finishAiInvocation({
      id: invocationId,
      status: "completed",
      config: runtimeConfig,
      attemptCount: 1,
      usage: result.usage,
      durationMs: latencyMs,
    });
    await recordBackgroundOperationLog(
      {
        userId: context.userId,
        requestId: context.requestId,
        module: "system.aiImage",
        action: "transform",
        resource: "sys_file",
        resourceId: file.id,
        riskLevel: "medium",
        details: {
          sourceFileId: file.id,
          outputFileId: generated.id,
          providerCode: runtimeConfig.provider.code,
          modelId: runtimeConfig.model.id,
          invocationId,
        },
        durationMs: latencyMs,
      },
      sqlite,
    );
    return {
      fileId: generated.id,
      url: generated.url,
      mime: result.image.mediaType,
      sourceFileId: file.id,
      provider: runtimeConfig.provider.name,
      model: runtimeConfig.model.name,
      modelId: runtimeConfig.model.id,
      invocationId,
      warnings: result.warnings,
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - attemptStartedAt);
    await finishAiInvocationAttempt({
      id: attemptId,
      status: "failed",
      config: runtimeConfig,
      latencyMs,
      error,
    });
    await finishAiInvocation({
      id: invocationId,
      status: "failed",
      config: runtimeConfig,
      attemptCount: 1,
      durationMs: latencyMs,
      error,
    });
    throw error;
  }
}
