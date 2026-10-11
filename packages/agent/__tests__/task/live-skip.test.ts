import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import config, { LIVE_TESTS } from "../../vitest.config.js";
import liveConfig from "../../vitest.live.config.js";
import { claudeReady } from "../live/ready.js";
import { cleanTemps, temp } from "./helpers.js";

const saved = { path: process.env.PATH, force: process.env.AGENTSCRIPT_LIVE_FORCE };
afterEach(() => {
	process.env.PATH = saved.path;
	if (saved.force === undefined) delete process.env.AGENTSCRIPT_LIVE_FORCE;
	else process.env.AGENTSCRIPT_LIVE_FORCE = saved.force;
	cleanTemps();
});

/** Only a fake `claude` on PATH: `--version` works, `auth status` exits `authExit`. */
function fakeClaudeOnly(authExit: number): void {
	const bin = temp("live-bin-");
	writeFileSync(
		join(bin, "claude"),
		`#!${process.execPath}\nif (process.argv[2] === "auth") { process.stdout.write("Not logged in\\n"); process.exit(${authExit}); }\nprocess.stdout.write("9.9.9 (Claude Code)\\n");\n`,
	);
	chmodSync(join(bin, "claude"), 0o755);
	process.env.PATH = bin;
}

describe("task/headless: An opt-in live run proves it works on this repo", () => {
	it("Scenario: Without a Claude login the live run skips", () => {
		delete process.env.AGENTSCRIPT_LIVE_FORCE;
		process.env.PATH = temp("live-empty-");
		const missing = claudeReady();
		expect(missing.ok).toBe(false);
		expect(missing.ok ? "" : missing.reason).toContain("claude is not on PATH");

		fakeClaudeOnly(1);
		const loggedOut = claudeReady();
		expect(loggedOut.ok).toBe(false);
		expect(loggedOut.ok ? "" : loggedOut.reason).toContain("claude is not logged in");
		expect(loggedOut.ok ? "" : loggedOut.reason).toContain("Not logged in");

		fakeClaudeOnly(0);
		expect(claudeReady().ok).toBe(true);
	});

	it("is never part of pnpm test", () => {
		const live = join(dirname(fileURLToPath(import.meta.url)), "..", "live", "task.live.test.ts");
		expect(existsSync(live)).toBe(true);
		expect(config.test?.exclude).toContain(LIVE_TESTS);
		expect(liveConfig.test?.include).toEqual(["__tests__/live/**/*.live.test.ts"]);
	});
});
