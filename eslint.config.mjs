import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Theme-dictionary rule: user-facing text comes from `t.*` (src/copy), never JSX literals.
    files: ["src/app/**/*.tsx", "src/components/**/*.tsx", "src/features/**/*.tsx"],
    rules: {
      "react/jsx-no-literals": ["error", { noStrings: false, allowedStrings: [] }],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXAttribute[name.name=/^(title|placeholder|alt|aria-label|aria-description)$/] > Literal",
          message: "User-facing attributes must come from the copy dictionary (src/copy).",
        },
      ],
    },
  },
  {
    // Developer-only tooling, not shipped in production builds.
    files: ["src/app/dev/**"],
    rules: { "react/jsx-no-literals": "off", "no-restricted-syntax": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
