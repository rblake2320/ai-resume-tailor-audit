import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [".next/**", "node_modules/**", "coverage/**", "next-env.d.ts"],
  },
  ...tseslint.configs.recommended,
  nextPlugin.configs["core-web-vitals"],
  reactHooks.configs.flat.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
