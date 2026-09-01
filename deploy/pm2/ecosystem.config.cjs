const appRoot = `${__dirname}/../..`;

module.exports = {
  apps: [
    {
      name: "admin-base-web",
      cwd: appRoot,
      script: "pnpm",
      args: "start",
      interpreter: "none",
      autorestart: true,
      restart_delay: 2_000,
      kill_timeout: 10_000,
      env: { NODE_ENV: "production" },
    },
    {
      name: "admin-base-ai-worker",
      cwd: appRoot,
      script: "pnpm",
      args: "ai:worker",
      interpreter: "none",
      autorestart: true,
      restart_delay: 2_000,
      kill_timeout: 10_000,
      env: { NODE_ENV: "production" },
    },
    {
      name: "admin-base-ai-worker-monitor",
      cwd: appRoot,
      script: "pnpm",
      args: "ai:worker:monitor",
      interpreter: "none",
      autorestart: true,
      restart_delay: 5_000,
      kill_timeout: 10_000,
      env: { NODE_ENV: "production" },
    },
  ],
};
