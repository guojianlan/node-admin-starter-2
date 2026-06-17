import { beforeEach, describe, expect, it } from "vitest";
import { buildTree } from "@/lib/tree";
import { getUserAccess, getUserMenus } from "@/server/services/auth-service";
import { buildListQuery } from "@/server/services/list-query";
import { resetTestDatabase } from "../helpers/db";

describe("service helpers", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("builds nested trees from parentId relationships", () => {
    const tree = buildTree([
      { id: 1, parentId: 0, name: "root" },
      { id: 2, parentId: 1, name: "child" },
      { id: 3, parentId: 2, name: "leaf" },
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0]?.children?.[0]?.children?.[0]?.name).toBe("leaf");
  });

  it("aggregates super admin permissions and menus", async () => {
    const access = await getUserAccess(1);
    const menus = await getUserMenus(1);

    expect(access).toContain("system.user.query");
    expect(access).toContain("system.role.setRule");
    expect(JSON.stringify(menus)).toContain("/system/role");
  });

  it("parses URL query into list pagination/search/filter/sort", async () => {
    const page = await buildListQuery<{ username: string }>(
      "http://localhost/api/system/user?page=1&pageSize=10&keyword=admin&status=1&sort=createdAt.desc",
      {
        table: "sys_user u",
        select: "u.username, u.status, u.created_at AS createdAt",
        fieldMap: {
          id: "u.id",
          username: "u.username",
          nickname: "u.nickname",
          status: "u.status",
          createdAt: "u.created_at",
        },
        searchable: { status: "=" },
        quickSearchFields: ["username", "nickname"],
        sortableFields: ["createdAt"],
        baseWhere: ["u.deleted_at IS NULL"],
      },
    );

    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(10);
    expect(page.total).toBe(1);
    expect(page.data[0]?.username).toBe("admin");
  });
});
