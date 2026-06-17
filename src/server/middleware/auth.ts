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
    await next();
  };
}
