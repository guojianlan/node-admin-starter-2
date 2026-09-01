import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { sqlite } from "@/server/db";
import { encryptSecret } from "@/server/services/secret";
import {
  executeRegisteredAiTool,
  isAiToolRuntimeAvailable,
} from "@/server/services/ai-tool-registry";
import { executeVisualWorkflow, publishVisualWorkflowVersion } from "@/server/services/ai-visual-workflow-service";
import { resetTestDatabase } from "../helpers/db";

beforeEach(async () => {
  vi.unstubAllGlobals();
  await resetTestDatabase();
});

let testStorageRoot: string | null = null;

afterEach(async () => {
  if (testStorageRoot) {
    await fs.rm(path.join(process.cwd(), testStorageRoot), { recursive: true, force: true });
    testStorageRoot = null;
  }
});

describe("AI image workflow foundation", () => {
  it("seeds the funny image workflow and exposes the controlled image tool", async () => {
    const tool = (await sqlite
      .prepare("SELECT code, handler_key AS \"handlerKey\", is_system AS \"isSystem\" FROM sys_ai_tool WHERE code = 'image-transform'")
      .get()) as { code: string; handlerKey: string; isSystem: boolean } | undefined;
    const workflow = (await sqlite
      .prepare("SELECT code, status, current_version AS \"currentVersion\" FROM sys_ai_workflow_definition WHERE code = 'funny-image-transform'")
      .get()) as { code: string; status: string; currentVersion: number | null } | undefined;

    expect(tool).toMatchObject({ code: "image-transform", handlerKey: "image_transform", isSystem: true });
    expect(workflow).toMatchObject({ code: "funny-image-transform", status: "draft" });
    const currentVersion = workflow?.currentVersion;
    expect(currentVersion).toEqual(expect.any(Number));
    if (currentVersion == null) throw new Error("搞怪图片 Workflow 没有当前草稿版本");
    const version = (await sqlite
      .prepare("SELECT input_schema_json AS \"inputSchema\", output_schema_json AS \"outputSchema\", graph_json AS \"graphJson\" FROM sys_ai_workflow_definition_version WHERE definition_id = (SELECT id FROM sys_ai_workflow_definition WHERE code = 'funny-image-transform') AND version = ?")
      .get(currentVersion)) as { inputSchema: string; outputSchema: string; graphJson: string };
    expect(JSON.parse(version.inputSchema)).toMatchObject({ required: ["fileId", "instruction"] });
    expect(JSON.parse(version.outputSchema)).toMatchObject({ required: ["fileId", "url"] });
    expect(JSON.parse(version.graphJson).nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "args", data: expect.objectContaining({ type: "mapping" }) }),
      expect.objectContaining({ id: "transform", data: expect.objectContaining({ toolId: "image-transform", modelSelection: "active" }) }),
    ]));
    expect(await isAiToolRuntimeAvailable("image_transform", sqlite)).toBe(false);
  });

  it("rejects a non-image source before any Provider call", async () => {
    const result = await sqlite
      .prepare(
        `INSERT INTO sys_file
          (original_name, filename, path, url, size, ext, mime, type, usage_type, uploader_id)
         VALUES ('notes.txt', 'notes.txt', 'missing/notes.txt', '/uploads/missing/notes.txt', 5,
                 'txt', 'text/plain', 'document', 'user_content', 1)
         RETURNING id`,
      )
      .run();
    const tool = {
      code: "image-transform",
      handlerKey: "image_transform",
      isSystem: true,
      riskLevel: "medium" as const,
    };

    await expect(
      executeRegisteredAiTool(
        tool,
        { fileId: Number(result.lastInsertRowid), instruction: "变成搞怪图片" },
        {
          dbClient: sqlite,
          userId: 1,
          hasAbility: async () => true,
        },
      ),
    ).rejects.toThrow("不是图片");
  });

  it("runs the seeded workflow through AI SDK Image edit and persists a new asset", async () => {
    const provider = await sqlite
      .prepare(
        `INSERT INTO sys_ai_provider
          (name, code, provider_type, base_url, api_key_encrypted, status)
         VALUES ('Image Test Provider', 'image-test-provider', 'openai-compatible',
                 'https://image-provider.test/v1', ?, 1)
         RETURNING id`,
      )
      .run(encryptSecret("image-secret"));
    const providerId = Number(provider.lastInsertRowid);
    await sqlite
      .prepare(
        `INSERT INTO sys_ai_model
          (provider_id, name, model_id, model_type, capabilities_json, status)
         VALUES (?, 'Image Edit Test', 'image-edit-test', 'image', ?, 1)
         RETURNING id`,
      )
      .run(providerId, JSON.stringify({ image: true, imageEdit: true }));
    testStorageRoot = `storage/test-image-workflow-${Date.now()}`;
    await sqlite.prepare("UPDATE sys_storage SET root_path = ? WHERE id = 1").run(testStorageRoot);
    const sourcePath = "source.png";
    const absoluteSourcePath = path.join(process.cwd(), testStorageRoot, sourcePath);
    await fs.mkdir(path.dirname(absoluteSourcePath), { recursive: true });
    const sourceBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await fs.writeFile(absoluteSourcePath, sourceBytes);
    const source = await sqlite
      .prepare(
        `INSERT INTO sys_file
          (storage_id, original_name, filename, path, url, size, ext, mime, type, usage_type, uploader_id)
         VALUES (1, 'source.png', 'source.png', ?, ?, ?, 'png', 'image/png', 'image', 'user_content', 1)
         RETURNING id`,
      )
      .run(sourcePath, `/uploads/${sourcePath}`, sourceBytes.length);

    const generatedBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03, 0x04]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ data: [{ b64_json: generatedBytes.toString("base64") }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const workflow = (await sqlite
      .prepare("SELECT id FROM sys_ai_workflow_definition WHERE code = 'funny-image-transform'")
      .get()) as { id: number };
    const version = (await sqlite
      .prepare("SELECT current_version AS \"currentVersion\" FROM sys_ai_workflow_definition WHERE id = ?")
      .get(workflow.id)) as { currentVersion: number };
    await publishVisualWorkflowVersion({ definitionId: workflow.id, version: version.currentVersion, userId: 1 });

    const result = await executeVisualWorkflow({
      definitionId: workflow.id,
      userId: 1,
      value: JSON.stringify({ fileId: Number(source.lastInsertRowid), instruction: "变成搞怪图片" }),
    });

    expect(result.value).toMatchObject({ sourceFileId: Number(source.lastInsertRowid) });
    const outputFileId = Number((result.value as { fileId: number }).fileId);
    expect(outputFileId).not.toBe(Number(source.lastInsertRowid));
    const outputFile = (await sqlite.prepare("SELECT path FROM sys_file WHERE id = ?").get(outputFileId)) as { path: string };
    expect(await fs.readFile(path.join(process.cwd(), testStorageRoot as string, outputFile.path))).toEqual(generatedBytes);
    expect(await sqlite.prepare("SELECT status FROM sys_ai_workflow_definition WHERE id = ?").get(workflow.id)).toMatchObject({ status: "published" });
    const persistedRun = (await sqlite
      .prepare("SELECT id, status, duration_ms AS \"durationMs\" FROM sys_ai_workflow_run WHERE workflow_code = 'funny-image-transform' ORDER BY id DESC LIMIT 1")
      .get()) as { id: number; status: string; durationMs: number | null };
    expect(persistedRun).toMatchObject({ status: "completed", durationMs: expect.any(Number) });
    const persistedSteps = (await sqlite
      .prepare("SELECT step_code AS \"stepCode\", status, duration_ms AS \"durationMs\" FROM sys_ai_workflow_run_step WHERE run_id = ? ORDER BY step_no ASC")
      .all(persistedRun.id)) as Array<{ stepCode: string; status: string; durationMs: number | null }>;
    expect(persistedSteps).toEqual([
      expect.objectContaining({ stepCode: "input", status: "completed", durationMs: expect.any(Number) }),
      expect.objectContaining({ stepCode: "args", status: "completed", durationMs: expect.any(Number) }),
      expect.objectContaining({ stepCode: "transform", status: "completed", durationMs: expect.any(Number) }),
      expect.objectContaining({ stepCode: "output", status: "completed", durationMs: expect.any(Number) }),
    ]);
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
  });
});
