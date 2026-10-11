import { defineConfig } from "vitest/config";
import { PACK_TEST } from "./vitest.config.js";

// `pnpm pack:check`: pack the package and install it into empty projects. Needs the npm registry,
// so the default config excludes this file and only this config runs it.
export default defineConfig({
	test: {
		environment: "node",
		include: [PACK_TEST],
		globalSetup: ["./vitest.setup.ts"],
		testTimeout: 120_000,
		hookTimeout: 300_000,
	},
});
