import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["__tests__/**/*.test.ts"],
		// Builds dist/ once, so the bin and package tests run against what would be published.
		globalSetup: ["./vitest.setup.ts"],
	},
});
