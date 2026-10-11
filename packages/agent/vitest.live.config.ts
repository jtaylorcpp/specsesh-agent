import { defineConfig } from "vitest/config";
import { LIVE_TESTS } from "./vitest.config.js";

// `pnpm test:live`: the task runner on your Claude subscription, against a copy of this repo.
// Real model calls, so the default config excludes these files and only this config runs them.
export default defineConfig({
	test: {
		environment: "node",
		include: [LIVE_TESTS.replace("**", "**/*.live.test.ts")],
		globalSetup: ["./vitest.setup.ts"],
		testTimeout: 1_800_000,
		hookTimeout: 600_000,
		fileParallelism: false,
	},
});
