import "../src/server/load-dotenv";
import crypto from "node:crypto";
import { closeDb } from "../src/server/db";
import { processNextSaaSNotification } from "../src/server/services/saas-notification-service";
import { processNextSaaSWebhookDelivery } from "../src/server/services/saas-webhook-service";

const once = process.argv.includes("--once");
const controller = new AbortController();
const workerId = `saas-outbox-${process.pid}-${crypto.randomUUID()}`;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => controller.abort());
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

try {
  do {
    const notification = await processNextSaaSNotification({ workerId });
    const webhook = await processNextSaaSWebhookDelivery({ workerId });
    if (once) break;
    if (!notification && !webhook) await delay(500);
  } while (!controller.signal.aborted);
} finally {
  await closeDb();
}
