import { beforeAll, describe, expect, it } from "vitest";
import { app } from "@/server/app";
import { apiTestCases, publicApiOperations } from "../coverage/api-test-cases";
import { resetTestDatabase } from "../helpers/db";

function resolveExamplePath(path: string) {
  return path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    if (name === "path") return "missing.txt";
    if (name === "provider") return "missing-provider";
    return "1";
  });
}

function requestInit(method: string): RequestInit {
  if (method === "GET") return { method };
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  };
}

describe.sequential("API authentication contract coverage", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });

  for (const testCase of apiTestCases) {
    const [method, declaredPath] = testCase.operation.split(" ", 2);
    const isPublic = publicApiOperations.has(testCase.operation);

    it(`${testCase.operation} ${isPublic ? "remains public" : "requires authentication"}`, async () => {
      const response = await app.request(resolveExamplePath(declaredPath), requestInit(method));

      if (isPublic) {
        expect(response.status, `${testCase.operation} must remain anonymously reachable`).not.toBe(401);
        return;
      }

      expect(response.status, `${testCase.operation} must reject anonymous requests`).toBe(401);
      expect(response.headers.get("content-type")).toContain("application/json");
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        msg: "Token not provided",
      });
    });
  }
});
