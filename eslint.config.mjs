import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "tmp/**",
      "coverage/**",
      "data/**",
      "storage/uploads/**",
    ],
  },
  ...nextVitals,
  ...nextTypescript,
];

export default eslintConfig;
