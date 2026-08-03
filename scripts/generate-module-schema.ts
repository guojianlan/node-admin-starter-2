import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { format, resolveConfig } from "prettier";
import { adminModuleJsonSchema } from "../src/shared/module-generator-contract";

const outputPath = resolve(process.cwd(), "schemas/admin-module.schema.json");
const prettierConfig = await resolveConfig(outputPath);
const content = await format(JSON.stringify(adminModuleJsonSchema), {
  ...prettierConfig,
  parser: "json",
});
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, content);
console.log(`Generated ${outputPath}`);
