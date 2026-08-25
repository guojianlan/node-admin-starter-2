import { runAiWorker } from "../src/server/services/ai-job-service";

const once = process.argv.includes("--once");
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

await runAiWorker({ once, signal: controller.signal });
