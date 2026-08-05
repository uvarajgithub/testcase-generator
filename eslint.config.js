import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  js.configs.recommended,
  {
    ignores: ["dist", "node_modules", "coverage", "playwright-report"]
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: "module" },
      globals: {
        window: "readonly",
        document: "readonly",
        File: "readonly",
        FormData: "readonly",
        fetch: "readonly",
        localStorage: "readonly",
        Blob: "readonly",
        URL: "readonly",
        FileList: "readonly",
        RequestInit: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        process: "readonly",
        Buffer: "readonly",
        NodeJS: "readonly"
      }
    },
    plugins: { "@typescript-eslint": tseslint, "react-hooks": reactHooks },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "no-control-regex": "off"
    }
  }
];
