import pino from "pino";
import { getAdminBaseEnv } from "@/server/env";

const env = getAdminBaseEnv();

export const logger = pino({
  level: env.logLevel,
  base: undefined,
});
