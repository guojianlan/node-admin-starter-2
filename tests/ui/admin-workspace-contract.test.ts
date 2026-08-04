import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const adminAppRoot = path.join(projectRoot, "src/app/(admin)");

function collectPageFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectPageFiles(target);
    return entry.name === "page.tsx" ? [target] : [];
  });
}

function resolveFeatureFile(importPath: string) {
  const relativePath = importPath.replace(/^@\//, "");
  const candidates = [
    path.join(projectRoot, "src", `${relativePath}.tsx`),
    path.join(projectRoot, "src", relativePath, "index.tsx"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

describe("admin workspace layout contract", () => {
  it("routes every admin page through a PageScaffold feature surface", () => {
    const failures = collectPageFiles(adminAppRoot).flatMap((pageFile) => {
      const pageSource = fs.readFileSync(pageFile, "utf8");
      const featureImport = pageSource.match(/from\s+["'](@\/features\/[^"']+)["']/)?.[1];
      if (!featureImport)
        return [`${path.relative(projectRoot, pageFile)}: missing feature import`];

      const featureFile = resolveFeatureFile(featureImport);
      if (!featureFile)
        return [`${path.relative(projectRoot, pageFile)}: unresolved ${featureImport}`];

      const featureSource = fs.readFileSync(featureFile, "utf8");
      return featureSource.includes("<PageScaffold")
        ? []
        : [`${path.relative(projectRoot, featureFile)}: missing PageScaffold`];
    });

    expect(failures).toEqual([]);
  });

  it("keeps the shared shell and page workspace on one bounded height chain", () => {
    const css = fs.readFileSync(path.join(projectRoot, "src/app/globals.css"), "utf8");

    expect(css).toContain(".xin-page-cache-entry > *");
    expect(css).toContain(".admin-page-content > .admin-fill-workspace");
    expect(css).toContain(".admin-fill-tabs");
    expect(css).toContain(".admin-fill-table.ant-table-wrapper");
    expect(css).toContain("overflow: hidden;");
    expect(css).toContain("min-height: 0;");
  });

  it("keeps settings headers fixed while long forms scroll inside the card body", () => {
    const page = fs.readFileSync(
      path.join(projectRoot, "src/features/system/settings/SettingsPage.tsx"),
      "utf8",
    );
    const css = fs.readFileSync(path.join(projectRoot, "src/app/globals.css"), "utf8");

    expect(page).toContain('tabPlacement={screens.sm ? "start" : "top"}');
    expect(page).toContain('className="settings-resource-grid settings-resource-scroll"');
    expect(css).toContain(".settings-section-card > .ant-card-body");
    expect(css).toContain(".settings-resource-scroll");
  });
});
