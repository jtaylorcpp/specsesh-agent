import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseLockedError, isAlive, lockDatabase } from "../../src/task/lock.js";
import { FAKE_CLAUDE_CONFIG, cli, events, fakeClaude, fauxModels, gitRepo, spawnBin, storedLoops, workdir } from "./cli-helpers.js";
import { cleanTemps, tinyChange, verdict } from "./helpers.js";

afterEach(() => cleanTemps());

/** The pid of a process that has already exited. */
function deadPid(): number {
	const ran = spawnSync(process.execPath, ["-e", ""]);
	expect(isAlive(ran.pid as number)).toBe(false);
	return ran.pid as number;
}

describe("task/headless: A database is held by one live process", () => {
	it("Scenario: A second process on the same database is refused", async () => {
		const repo = gitRepo({ "agentscript.config.json": FAKE_CLAUDE_CONFIG });
		const bin = fakeClaude();
		const db = join(repo, ".agentscript", "task-loops.sqlite");
		let second: Promise<Awaited<ReturnType<typeof spawnBin>>> | undefined;
		let holder = "";
		const first = await spawnBin(["run", "tiny", "1.1"], {
			cwd: repo,
			bin,
			env: { FAKE_CLAUDE_SLEEP_MS: "1500" },
			onStderr: (text) => {
				if (second === undefined && text.includes('"event":"loop-started"')) {
					holder = readFileSync(`${db}.lock`, "utf8").trim();
					second = spawnBin(["run", "tiny", "1.2", "--allow-dirty"], { cwd: repo, bin });
				}
			},
		});
		const refused = await (second as Promise<Awaited<ReturnType<typeof spawnBin>>>);
		expect(refused.code).toBe(2);
		expect(refused.stderr).toContain(`process ${holder}`);
		expect(holder).toBe(String(first.pid));
		// The first loop carried on to its end and released the lock.
		expect(first.code, first.stderr).toBe(0);
		expect(events(first.stderr.trimEnd().split("\n")).at(-1)).toMatchObject({ event: "loop-ended", status: "converged" });
		expect((await storedLoops(db)).inputs.map((i) => i.task)).toEqual(["1.1"]);
		expect(existsSync(`${db}.lock`)).toBe(false);
	});

	it("Scenario: A stale lock is taken over", async () => {
		const { script, db } = workdir();
		const pid = deadPid();
		writeFileSync(`${db}.lock`, String(pid));
		const env = fauxModels();
		env.faux.setResponses([verdict(true)]);
		const r = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", script, ...env.args], env);
		expect(r.code, r.err).toBe(0);
		const warning = events(r.errLines).find((e) => e["event"] === "warning" && String(e["message"]).includes("stale lock"));
		expect(String(warning?.["message"])).toContain(String(pid));
		expect(existsSync(`${db}.lock`)).toBe(false);
	});

	it("a live holder in this very process refuses run, resume and answer, naming its pid", async () => {
		const { script, db } = workdir();
		const env = fauxModels();
		env.faux.setResponses([verdict(true)]);
		const done = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", script, ...env.args], env);
		const id = /^loop (\d+)/.exec(done.errLines[0] ?? "")?.[1];
		const lock = lockDatabase(db);
		try {
			expect(() => lockDatabase(db)).toThrow(DatabaseLockedError);
			for (const argv of [
				["run", tinyChange(), "1.1", "--db", db, "--script", script, ...env.args],
				["resume", String(id), "--db", db],
				["answer", String(id), "--db", db, "--by", "principal", "--decision", "d"],
			]) {
				const r = await cli(argv, env);
				expect(r.code, argv[0]).toBe(2);
				expect(r.err).toContain(`process ${process.pid}`);
			}
			expect((await storedLoops(db)).loops).toHaveLength(1);
		} finally {
			lock.release();
		}
		expect(existsSync(`${db}.lock`)).toBe(false);
	});

	it("the lock is released when a run is refused after taking it", async () => {
		const { script, db } = workdir();
		const env = fauxModels();
		const r = await cli(["run", tinyChange(), "9.9", "--db", db, "--script", script, ...env.args], env);
		expect(r.code).toBe(2);
		expect(existsSync(db)).toBe(true);
		expect(existsSync(`${db}.lock`)).toBe(false);
	});
});
