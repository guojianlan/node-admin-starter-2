import { Hono } from "hono";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { authRequired } from "@/server/middleware/auth";
import { getUserAccess, getUserMenus, login, logout } from "@/server/services/auth-service";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  remember: z.boolean().optional(),
});

export const authRoutes = new Hono<{ Variables: HonoVariables }>();

authRoutes.post("/login", async (c) => {
  const payload = loginSchema.parse(await c.req.json());
  const result = await login({
    ...payload,
    ip: c.req.header("x-forwarded-for") ?? null,
    userAgent: c.req.header("user-agent") ?? null,
  });
  return c.json(success(result, "登录成功"));
});

authRoutes.post("/logout", authRequired(), async (c) => {
  await logout(c.get("tokenHash"));
  return c.json(success(null, "退出成功"));
});

authRoutes.get("/info", authRequired(), async (c) => {
  const user = c.get("user");
  return c.json(
    success({
      user,
      access: await getUserAccess(user.id),
    }),
  );
});

authRoutes.get("/menu", authRequired(), async (c) => {
  const user = c.get("user");
  return c.json(success(await getUserMenus(user.id)));
});
