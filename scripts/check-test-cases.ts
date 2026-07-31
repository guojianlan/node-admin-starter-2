import fs from "node:fs";
import path from "node:path";
import { apiTestCases } from "../tests/coverage/api-test-cases";
import { pageTestCases } from "../tests/coverage/page-test-cases";
import { apiOperationKey, collectApiOperations, collectPageRoutes } from "./lib/route-inventory";
import { renderApiTestCases, renderPageTestCases } from "./lib/test-case-docs";

const errors: string[] = [];

function duplicateValues(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  values.forEach((value) => (seen.has(value) ? duplicates.add(value) : seen.add(value)));
  return [...duplicates];
}

function requireText(value: string, label: string) {
  if (!value.trim()) errors.push(`${label} is empty`);
}

function requireList(values: string[], label: string) {
  if (!values.length) errors.push(`${label} has no criteria`);
  values.forEach((value, index) => requireText(value, `${label}[${index}]`));
}

const actualApiOperations = collectApiOperations();
const actualApiKeys = actualApiOperations.map(apiOperationKey);
const declaredApiKeys = apiTestCases.map((item) => item.operation);
duplicateValues(declaredApiKeys).forEach((key) => errors.push(`Duplicate API test case: ${key}`));
actualApiKeys
  .filter((key) => !declaredApiKeys.includes(key))
  .forEach((key) => {
    const source = actualApiOperations.find((operation) => apiOperationKey(operation) === key)?.source;
    errors.push(`Missing API test case: ${key}${source ? ` (${source})` : ""}`);
  });
declaredApiKeys
  .filter((key) => !actualApiKeys.includes(key))
  .forEach((key) => errors.push(`Stale API test case: ${key}`));
apiTestCases.forEach((item) => {
  requireText(item.area, `${item.operation}.area`);
  requireList(item.success, `${item.operation}.success`);
  requireList(item.failures, `${item.operation}.failures`);
  requireList(item.dataAssertions, `${item.operation}.dataAssertions`);
  requireList(item.security, `${item.operation}.security`);
  requireList(item.sideEffects, `${item.operation}.sideEffects`);
});

const actualPages = collectPageRoutes();
const declaredPages = pageTestCases.map((item) => item.path);
duplicateValues(declaredPages).forEach((route) => errors.push(`Duplicate page test case: ${route}`));
actualPages.filter((route) => !declaredPages.includes(route)).forEach((route) => errors.push(`Missing page test case: ${route}`));
declaredPages.filter((route) => !actualPages.includes(route)).forEach((route) => errors.push(`Stale page test case: ${route}`));
pageTestCases.forEach((item) => {
  requireText(item.area, `${item.path}.area`);
  Object.entries(item.data).forEach(([key, value]) => requireText(value, `${item.path}.data.${key}`));
  Object.entries(item.interaction).forEach(([key, value]) => requireText(value, `${item.path}.interaction.${key}`));
  Object.entries(item.visual).forEach(([key, value]) => requireText(value, `${item.path}.visual.${key}`));
});

const generatedDocs = [
  { file: "docs/admin-base-api-test-cases.md", expected: renderApiTestCases(apiTestCases) },
  { file: "docs/admin-base-page-test-cases.md", expected: renderPageTestCases(pageTestCases) },
];
generatedDocs.forEach(({ file, expected }) => {
  const absolutePath = path.join(process.cwd(), file);
  if (!fs.existsSync(absolutePath)) {
    errors.push(`Generated test document is missing: ${file}; run pnpm test:docs`);
  } else if (fs.readFileSync(absolutePath, "utf8") !== expected) {
    errors.push(`Generated test document is stale: ${file}; run pnpm test:docs`);
  }
});

if (errors.length) {
  console.error(`Test-case coverage check failed with ${errors.length} issue(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(
  `Test-case coverage check passed: ${actualApiKeys.length}/${actualApiKeys.length} API operations, ${actualPages.length}/${actualPages.length} pages`,
);
