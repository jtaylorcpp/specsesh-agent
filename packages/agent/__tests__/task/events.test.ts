import { closeSync, openSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BIN, FAKE_CLAUDE_CONFIG, events, fakeClaude, gitRepo, spawnBin, write } from "./cli-helpers.js";
import { cleanTemps, temp } from "./helpers.js";

afterEach(() => cleanTemps());

/** A committed repo with the fake-claude config, and extra config fields merged into `task`. */
function repoWithConfig(task: Record<string, unknown> = {}) {
	const config = JSON.parse(FAKE_CLAUDE_CONFIG) as { task: Record<string, unknown> };
	return gitRepo({ "agentscript.config.json": JSON.stringify({ ...config, task: { ...config.task, ...task } }) });
}

const lines = (stderr: string) => stderr.trimEnd().split("\n");

describe("task/headless: The CLI is headless", () => {
	it("Scenario: It runs with no terminal", async () => {
		const repo = repoWithConfig();
		const bin = fakeClaude();
		const dir = temp("task-out-");
		const outFd = openSync(join(dir, "out.txt"), "w");
		const errFd = openSync(join(dir, "err.txt"), "w");
		const code = await new Promise<number>((resolve, reject) => {
			const child = spawn(process.execPath, [BIN, "run", "tiny", "1.1"], {
				cwd: repo,
				env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
				// stdin closed, stdout and stderr files: no TTY anywhere.
				stdio: ["ignore", outFd, errFd],
			});
			child.on("error", reject);
			child.on("close", (c) => resolve(c ?? -1));
		});
		closeSync(outFd);
		closeSync(errFd);
		expect(code, readFileSync(join(dir, "err.txt"), "utf8")).toBe(0);
		expect(readFileSync(join(dir, "out.txt"), "utf8")).toContain("converged");
	});
});

describe("task/headless: Progress is a JSON Lines stream on stderr", () => {
	it("Scenario: Every stderr line after the hint is JSON", async () => {
		const repo = repoWithConfig();
		const r = await spawnBin(["run", "tiny", "1.1"], { cwd: repo, bin: fakeClaude({ verdicts: ["retry", "met"] }) });
		expect(r.code, r.stderr).toBe(0);
		const errLines = lines(r.stderr);
		expect(errLines[0]).toMatch(/^loop \d+ — resume with: /);
		const parsed = events(errLines);
		expect(parsed.length).toBeGreaterThan(0);
		for (const event of parsed) {
			expect(typeof event["event"]).toBe("string");
			expect(Number.isInteger(event["loop"])).toBe(true);
		}
		expect(parsed.filter((e) => e["event"] === "iteration-started").map((e) => e["iteration"])).toEqual([1, 2]);
		// The outcome is on stdout, never in the stream.
		expect(r.stdout).toContain("— converged");
		expect(r.stderr).not.toContain("# loop");
	});
});

describe("task/headless: The stream has six event kinds", () => {
	it("Scenario: A converged loop's stream", async () => {
		const repo = repoWithConfig();
		const r = await spawnBin(["run", "tiny", "1.1"], { cwd: repo, bin: fakeClaude() });
		expect(r.code, r.stderr).toBe(0);
		const parsed = events(lines(r.stderr));
		const kinds = parsed.map((e) => e["event"]);
		const started = kinds.indexOf("loop-started");
		const iteration = parsed.findIndex((e) => e["event"] === "iteration-started" && e["iteration"] === 1);
		const verdict = parsed.findIndex((e) => e["event"] === "verdict" && e["met"] === true);
		const ended = parsed.findIndex((e) => e["event"] === "loop-ended" && e["status"] === "converged");
		expect(started).toBe(0);
		expect(iteration).toBeGreaterThan(started);
		expect(verdict).toBeGreaterThan(iteration);
		expect(ended).toBe(parsed.length - 1);
		expect(parsed[started]).toMatchObject({ change: "tiny", task: "1.1", script: "task-delegate" });
		expect(Date.parse(String(parsed[started]?.["at"]))).not.toBeNaN();
		expect(Date.parse(String(parsed[iteration]?.["at"]))).not.toBeNaN();
		expect(parsed[verdict]).toMatchObject({ iteration: 1, unmet: "", next: "done" });
		expect(parsed[ended]).toMatchObject({ iterations: 1, ticked: true });
		const action = parsed.find((e) => e["event"] === "action");
		expect(action).toMatchObject({ iteration: 1, kind: "delegate", summary: "edit src/a.ts", refs: ["delegate/claude_code"] });
	});

	it("Scenario: A check becomes an evidence event", async () => {
		const repo = repoWithConfig({ checks: ["pnpm test"], allow: ["pnpm"] });
		// pnpm exits 0 so the gate after the met verdict passes: it adds no event of its own, so the
		// script's `run_checks` step is the only source of check evidence.
		const r = await spawnBin(["run", "tiny", "1.1"], { cwd: repo, bin: fakeClaude({ pnpmExit: 0 }) });
		expect(r.code, r.stderr).toBe(0);
		const evidence = events(lines(r.stderr)).filter((e) => e["event"] === "evidence" && e["kind"] === "check" && e["command"] === "pnpm test");
		expect(evidence).toHaveLength(1);
		expect(evidence[0]).toMatchObject({ iteration: 1, exitCode: 0 });
		expect(String(evidence[0]?.["output"])).toContain("fake pnpm test");
	});
});

describe("task/headless: loop-ended lists the files the loop changed", () => {
	it("Scenario: Only the edited file is listed", async () => {
		const repo = repoWithConfig();
		const r = await spawnBin(["run", "tiny", "1.1"], { cwd: repo, bin: fakeClaude() });
		expect(r.code, r.stderr).toBe(0);
		const ended = events(lines(r.stderr)).find((e) => e["event"] === "loop-ended");
		// tasks.md was ticked (ticked: true) and the database written, but neither is the loop's work.
		expect(ended).toMatchObject({ ticked: true, changed: ["src/a.ts"] });
		expect(readFileSync(join(repo, "openspec/changes/tiny/tasks.md"), "utf8")).toContain("- [x] 1.1 ");
		expect(r.stdout).toContain("changed (uncommitted): src/a.ts");
	});

	it("a further edit to a file that was already dirty still counts, under --allow-dirty", async () => {
		const repo = repoWithConfig();
		write(repo, { "src/a.ts": "export const a = 2;\n", "notes.txt": "untouched\n" });
		const r = await spawnBin(["run", "tiny", "1.1", "--allow-dirty"], { cwd: repo, bin: fakeClaude() });
		expect(r.code, r.stderr).toBe(0);
		const ended = events(lines(r.stderr)).find((e) => e["event"] === "loop-ended");
		expect(ended?.["changed"]).toEqual(["src/a.ts"]);
	});

	it("resume and answer stream events too", async () => {
		const repo = repoWithConfig();
		const bin = fakeClaude({ verdicts: ["ask"] });
		const blocked = await spawnBin(["run", "tiny", "1.1"], { cwd: repo, bin });
		expect(blocked.code).toBe(1);
		const id = /^loop (\d+)/.exec(blocked.stderr)?.[1];
		const answer = blocked.stdout.trimEnd().split("\n").at(-1) ?? "";
		expect(answer).toMatch(new RegExp(`^agentscript-task answer ${id} --db .*task-loops\\.sqlite --by principal --decision "…"$`));
		const answered = await spawnBin(["answer", String(id), "--by", "principal", "--decision", "the first way"], { cwd: repo, bin });
		expect(answered.code, answered.stderr).toBe(0);
		const parsed = events(lines(answered.stderr));
		expect(parsed[0]).toMatchObject({ event: "loop-started", change: "tiny", task: "1.1", script: "task-delegate" });
		// The answered run numbers on from the blocked run's iteration.
		expect(parsed.filter((e) => e["event"] === "iteration-started").map((e) => e["iteration"])).toEqual([2]);
		expect(parsed.at(-1)).toMatchObject({ event: "loop-ended", status: "converged", iterations: 2 });
	});
});
