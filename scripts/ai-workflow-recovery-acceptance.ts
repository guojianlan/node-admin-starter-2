import "../src/server/load-dotenv";

import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { closeDb, sql, sqlite } from "../src/server/db";
import { seedDatabase } from "../src/server/db/seed/seed";
import { claimAiJob, processNextAiJob } from "../src/server/services/ai-job-service";
import { resolveAiWorkflowWait } from "../src/server/services/ai-workflow-service";
import {
  createVisualWorkflowVersion,
  executeVisualWorkflow,
  publishVisualWorkflowVersion,
  resumeVisualWorkflow,
} from "../src/server/services/ai-visual-workflow-service";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const leaseSeconds = 2;
const childMode = process.argv.find((value) => value.startsWith("--mode="))?.slice(7);
const workerId = process.argv.find((value) => value.startsWith("--worker-id="))?.slice(12) ?? "acceptance-worker";
const scriptPath = fileURLToPath(import.meta.url);

type JobSnapshot = {
  id: number;
  status: string;
  attempts: number;
  lockedBy: string | null;
  leaseExpired: boolean;
};

type AcceptanceChild = ChildProcessByStdio<null, Readable, Readable>;

function assertIsolatedDatabase() {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Workflow recovery acceptance requires an explicit DATABASE_URL");
  }
  const databaseName = parsed.pathname.replace(/^\//, "");
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (!localHost || !/_test$/.test(databaseName)) {
    throw new Error(
      `Workflow recovery acceptance only allows a local *_test database; received host=${parsed.hostname}, database=${databaseName}`,
    );
  }
}

async function runChildMode() {
  assertIsolatedDatabase();
  if (childMode === "claim-and-hold") {
    const job = await claimAiJob(workerId, leaseSeconds);
    if (!job) throw new Error("No due AI Job was available for the first worker");
    console.log(`ACCEPTANCE_CLAIMED ${JSON.stringify({ id: job.id, attempts: job.attempts, workerId })}`);
    setInterval(() => undefined, 60_000);
    return;
  }
  if (childMode === "process-once") {
    const result = await processNextAiJob(workerId, leaseSeconds);
    console.log(`ACCEPTANCE_PROCESSED ${JSON.stringify({ result, workerId })}`);
    await closeDb();
    return;
  }
  throw new Error(`Unknown child mode: ${childMode ?? "missing"}`);
}

function spawnAcceptanceChild(mode: "claim-and-hold" | "process-once", id: string) {
  return spawn(process.execPath, ["--import", "tsx", scriptPath, `--mode=${mode}`, `--worker-id=${id}`], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      ADMIN_BASE_SECRET_KEY: process.env.ADMIN_BASE_SECRET_KEY || "workflow-recovery-acceptance-secret",
      LOG_LEVEL: "silent",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForMarker(
  child: AcceptanceChild,
  marker: "ACCEPTANCE_CLAIMED" | "ACCEPTANCE_PROCESSED",
  timeoutMs = 15_000,
) {
  let output = "";
  let errors = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    errors += String(chunk);
  });
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const line = output
      .split(/\r?\n/)
      .find((candidate) => candidate.startsWith(`${marker} `));
    if (line) return JSON.parse(line.slice(marker.length + 1)) as Record<string, unknown>;
    if (child.exitCode !== null) {
      throw new Error(`Acceptance worker exited before ${marker}: ${errors.trim() || output.trim()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill("SIGKILL");
  throw new Error(`Timed out waiting for ${marker}: ${errors.trim() || output.trim()}`);
}

async function waitForExit(child: AcceptanceChild, timeoutMs = 10_000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timed out waiting for acceptance worker exit")), timeoutMs),
    ),
  ]);
}

async function jobSnapshot(jobId: number) {
  return (await sqlite
    .prepare(
      `SELECT id, status, attempts, locked_by AS "lockedBy",
        COALESCE(lease_until <= now(), false) AS "leaseExpired"
       FROM sys_ai_job WHERE id = ?`,
    )
    .get(jobId)) as JobSnapshot;
}

async function waitForLeaseExpiry(jobId: number, timeoutMs = 8_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await jobSnapshot(jobId);
    if (snapshot.leaseExpired) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Job #${jobId} lease did not expire within ${timeoutMs}ms`);
}

async function hardKillAndRecover(jobId: number, scenario: string) {
  const firstWorkerId = `${scenario}-node-a`;
  const secondWorkerId = `${scenario}-node-b`;
  const first = spawnAcceptanceChild("claim-and-hold", firstWorkerId);
  const claimed = await waitForMarker(first, "ACCEPTANCE_CLAIMED");
  if (Number(claimed.id) !== jobId || Number(claimed.attempts) !== 1) {
    first.kill("SIGKILL");
    throw new Error(`${scenario}: first worker claimed an unexpected job`);
  }
  first.kill("SIGKILL");
  await waitForExit(first);

  const afterKill = await jobSnapshot(jobId);
  if (afterKill.status !== "running" || afterKill.lockedBy !== firstWorkerId) {
    throw new Error(`${scenario}: killed worker did not leave a reclaimable running lease`);
  }
  await waitForLeaseExpiry(jobId);

  const second = spawnAcceptanceChild("process-once", secondWorkerId);
  const processed = await waitForMarker(second, "ACCEPTANCE_PROCESSED");
  await waitForExit(second);
  const result = processed.result as { id?: number; status?: string } | null;
  if (Number(result?.id) !== jobId || result?.status !== "completed") {
    throw new Error(`${scenario}: second worker did not complete the reclaimed job`);
  }
  const completed = await jobSnapshot(jobId);
  if (completed.status !== "completed" || completed.attempts !== 2 || completed.lockedBy !== null) {
    throw new Error(`${scenario}: final job state is not a single completed second attempt`);
  }
  return { jobId, attempts: completed.attempts, firstWorkerId, secondWorkerId };
}

async function assertNoDuplicateSteps(runId: number) {
  const rows = (await sqlite
    .prepare(
      `SELECT step_no AS "stepNo", COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS "completedCount"
       FROM sys_ai_workflow_run_step WHERE run_id = ? GROUP BY step_no ORDER BY step_no`,
    )
    .all(runId)) as Array<{ stepNo: number; count: number; completedCount: number }>;
  if (!rows.length || rows.some((row) => row.count !== 1 || row.completedCount !== 1)) {
    throw new Error(`Workflow Run #${runId} contains duplicate or incomplete steps`);
  }
  return rows.length;
}

async function createDueTimerScenario() {
  const draft = await createVisualWorkflowVersion({
    code: `acceptance-recovery-timer-${Date.now()}`,
    name: "强杀恢复定时流程",
    userId: 1,
    graph: {
      nodes: [
        { id: "input", type: "input", position: { x: 0, y: 0 } },
        { id: "delay", type: "sleep", position: { x: 180, y: 0 }, data: { duration: 31_000 } },
        { id: "output", type: "output", position: { x: 360, y: 0 } },
      ],
      edges: [
        { source: "input", target: "delay" },
        { source: "delay", target: "output" },
      ],
    },
  });
  await publishVisualWorkflowVersion({ definitionId: draft.definitionId, version: draft.version, userId: 1 });
  const started = await executeVisualWorkflow({
    definitionId: draft.definitionId,
    userId: 1,
    value: JSON.stringify({ scenario: "timer-recovery" }),
  });
  const wait = (await sqlite
    .prepare("SELECT id FROM sys_ai_workflow_wait WHERE run_id = ? AND wait_type = 'timer'")
    .get(started.runId)) as { id: number };
  await sqlite.prepare("UPDATE sys_ai_workflow_wait SET resume_at = now() - interval '1 second' WHERE id = ?").run(wait.id);
  const job = (await sqlite
    .prepare(
      `UPDATE sys_ai_job SET available_at = now() - interval '1 second'
       WHERE job_type = 'workflow_resume' AND resource_id = ? RETURNING id`,
    )
    .get(String(started.runId))) as { id: number };
  return { runId: started.runId, waitId: wait.id, jobId: job.id };
}

async function createParentChildScenario() {
  const child = await createVisualWorkflowVersion({
    code: `acceptance-recovery-child-${Date.now()}`,
    name: "跨节点恢复子流程",
    userId: 1,
    graph: {
      nodes: [
        { id: "input", type: "input", position: { x: 0, y: 0 } },
        {
          id: "human",
          type: "humanInput",
          position: { x: 180, y: 0 },
          data: {
            title: "确认跨节点结果",
            timeoutMs: 60_000,
            schema: JSON.stringify({
              type: "object",
              required: ["result"],
              properties: { result: { type: "string", title: "结果" } },
            }),
          },
        },
        { id: "output", type: "output", position: { x: 360, y: 0 } },
      ],
      edges: [
        { source: "input", target: "human" },
        { source: "human", target: "output" },
      ],
    },
  });
  await publishVisualWorkflowVersion({ definitionId: child.definitionId, version: child.version, userId: 1 });
  const parent = await createVisualWorkflowVersion({
    code: `acceptance-recovery-parent-${Date.now()}`,
    name: "跨节点恢复父流程",
    userId: 1,
    graph: {
      nodes: [
        { id: "input", type: "input", position: { x: 0, y: 0 } },
        { id: "child", type: "workflow", position: { x: 180, y: 0 }, data: { workflowId: String(child.definitionId) } },
        { id: "output", type: "output", position: { x: 360, y: 0 } },
      ],
      edges: [
        { source: "input", target: "child" },
        { source: "child", target: "output" },
      ],
    },
  });
  await publishVisualWorkflowVersion({ definitionId: parent.definitionId, version: parent.version, userId: 1 });
  const started = await executeVisualWorkflow({
    definitionId: parent.definitionId,
    userId: 1,
    value: JSON.stringify({ scenario: "parent-child-recovery" }),
  });
  const parentWait = (await sqlite
    .prepare("SELECT id, child_run_id AS \"childRunId\" FROM sys_ai_workflow_wait WHERE run_id = ? AND wait_type = 'child_workflow'")
    .get(started.runId)) as { id: number; childRunId: number };
  const humanWait = (await sqlite
    .prepare("SELECT id, correlation_key AS \"correlationKey\" FROM sys_ai_workflow_wait WHERE run_id = ? AND wait_type = 'event'")
    .get(parentWait.childRunId)) as { id: number; correlationKey: string };
  const resolved = await resolveAiWorkflowWait({
    id: humanWait.id,
    runId: parentWait.childRunId,
    userId: 1,
    status: "resolved",
    resolution: { correlationKey: humanWait.correlationKey, data: { result: "accepted" } },
    correlationKey: humanWait.correlationKey,
    expectedWaitType: "event",
  });
  if (!resolved) throw new Error("Failed to resolve child Human Input wait");
  const childResult = await resumeVisualWorkflow({ runId: parentWait.childRunId, userId: 1, waitId: humanWait.id });
  if (childResult.status !== "completed") throw new Error("Child Workflow did not complete before parent takeover test");
  const job = (await sqlite
    .prepare(
      `SELECT id FROM sys_ai_job WHERE job_type = 'workflow_resume' AND resource_id = ?
       AND status = 'queued' AND available_at <= now() ORDER BY id DESC LIMIT 1`,
    )
    .get(String(started.runId))) as { id: number };
  return { parentRunId: started.runId, childRunId: parentWait.childRunId, parentWaitId: parentWait.id, jobId: job.id };
}

async function main() {
  assertIsolatedDatabase();
  await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
  await sql.unsafe("CREATE SCHEMA public");
  await seedDatabase();

  const timer = await createDueTimerScenario();
  const timerRecovery = await hardKillAndRecover(timer.jobId, "timer");
  const timerRun = (await sqlite.prepare("SELECT status FROM sys_ai_workflow_run WHERE id = ?").get(timer.runId)) as {
    status: string;
  };
  const timerWait = (await sqlite.prepare("SELECT status FROM sys_ai_workflow_wait WHERE id = ?").get(timer.waitId)) as {
    status: string;
  };
  if (timerRun.status !== "completed" || timerWait.status !== "resolved") {
    throw new Error("Timer Workflow did not finish after cross-process takeover");
  }
  const timerStepCount = await assertNoDuplicateSteps(timer.runId);

  const parentChild = await createParentChildScenario();
  const parentRecovery = await hardKillAndRecover(parentChild.jobId, "parent-child");
  const runs = (await sqlite
    .prepare(
      `SELECT id, status FROM sys_ai_workflow_run WHERE id IN (?, ?) ORDER BY id`,
    )
    .all(parentChild.parentRunId, parentChild.childRunId)) as Array<{ id: number; status: string }>;
  if (runs.length !== 2 || runs.some((run) => run.status !== "completed")) {
    throw new Error("Parent/child Workflow chain did not finish after cross-process takeover");
  }
  const parentWait = (await sqlite
    .prepare("SELECT status FROM sys_ai_workflow_wait WHERE id = ?")
    .get(parentChild.parentWaitId)) as { status: string };
  if (parentWait.status !== "resolved") throw new Error("Parent child_workflow wait was not resolved");
  const parentStepCount = await assertNoDuplicateSteps(parentChild.parentRunId);
  const childStepCount = await assertNoDuplicateSteps(parentChild.childRunId);

  console.log(
    JSON.stringify(
      {
        success: true,
        database: new URL(databaseUrl).pathname.replace(/^\//, ""),
        hardKillSignal: "SIGKILL",
        timer: { ...timerRecovery, runId: timer.runId, stepCount: timerStepCount },
        parentChild: {
          ...parentRecovery,
          parentRunId: parentChild.parentRunId,
          childRunId: parentChild.childRunId,
          parentStepCount,
          childStepCount,
        },
      },
      null,
      2,
    ),
  );
  await closeDb();
}

if (childMode) {
  await runChildMode();
} else {
  await main();
}
