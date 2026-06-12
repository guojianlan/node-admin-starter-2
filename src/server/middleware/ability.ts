import type { MiddlewareHandler } from "hono";
import { fail } from "@/lib/response";
import type { HonoVariables } from "@/server/context";

export function ability(code: string): MiddlewareHandler<{ Variables: HonoVariables }> {
  return async (c, next) => {
    const user = c.get("user");
    if (user?.id === 1) {
      await next();
      return;
    }

    const abilities = c.get("abilities") ?? [];
    if (!abilities.includes(code)) {
      return c.json(
        fail("No Permission", {
          showType: 4,
          description: "没有当前操作权限",
        }),
        403,
      );
    }

    await next();
  };
}
