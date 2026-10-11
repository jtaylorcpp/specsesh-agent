import { defineConfig } from "vitest/config";

/** The pack check needs the npm registry, so it runs only through `pnpm pack:check` (vitest.pack.config.ts). */
export const PACK_TEST = "__tests__/package/pack.test.ts";

/** The live run makes real model calls on your subscription, so it runs only through `pnpm test:live` (vitest.live.config.ts). */
export const LIVE_TESTS = "__tests__/live/**";

export default defineConfig({
	test: {
		environment: "node",
		// Many tests spawn the bins and fake `claude`/`pnpm` binaries; under a loaded machine
		// the 5 s default timed some out. Generous, not a retry.
		testTimeout: 30_000,
		include: ["__tests__/**/*.test.ts"],
		exclude: ["**/node_modules/**", PACK_TEST, LIVE_TESTS],
		// Builds dist/ once, so the bin and package tests run against what would be published.
		globalSetup: ["./vitest.setup.ts"],
	},
});
