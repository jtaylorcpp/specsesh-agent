import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { killRunning, RUN_LIMIT_MS, startDetached } from "../live/spawn.js";
import liveConfig from "../../vitest.live.config.js";
import { BIN, FAKE_CLAUDE_CONFIG, gitRepo } from "./cli-helpers.js";
import { cleanTemps, temp } from "./helpers.js";

afterEach(() => {
	killRunning();
	cleanTemps();
});

/** A fake `claude` that writes its pid to `$STALL_PID_FILE` and never answers. */
function stallingClaude(): string {
	const bin = temp("live-stall-bin-");
	writeFileSync(
		join(bin, "claude"),
		`#!${process.execPath}\nrequire("node:fs").writeFileSync(process.env.STALL_PID_FILE, String(process.pid));\nsetInterval(() => {}, 1 << 30);\n`,
	);
	chmodSync(join(bin, "claude"), 0o755);
	return bin;
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** Polls until `pid` is gone; a killed orphan is reaped by init a moment later. */
async function gone(pid: number, withinMs = 5_000): Promise<boolean> {
	const until = Date.now() + withinMs;
	while (Date.now() < until) {
		if (!alive(pid)) return true;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	return !alive(pid);
}

async function waitFor(path: string, withinMs: number): Promise<void> {
	const until = Date.now() + withinMs;
	while (!existsSync(path) || readFileSync(path, "utf8") === "") {
		if (Date.now() > until) throw new Error(`${path} never appeared`);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

describe("task/headless: The live run never outlives its test", () => {
	it("Scenario: A stalled live run is killed with its children", async () => {
		const repo = gitRepo({ "agentscript.config.json": FAKE_CLAUDE_CONFIG });
		const bin = stallingClaude();
		const pidFile = join(temp("live-stall-pid-"), "claude.pid");
		const run = startDetached(process.execPath, [BIN, "run", "tiny", "1.1"], {
			cwd: repo,
			env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, STALL_PID_FILE: pidFile },
			limitMs: 8_000,
		});
		const failed = run.done.then(
			() => undefined,
			(error: Error) => error,
		);
		// The runner got as far as a model call: there is a `claude` child to kill.
		await waitFor(pidFile, 8_000);
		const claude = Number(readFileSync(pidFile, "utf8"));
		expect(alive(claude)).toBe(true);
		expect(alive(run.pid)).toBe(true);

		const error = await failed;
		expect(error?.message).toContain("the run was killed at the limit of 8000 ms");
		expect(await gone(run.pid)).toBe(true);
		expect(await gone(claude)).toBe(true);
	});

	it("each live run's limit is below the live test timeout", () => {
		expect(RUN_LIMIT_MS).toBeLessThan(liveConfig.test?.testTimeout as number);
	});

	it("killRunning kills a group still running, children and all", async () => {
		const bin = stallingClaude();
		const pidFile = join(temp("live-stall-pid-"), "claude.pid");
		// A parent that starts the stalling claude and waits on it, as the runner does.
		const run = startDetached(
			process.execPath,
			["-e", `require("node:child_process").spawn("claude", [], { stdio: "ignore" }); setInterval(() => {}, 1 << 30);`],
			{ cwd: bin, env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, STALL_PID_FILE: pidFile }, limitMs: 60_000 },
		);
		await waitFor(pidFile, 8_000);
		const claude = Number(readFileSync(pidFile, "utf8"));

		killRunning();
		const ended = await run.done;
		expect(ended.code).toBe(-1);
		expect(await gone(run.pid)).toBe(true);
		expect(await gone(claude)).toBe(true);
	});
});
