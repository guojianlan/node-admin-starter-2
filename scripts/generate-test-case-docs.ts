import fs from "node:fs";
import path from "node:path";
import { apiTestCases } from "../tests/coverage/api-test-cases";
import { pageTestCases } from "../tests/coverage/page-test-cases";
import { renderApiTestCases, renderPageTestCases } from "./lib/test-case-docs";

const root = process.cwd();
fs.writeFileSync(
  path.join(root, "docs/admin-base-api-test-cases.md"),
  renderApiTestCases(apiTestCases),
  "utf8",
);
fs.writeFileSync(
  path.join(root, "docs/admin-base-page-test-cases.md"),
  renderPageTestCases(pageTestCases),
  "utf8",
);

console.log(`Generated ${apiTestCases.length} API and ${pageTestCases.length} page test cases`);
