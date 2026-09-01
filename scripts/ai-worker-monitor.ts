import "../src/server/load-dotenv";
import { closeDb } from "../src/server/db";
import { getAdminBaseEnv } from "../src/server/env";
import {
  getAiWorkerQueueHealth,
  type AiWorkerQueueHealth,
} from "../src/server/services/ai-job-service";

const once = process.argv.includes("--once");
const env = getAdminBaseEnv();
const controller = new AbortController();
let notifiedStatus: AiWorkerQueueHealth["status"] | null = null;

process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

async function notify(health: AiWorkerQueueHealth) {
  if (!env.aiWorkerAlertWebhookUrl || notifiedStatus === health.status) return;
  if (notifiedStatus === null && health.status === "healthy") {
    notifiedStatus = "healthy";
    return;
  }
  const response = await fetch(env.aiWorkerAlertWebhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event:
        health.status === "degraded" ? "ai_worker_queue_degraded" : "ai_worker_queue_recovered",
      service: "admin-base-ai-worker",
      ...health,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`告警 Webhook 返回 ${response.status}`);
  notifiedStatus = health.status;
}

async function check() {
  const health = await getAiWorkerQueueHealth(env.aiWorkerStalledAfterSeconds);
  const log = JSON.stringify({ scope: "ai-worker-monitor", ...health });
  if (health.status === "degraded") console.error(log);
  else console.log(log);
  try {
    await notify(health);
  } catch (error) {
    console.error(
      JSON.stringify({
        scope: "ai-worker-monitor",
        event: "alert_delivery_failed",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  return health;
}

let exitCode = 0;
try {
  do {
    const health = await check();
    if (once) {
      exitCode = health.status === "healthy" ? 0 : 1;
      break;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, env.aiWorkerMonitorIntervalSeconds * 1_000);
      controller.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  } while (!controller.signal.aborted);
} finally {
  await closeDb();
}

process.exitCode = exitCode;
