import eslint from "@eslint/js";

export default [
  {
    ignores: [
      "node_modules/**",
      "**/dist/**",
      "**/out/**",
      "**/.vite/**",
      "**/coverage/**",
      "**/*.{ts,tsx,json,jsonc,md,yml,yaml}",
    ],
  },
  eslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    rules: {
      "no-console": "off",
    },
  },
];
