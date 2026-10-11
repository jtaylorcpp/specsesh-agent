import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { exitFor, formatGroupOutcome } from "../../src/bin/agentscript-task.js";
import { RESULT_TOOL } from "../../src/durable/index.js";
import type { GroupOutcome, LoopOutcome } from "../../src/openspec/index.js";
import { groupLoopExtensions, startGroupLoop } from "../../src/task/index.js";
import { FAKE_CLAUDE_CONFIG, cli, fauxModels, gitRepo, spawnBin, workdir } from "./cli-helpers.js";
import { GROUP_JUDGE, JUDGE_ONLY, cleanTemps, context, temp, tinyChange, toolCall, verdict } from "./helpers.js";

afterEach(() => cleanTemps());

/**
 * A fake `claude` that converges every task and logs `{ task, step }` to `calls.log` beside it.
 * Its first orient call for 1.2 logs `killed: true` and SIGKILLs its parent, the CLI.
 */
function killingClaude(): string {
	const bin = temp("task-kill-bin-");
	const path = join(bin, "claude");
	writeFileSync(
		path,
		`#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
let stdin = "";
try { stdin = fs.readFileSync(0, "utf8"); } catch {}
const text = stdin + "\\n" + argv.join("\\n");
const log = (entry) => fs.appendFileSync(path.join(__dirname, "calls.log"), JSON.stringify(entry) + "\\n");
const schemaAt = argv.indexOf("--json-schema");
let out;
if (schemaAt >= 0) {
	const schema = JSON.parse(argv[schemaAt + 1]);
	const task = /Task (\\d+\\.\\d+)/.exec(text)?.[1];
	if (!("next_action" in (schema.properties || {}))) {
		const marker = path.join(__dirname, "killed");
		if (task === "1.2" && !fs.existsSync(marker)) {
			fs.writeFileSync(marker, "");
			log({ task, step: "orient", killed: true });
			process.kill(process.ppid, "SIGKILL");
			process.exit(137);
		}
		log({ task, step: "orient" });
		out = { type: "result", is_error: false, result: "", structured_output: { plan: "plan for " + task } };
	} else {
		log({ task, step: "judge" });
		out = { type: "result", is_error: false, result: "", structured_output: { met: true, unmet: "", next_action: "retry", question: "" } };
	}
} else {
	const task = /plan for (\\d+\\.\\d+)/.exec(text)?.[1];
	log({ task, step: "delegate" });
	fs.writeFileSync(path.join(process.cwd(), "done-" + task + ".txt"), "done\\n");
	out = { type: "result", is_error: false, result: "Wrote done-" + task + ".txt" };
}
process.stdout.write(JSON.stringify(out));
`,
	);
	chmodSync(path, 0o755);
	return bin;
}

const PASSING = "node --version";
const FAILING = "node -e process.exit(1)";

/** The id in the first stderr line, `loop <id> — resume with: …`. */
const idOf = (errLines: readonly string[]) => Number(/^loop (\d+) — resume with: /.exec(errLines[0] ?? "")?.[1]);

/** Run group 1 of the tiny change on the faux model; `over` adds or replaces flags. */
async function runGroupOnce(responses: Parameters<ReturnType<typeof fauxModels>["faux"]["setResponses"]>[0], extra: string[] = []) {
	const { dir, script, db } = workdir();
	const env = fauxModels();
	env.faux.setResponses(responses);
	const r = await cli(
		["run", tinyChange(), "1", "--db", db, "--script", script, "--workspace", dir, "--check", PASSING, ...extra, ...env.args],
		env,
	);
	return { ...r, dir, db, script, env, id: idOf(r.errLines) };
}

const ask = verdict(false, "two ways", "ask", "Which way?");

describe("task/headless: status lists the loops in the database", () => {
	it("Scenario: A group loop and its task loops are listed", async () => {
		const g = await runGroupOnce([verdict(true), verdict(true)]);
		expect(g.code, g.err).toBe(0);
		const r = await cli(["status", "--db", g.db]);
		expect(r.code).toBe(0);
		const lines = r.out.split("\n");
		expect(lines).toHaveLength(3);
		expect(lines.at(-1)).toBe(`loop ${g.id}  tiny  group 1  converged  1 iteration`);
		expect(lines.filter((l) => l.includes("  1.1  converged"))).toHaveLength(1);
		expect(lines.filter((l) => l.includes("  1.2  converged"))).toHaveLength(1);
	});
});

describe("task/cli: Text output for a group lists its tasks and the group check", () => {
	it("Scenario: A converged group prints its tasks", async () => {
		const b = await runGroupOnce([ask]);
		expect(b.code).toBe(1);
		expect(b.errLines[0]).toBe(`loop ${b.id} — resume with: agentscript-task resume ${b.id} --db ${b.db}`);
		// Answering reruns 1.1 (its second run), then 1.2.
		b.env.faux.setResponses([verdict(true), verdict(true)]);
		const r = await cli(["answer", String(b.id), "--db", b.db, "--by", "principal", "--decision", "The first way"], b.env);
		expect(r.code, r.err).toBe(0);
		expect(r.out).toContain("# group loop");
		expect(r.out).toContain("converged");
		expect(r.out).toContain("## task 1.1: converged (runs 2)");
		expect(r.out).toContain("## task 1.2: converged (runs 1)");
		expect(r.out).toContain("## group check: passed");
	});

	it("a blocked group ends with the answer command", async () => {
		const { dir, script } = workdir();
		const env = fauxModels();
		env.faux.setResponses([ask]);
		const r = await cli(
			["run", tinyChange(), "1", "--db", "loops.sqlite", "--script", script, "--workspace", dir, "--check", PASSING, ...env.args],
			env,
			{ cwd: dir },
		);
		expect(r.code).toBe(1);
		const lines = r.out.split("\n");
		expect(lines[0]).toBe(`# group loop ${idOf(r.errLines)} — blocked`);
		expect(lines).toContain("## task 1.1: blocked (runs 1)");
		expect(lines).toContain("to: principal");
		expect(lines).toContain("question: Which way?");
		expect(lines.at(-1)).toBe(`agentscript-task answer ${idOf(r.errLines)} --db loops.sqlite --by principal --decision "…"`);
	});

	it("formatGroupOutcome names each task's runs and the last round", () => {
		const entry = (task: string, runs: number) => ({ task, runs, outcome: { status: "converged", iterations: [] } });
		const round = (met: boolean) => ({ n: 1, plan: "", actions: [], evidence: [], verdict: { met, satisfied: [], unmet: [] }, feedback: [] });
		const outcome = (iterations: unknown[]) =>
			({ status: "converged", iterations, result: { group: 1, tasks: [entry("1.1", 2), entry("1.2", 1)] } }) as unknown as LoopOutcome<GroupOutcome>;
		expect(formatGroupOutcome(7, outcome([round(false), round(true)]), "x.sqlite")).toEqual([
			"# group loop 7 — converged",
			"## task 1.1: converged (runs 2)",
			"## task 1.2: converged (runs 1)",
			"## group check: passed",
		]);
		// A group that ended before any check has no check line.
		expect(formatGroupOutcome(7, outcome([]), "x.sqlite").some((l) => l.startsWith("## group check"))).toBe(false);
		expect(formatGroupOutcome(7, outcome([round(false)]), "x.sqlite").at(-1)).toBe("## group check: failed");
	});
});

describe("task/cli: JSON output is the loop id merged with the outcome", () => {
	it("Scenario: JSON for a group carries its tasks", async () => {
		const r = await runGroupOnce([verdict(true), verdict(true)], ["--json"]);
		const parsed = JSON.parse(r.out);
		expect(Number.isInteger(parsed.loop)).toBe(true);
		expect(parsed.status).toBe("converged");
		expect(parsed.result.tasks.map((t: { task: string }) => t.task)).toEqual(["1.1", "1.2"]);
	});
});

describe("task/cli: The exit code says whether the loop converged", () => {
	it("maps converged to 0 and every other status to 1", () => {
		expect(exitFor({ status: "converged" })).toBe(0);
		for (const status of ["blocked", "exhausted", "failed"]) expect(exitFor({ status })).toBe(1);
	});

	it("Scenario: An exhausted group exits 1", async () => {
		const { dir, script, db } = workdir();
		const groupScript = join(dir, "group.agent");
		writeFileSync(groupScript, GROUP_JUDGE);
		const rework = toolCall(RESULT_TOOL, { next_action: "rework", rework_task: "1.1", feedback: "again", question: "" });
		const env = fauxModels();
		// Both tasks, a failed check and a rework of 1.1, then a failed check with the one rework spent.
		env.faux.setResponses([verdict(true), verdict(true), rework, verdict(true), rework]);
		const r = await cli(
			["run", tinyChange(), "1", "--db", db, "--script", script, "--group-script", groupScript, "--workspace", dir, "--check", FAILING, "--max-reworks", "1", ...env.args],
			env,
		);
		expect(r.out).toContain("— exhausted");
		expect(r.out).toContain("## group check: failed");
		expect(r.code).toBe(1);
	});
});

describe("task/cli: resume continues a stored loop without the change files", () => {
	it("Scenario: A group loop is resumed", async () => {
		const { dir, db } = workdir();
		const env = fauxModels();
		// Created by a process that never ran it; resume finishes the whole group.
		const registry = createRegistry();
		for (const extension of groupLoopExtensions({ workspace: dir, checks: [PASSING] })) registry.install(extension);
		const harness = await Harness.open(await openNodeSqliteStorage(db), { models: env.models, registry }, context);
		const model = env.models.getModel(env.args[1]!, env.args[3]!)!;
		const id = await startGroupLoop(
			harness,
			{ change: { dir: tinyChange() }, group: 1, script: { text: JUDGE_ONLY }, workspace: dir, checks: [PASSING], model: { provider: model.provider, modelId: model.id } },
			context,
		);
		await harness.close(context);

		env.faux.setResponses([verdict(true), verdict(true)]);
		const r = await cli(["resume", String(id), "--db", db], env);
		expect(r.code, r.err).toBe(0);
		expect(r.out).toContain(`# group loop ${id} — converged`);
		expect(r.out).toContain("## task 1.2: converged (runs 1)");

		// Resuming a loop that has already ended prints the same outcome.
		const again = await cli(["resume", String(id), "--db", db, "--json"], env);
		expect(JSON.parse(again.out).status).toBe("converged");
	});

	it("resume continues a group loop killed during task 1.2", async () => {
		const repo = gitRepo({ "agentscript.config.json": FAKE_CLAUDE_CONFIG });
		const db = join(temp("group-kill-db-"), "loops.sqlite");
		const bin = killingClaude();
		const tasksMd = join(repo, "openspec/changes/tiny/tasks.md");

		// The first call for 1.2 SIGKILLs the CLI, which is the fake's parent.
		const killed = await spawnBin(["run", "tiny", "1", "--db", db], { cwd: repo, bin });
		expect(killed.code).not.toBe(0);
		const id = /^loop (\d+) — resume with: agentscript-task resume \1 --db /.exec(killed.stderr)?.[1];
		expect(id, killed.stderr).toBeDefined();
		expect(readFileSync(tasksMd, "utf8")).toContain("- [x] 1.1 ");
		expect(readFileSync(tasksMd, "utf8")).toContain("- [ ] 1.2 ");
		const midway = (await cli(["status", "--db", db])).out.split("\n");
		expect(midway.some((l) => new RegExp(`^loop ${id} {2}tiny {2}group 1 {2}running`).test(l))).toBe(true);
		expect(midway.some((l) => l.includes("  1.2  running"))).toBe(true);

		const resumed = await spawnBin(["resume", id!, "--db", db], { cwd: repo, bin });
		expect(resumed.code, resumed.stderr).toBe(0);
		expect(resumed.stdout).toContain(`# group loop ${id} — converged`);
		expect(resumed.stdout).toContain("## task 1.1: converged (runs 1)");
		expect(resumed.stdout).toContain("## task 1.2: converged (runs 1)");
		expect(resumed.stdout).toContain("## group check: passed");

		// 1.1 was not run again after the kill.
		const calls = readFileSync(join(bin, "calls.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { task: string; killed?: true });
		const killedAt = calls.findIndex((c) => c.killed === true);
		expect(killedAt).toBeGreaterThan(-1);
		expect(calls.slice(killedAt + 1).filter((c) => c.task === "1.1")).toEqual([]);
		expect(calls.slice(killedAt + 1).some((c) => c.task === "1.2")).toBe(true);

		// One task loop each, so the group reused its child.
		const after = (await cli(["status", "--db", db])).out.split("\n");
		expect(after).toHaveLength(3);
		expect(after.filter((l) => l.includes("  1.1  converged"))).toHaveLength(1);
		expect(after.filter((l) => l.includes("  1.2  converged"))).toHaveLength(1);
		expect(after.filter((l) => l.includes("  group 1  converged"))).toHaveLength(1);
		const ticked = readFileSync(tasksMd, "utf8");
		expect(ticked).toContain("- [x] 1.1 ");
		expect(ticked).toContain("- [x] 1.2 ");

		const again = JSON.parse((await spawnBin(["resume", id!, "--db", db, "--json"], { cwd: repo, bin })).stdout);
		expect(again.status).toBe("converged");
		expect(again.result.tasks.map((t: { task: string; runs: number; outcome: { status: string } }) => ({ task: t.task, runs: t.runs, status: t.outcome.status }))).toEqual([
			{ task: "1.1", runs: 1, status: "converged" },
			{ task: "1.2", runs: 1, status: "converged" },
		]);
	});
});

describe("task/cli: answer submits an escalation answer and waits for the resumed loop", () => {
	it("Scenario: The wrong recipient exits 2", async () => {
		const b = await runGroupOnce([ask]);
		expect(b.code).toBe(1);
		const r = await cli(["answer", String(b.id), "--db", b.db, "--by", "agent", "--decision", "go"], b.env);
		expect(r.code).toBe(2);
		expect(r.err).toContain("goes to the principal, not the agent");
		const again = await cli(["resume", String(b.id), "--db", b.db, "--json"], b.env);
		expect(JSON.parse(again.out).status).toBe("blocked");
	});

	it("an answer to a group that is not blocked exits 2", async () => {
		const g = await runGroupOnce([verdict(true), verdict(true)]);
		const r = await cli(["answer", String(g.id), "--db", g.db, "--by", "principal", "--decision", "d"], g.env);
		expect(r.code).toBe(2);
		expect(r.err).toContain("has not ended blocked");
	});
});
