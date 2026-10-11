import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RESULT_TOOL } from "../../src/durable/index.js";
import { FAKE_CLAUDE_CONFIG, cli, commitAll, events, fakeClaude, fauxModels, gitRepo, spawnBin, workdir } from "./cli-helpers.js";
import { GROUP_JUDGE, cleanTemps, tinyChange, toolCall, verdict } from "./helpers.js";

afterEach(() => cleanTemps());

// The group check as the CLI runs it: `node check.mjs <counter>`. It fails its first call, then passes.
// The tasks run only the judge script, so the group is the check's only caller.
const CHECK = `import { existsSync, readFileSync, writeFileSync } from "node:fs";
const file = process.argv[2];
const calls = (existsSync(file) ? Number(readFileSync(file, "utf8")) : 0) + 1;
writeFileSync(file, String(calls));
if (calls === 1) {
	console.log("REGRESSION: 1.1 broke 1.2");
	process.exit(1);
}
`;

/** Run group 1 of the tiny change in process, with the given group check and script turns. */
async function runGroup(check: string, responses: Parameters<ReturnType<typeof fauxModels>["faux"]["setResponses"]>[0], extra: string[] = []) {
	const { dir, script, db } = workdir();
	const groupScript = join(dir, "group.agent");
	writeFileSync(groupScript, GROUP_JUDGE);
	const env = fauxModels();
	env.faux.setResponses(responses);
	const r = await cli(
		["run", tinyChange(), "1", "--db", db, "--script", script, "--group-script", groupScript, "--workspace", dir, "--check", check, ...extra, ...env.args],
		env,
	);
	return { ...r, dir };
}

describe("task/headless: A group's stream (through the CLI)", () => {
	it("Scenario: A group's stream", async () => {
		const r = await runGroup("node --version", [verdict(true), verdict(true)]);
		expect(r.code, r.err).toBe(0);
		const stream = events(r.errLines);
		const kinds = stream.map((e) => e.event);

		expect(kinds.indexOf("group-started")).toBe(0);
		expect(stream[0]).toMatchObject({ group: 1, tasks: ["1.1", "1.2"] });
		const started = stream.filter((e) => e.event === "loop-started");
		expect(started.map((e) => e.task)).toEqual(["1.1", "1.2"]);
		for (const e of started) expect(e.group).toBe(1);
		const check = stream.find((e) => e.event === "group-check");
		expect(check).toMatchObject({ passed: true });
		expect((check?.commands as { exitCode: number }[])[0]?.exitCode).toBe(0);
		expect(kinds.lastIndexOf("group-ended")).toBe(kinds.length - 1);
		expect(stream.at(-1)).toMatchObject({ status: "converged" });

		// Order: group-started, task events, group-check, group-ended.
		expect(kinds.indexOf("loop-started")).toBeGreaterThan(kinds.indexOf("group-started"));
		expect(kinds.indexOf("group-check")).toBeGreaterThan(kinds.lastIndexOf("loop-ended"));
		expect(kinds.indexOf("group-ended")).toBeGreaterThan(kinds.indexOf("group-check"));
	});

	it("a rework streams a failed group-check, then a rework event with its reason", async () => {
		const { dir, script, db } = workdir();
		const groupScript = join(dir, "group.agent");
		writeFileSync(groupScript, GROUP_JUDGE);
		writeFileSync(join(dir, "check.mjs"), CHECK);
		const counter = join(dir, "counter");
		const env = fauxModels();
		// 1.1 and 1.2, the failed check and a rework of 1.1, 1.1 again, then the check passes.
		env.faux.setResponses([
			verdict(true),
			verdict(true),
			toolCall(RESULT_TOOL, { next_action: "rework", rework_task: "1.1", feedback: "restore the import", question: "" }),
			verdict(true),
		]);
		const r = await cli(
			["run", tinyChange(), "1", "--db", db, "--script", script, "--group-script", groupScript, "--workspace", dir, "--check", `${process.execPath} ${join(dir, "check.mjs")} ${counter}`, ...env.args],
			env,
		);
		expect(r.code, r.err).toBe(0);
		expect(existsSync(counter) && readFileSync(counter, "utf8")).toBe("2");

		const stream = events(r.errLines);
		const checks = stream.filter((e) => e.event === "group-check");
		expect(checks.map((e) => e.passed)).toEqual([false, true]);
		const rework = stream.find((e) => e.event === "rework");
		expect(rework).toMatchObject({ task: "1.1" });
		expect(String(rework?.reason)).not.toBe("");
		const kinds = stream.map((e) => e.event);
		expect(kinds.indexOf("group-check")).toBeLessThan(kinds.indexOf("rework"));
		expect(stream.at(-1)).toMatchObject({ event: "group-ended", status: "converged", tasks: [{ task: "1.1", runs: 2 }, { task: "1.2", runs: 1 }] });
	});
});

// The built bin on the fake `claude`, from the repo's own config.
const lines = (text: string) => text.split("\n").filter((l) => l !== "");
const TWO_GROUPS = "## 1. Done\n\n- [x] 1.1 done\n\n## 2. Open\n\n- [ ] 2.1 first\n- [ ] 2.2 second\n";

describe("task/cli: groups through the built bin", () => {
	it("Scenario: A bare integer runs a group", async () => {
		const repo = gitRepo({ "agentscript.config.json": FAKE_CLAUDE_CONFIG });
		const r = await spawnBin(["run", "tiny", "1"], { cwd: repo, bin: fakeClaude() });
		expect(r.code, r.stderr).toBe(0);
		expect(r.stdout.startsWith("# group loop")).toBe(true);
		expect(events(lines(r.stderr)).some((e) => e.event === "group-started")).toBe(true);
		const tasks = readFileSync(join(repo, "openspec/changes/tiny/tasks.md"), "utf8");
		expect(tasks).toContain("- [x] 1.1 ");
		expect(tasks).toContain("- [x] 1.2 ");
		// The config's database is where the loop was stored.
		expect(existsSync(join(repo, ".agentscript", "task-loops.sqlite"))).toBe(true);
		const status = await spawnBin(["status"], { cwd: repo, bin: fakeClaude() });
		expect(status.stdout).toContain("  group 1  converged");
	});

	it("Scenario: --next-group skips a finished group", async () => {
		const repo = gitRepo({ "agentscript.config.json": FAKE_CLAUDE_CONFIG, "openspec/changes/tiny/tasks.md": TWO_GROUPS });
		const r = await spawnBin(["run", "tiny", "--next-group"], { cwd: repo, bin: fakeClaude() });
		expect(r.code, r.stderr).toBe(0);
		expect(events(lines(r.stderr)).find((e) => e.event === "group-started")).toMatchObject({ group: 2, tasks: ["2.1", "2.2"] });

		commitAll(repo);
		const done = await spawnBin(["run", "tiny", "--next-group"], { cwd: repo, bin: fakeClaude() });
		expect(done.stdout.trim()).toBe("no unticked task in tiny");
		expect(done.code).toBe(0);
	});

	it("Scenario: A blocked loop exits 1, and the wrong recipient exits 2", async () => {
		const repo = gitRepo({ "agentscript.config.json": FAKE_CLAUDE_CONFIG });
		const bin = fakeClaude({ verdicts: ["ask"] });
		const blocked = await spawnBin(["run", "tiny", "1"], { cwd: repo, bin });
		expect(blocked.code, blocked.stderr).toBe(1);
		const id = /^loop (\d+) — resume with: /.exec(blocked.stderr)?.[1];
		expect(id, blocked.stderr).toBeDefined();
		expect(lines(blocked.stdout).at(-1)).toBe(
			`agentscript-task answer ${id} --db ${join(repo, ".agentscript", "task-loops.sqlite")} --by principal --decision "…"`,
		);

		const wrong = await spawnBin(["answer", id!, "--by", "agent", "--decision", "go"], { cwd: repo, bin });
		expect(wrong.code).toBe(2);

		// The principal's answer reruns 1.1, then 1.2.
		const right = await spawnBin(["answer", id!, "--by", "principal", "--decision", "The first way"], { cwd: repo, bin });
		expect(right.code, right.stderr).toBe(0);
		expect(right.stdout).toContain("## task 1.1: converged (runs 2)");
		expect(right.stdout).toContain("## task 1.2: converged (runs 1)");
	});
});
