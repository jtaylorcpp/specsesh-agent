import { defineConfig } from "vitest/config";

/** The pack check needs the npm registry, so it runs only through `pnpm pack:check` (vitest.pack.config.ts). */
export const PACK_TEST = "__tests__/package/pack.test.ts";

export default defineConfig({
	test: {
		environment: "node",
		include: ["__tests__/**/*.test.ts"],
		exclude: ["**/node_modules/**", PACK_TEST],
		// Builds dist/ once, so the bin and package tests run against what would be published.
		globalSetup: ["./vitest.setup.ts"],
	},
});
