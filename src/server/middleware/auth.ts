import type { MiddlewareHandler } from "hono";
import { fail } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { resolveToken } from "@/server/services/auth-service";

function parseBearer(value?: string) {
  if (!value) return null;
  const [type, token] = value.split(" ");
  if (type?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

export function authRequired(): MiddlewareHandler<{ Variables: HonoVariables }> {
  return async (c, next) => {
    const token = parseBearer(c.req.header("authorization"));
    if (!token) {
      return c.json(fail("Token not provided", { showType: 4 }), 401);
    }

    const resolved = await resolveToken(token);
    if (!resolved) {
      return c.json(fail("Invalid token", { showType: 4 }), 401);
    }

    c.set("user", resolved.user);
    c.set("abilities", resolved.abilities);
    c.set("tokenHash", resolved.tokenHash);
    if (resolved.user.mustChangePassword && !isForcePasswordChangeAllowed(c.req.path, c.req.method)) {
      return c.json(fail("必须修改密码后继续使用系统", { showType: 2 }), 423);
    }
    await next();
  };
}

function isForcePasswordChangeAllowed(path: string, method: string) {
  const normalizedMethod = method.toUpperCase();
  if (path === "/api/system/info" || path === "/api/system/menu") return true;
  if (path === "/api/system/logout" && normalizedMethod === "POST") return true;
  if (path === "/api/system/profile" && normalizedMethod === "GET") return true;
  if (path === "/api/system/profile/password" && normalizedMethod === "PUT") return true;
  if (path === "/api/system/profile/login-records" && normalizedMethod === "GET") return true;
  return false;
}
