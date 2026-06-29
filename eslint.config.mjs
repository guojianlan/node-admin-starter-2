import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "tmp/**",
      "generated/module-drafts/**",
      "coverage/**",
      "data/**",
      "storage/uploads/**",
    ],
  },
  ...nextVitals,
  ...nextTypescript,
];

export default eslintConfig;
