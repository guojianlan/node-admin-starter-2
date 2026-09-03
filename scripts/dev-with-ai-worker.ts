import { spawn, type ChildProcess } from "node:child_process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const children: ChildProcess[] = [];
let shuttingDown = false;

function start(name: string, args: string[]) {
  const child = spawn(pnpm, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  children.push(child);
  child.once("error", (error) => {
    console.error(`[dev:all] ${name} 启动失败：${error.message}`);
    shutdown(1);
  });
  child.once("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(
      `[dev:all] ${name} 已退出（${signal ? `signal ${signal}` : `code ${code ?? 1}`}），正在停止其余进程。`,
    );
    shutdown(code ?? 1);
  });
}

function shutdown(exitCode: number, signal: NodeJS.Signals = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode == null && child.signalCode == null) child.kill(signal);
  }
  const forceTimer = setTimeout(() => {
    for (const child of children) {
      if (child.exitCode == null && child.signalCode == null) child.kill("SIGKILL");
    }
  }, 5_000);
  forceTimer.unref();
  Promise.all(
    children.map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode != null || child.signalCode != null) return resolve();
          child.once("exit", () => resolve());
        }),
    ),
  ).finally(() => process.exit(exitCode));
}

process.once("SIGINT", () => shutdown(0, "SIGINT"));
process.once("SIGTERM", () => shutdown(0));

console.log("[dev:all] 启动 Web/API、AI Worker 与 SaaS Outbox Worker；任一进程退出时会停止整组进程。");
start("Web/API", ["dev"]);
start("AI Worker", ["ai:worker"]);
start("SaaS Outbox Worker", ["saas:outbox"]);
