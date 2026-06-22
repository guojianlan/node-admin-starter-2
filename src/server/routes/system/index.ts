import { Hono } from "hono";
import type { HonoVariables } from "@/server/context";
import { configRoutes } from "./config";
import { deptRoutes } from "./dept";
import { dictRoutes } from "./dict";
import { fileRoutes } from "./file";
import { mailRoutes } from "./mail";
import { roleRoutes } from "./role";
import { ruleRoutes } from "./rule";
import { storageRoutes } from "./storage";
import { userRoutes } from "./user";

export const systemRoutes = new Hono<{ Variables: HonoVariables }>();

systemRoutes.route("/", userRoutes);
systemRoutes.route("/", roleRoutes);
systemRoutes.route("/", ruleRoutes);
systemRoutes.route("/", deptRoutes);
systemRoutes.route("/", dictRoutes);
systemRoutes.route("/", configRoutes);
systemRoutes.route("/", fileRoutes);
systemRoutes.route("/", storageRoutes);
systemRoutes.route("/", mailRoutes);
