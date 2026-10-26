import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { openNodeSqliteDatabase, openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { DEFAULT_MODEL, DEFAULT_PROVIDER, groupLoopOptions, main } from "../../src/bin/agentscript-task.js";
import { startTaskLoop, taskLoopExtensions, type SpecStage } from "../../src/task/index.js";
import { cli, fauxModels, storedLoops, workdir } from "./cli-helpers.js";
import { draft, proposalStage } from "./spec-helpers.js";
import { JUDGE_ONLY, JUDGE_ONLY_ASSIGNING, baselineDir, cleanTemps, context, fakePnpm, temp, tinyChange, verdict } from "./helpers.js";
import { closedPortUrl, startFakeOllama, type FakeOllama, type FakeOllamaReply } from "../pi/fake-ollama.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TS_HOOK = join(HERE, "..", "durable", "fixtures", "ts-resolve.mjs");

// Every harness the CLI builds, as built: how a test sees the models it was given. Passes through otherwise.
const built = vi.hoisted(() => [] as { models: Record<string, unknown> }[]);
vi.mock("../../src/durable/harness.js", async (original) => {
	const actual = await original<typeof import("../../src/durable/harness.js")>();
	return {
		...actual,
		createAgentHarness: async (...args: Parameters<typeof actual.createAgentHarness>) => {
			const harness = await actual.createAgentHarness(...args);
			built.push(harness);
			return harness;
		},
	};
});

// A met verdict with checks goes to the gate, which runs `pnpm`: a fake one that exits 0 keeps these tests offline.
let restorePath: (() => void) | undefined;
beforeEach(() => {
	restorePath = fakePnpm();
});
afterEach(() => {
	restorePath?.();
	cleanTemps();
});

describe("task/cli: run maps its flags onto the task loop options", () => {
	it("Scenario: Repeated checks are kept in order", async () => {
		const { script, db } = workdir();
		const env = fauxModels();
		env.faux.setResponses([verdict(true)]);
		const r = await cli(
			["run", tinyChange(), "1.1", "--db", db, "--script", script, ...env.args, "--check", "pnpm test", "--check", "pnpm check", "--allow", "pnpm", "--max-iterations", "2", "--escalate-to", "agent"],
			env,
		);
		expect(r.code, r.err).toBe(0);
		const { inputs } = await storedLoops(db);
		expect(inputs[0]?.checks).toEqual(["pnpm test", "pnpm check"]);
		expect(inputs[0]).toMatchObject({ allow: ["pnpm"], budget: { maxIterations: 2 }, escalateTo: "agent", script: JUDGE_ONLY });
	});

	it("Scenario: The workspace defaults to the current directory", async () => {
		const { script, db } = workdir();
		const env = fauxModels();
		env.faux.setResponses([verdict(true)]);
		const cwd = temp("task-cwd-");
		const r = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", script, ...env.args], env, { cwd });
		expect(r.code, r.err).toBe(0);
		const { inputs } = await storedLoops(db);
		expect(inputs[0]?.workspace).toBe(cwd);
	});

	it("--workspace and no --script: the given workspace and the bundled task.agent", async () => {
		const { db } = workdir();
		const workspace = temp("task-ws-");
		const env = fauxModels();
		// A text answer to orient fails the run; the loop still records what it was given.
		const r = await cli(["run", tinyChange(), "1.1", "--db", db, "--workspace", workspace, ...env.args, "--max-iterations", "1"], env);
		expect(r.code).toBe(1);
		const { inputs } = await storedLoops(db);
		expect(inputs[0]?.workspace).toBe(workspace);
		expect(inputs[0]?.script).toContain('agent_name: "task-agent"');
	});
});

describe("task/cli: run rejects malformed flag values with usage", () => {
	it("Scenario: A zero budget is refused", async () => {
		const { db } = workdir();
		const r = await cli(["run", baselineDir(), "2.4", "--db", db, "--max-iterations", "0"]);
		expect(r.code).toBe(2);
		expect(r.errLines[0]).toContain("--max-iterations");
		expect(r.errLines[0]).toContain('"0"');
		expect(r.err).toContain("usage:");
		expect(existsSync(db)).toBe(false);
	});

	it("refuses a non-number budget and an unknown recipient", async () => {
		const { db } = workdir();
		const abc = await cli(["run", baselineDir(), "2.4", "--db", db, "--max-iterations", "abc"]);
		expect(abc.code).toBe(2);
		expect(abc.err).toContain('--max-iterations must be a positive integer, got "abc"');
		const nobody = await cli(["run", baselineDir(), "2.4", "--db", db, "--escalate-to", "nobody"]);
		expect(nobody.code).toBe(2);
		expect(nobody.err).toContain('--escalate-to must be principal or agent, got "nobody"');
		expect(existsSync(db)).toBe(false);
	});
});

describe("task/cli: group flags", () => {
	it("Scenario: A zero rework budget is refused", async () => {
		const { db } = workdir();
		const r = await cli(["run", baselineDir(), "2", "--db", db, "--max-reworks", "0"]);
		expect(r.code).toBe(2);
		expect(r.errLines[0]).toContain("--max-reworks");
		expect(r.errLines[0]).toContain('"0"');
		expect(r.err).toContain("usage:");
		expect(existsSync(db)).toBe(false);
		const abc = await cli(["run", baselineDir(), "2", "--db", db, "--max-reworks", "abc"]);
		expect(abc.code).toBe(2);
		expect(existsSync(db)).toBe(false);
	});

	it("Scenario: A missing group script is refused", async () => {
		const { db, dir } = workdir();
		const r = await cli(["run", tinyChange(), "1", "--db", db, "--group-script", "./nope.agent"], fauxModels(), { cwd: dir });
		expect(r.code).toBe(2);
		expect(r.err).toContain("./nope.agent");
		expect(existsSync(db)).toBe(false);
	});

	it("Scenario: A rework budget from the flag", () => {
		const base = { change: { dir: "c" }, workspace: "w" } as Parameters<typeof groupLoopOptions>[0];
		const script = { label: "group", path: "/g.agent" };
		const options = groupLoopOptions(base, 2, script, { maxIterations: 3, maxReworks: 1 });
		expect(options).toMatchObject({ group: 2, groupScript: { path: "/g.agent" }, budget: { maxIterations: 3, maxReworks: 1 } });
	});
});

describe("task/cli: run resolves provider and model like agentscript-durable", () => {
	it("Scenario: Defaults apply when nothing is set", async () => {
		const { script, db } = workdir();
		const env = fauxModels(DEFAULT_PROVIDER, DEFAULT_MODEL);
		env.faux.setResponses([verdict(true)]);
		const r = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", script], env);
		expect(r.code, r.err).toBe(0);
		const { inputs, runs } = await storedLoops(db);
		expect(inputs[0]?.model).toEqual({ provider: "anthropic", modelId: "claude-haiku-4-5" });
		expect(runs.map((run) => (run.input as { model?: unknown }).model)).toEqual([{ provider: "anthropic", modelId: "claude-haiku-4-5" }]);
		expect(env.faux.state.callCount).toBe(1);
	});

	it("takes the provider and model from the environment", async () => {
		const { script, db } = workdir();
		const env = fauxModels("envprov", "envmodel");
		env.faux.setResponses([verdict(true)]);
		const r = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", script], env, {
			env: { AGENTSCRIPT_PROVIDER: "envprov", AGENTSCRIPT_MODEL: "envmodel" },
		});
		expect(r.code, r.err).toBe(0);
		expect((await storedLoops(db)).inputs[0]?.model).toEqual({ provider: "envprov", modelId: "envmodel" });
	});

	it("Scenario: An unknown model is refused before a task exists", async () => {
		const { db } = workdir();
		const r = await cli(["run", baselineDir(), "2.4", "--db", db, "--model", "claude-nope"]);
		expect(r.err).toContain('no model "claude-nope"');
		expect(r.code).toBe(2);
		// Refused before the database is even opened.
		expect(existsSync(db)).toBe(false);
	});
});

describe("task/cli: A refused start exits 2", () => {
	it("Scenario: An unknown task id exits 2 listing the ids", async () => {
		const { db } = workdir();
		const env = fauxModels();
		const r = await cli(["run", baselineDir(), "9.9", "--db", db, ...env.args], env);
		expect(r.err).toContain("9.9");
		expect(r.err).toContain("2.4");
		expect(r.code).toBe(2);
		expect((await storedLoops(db)).loops).toEqual([]);
	});

	it("a contract violation exits 2 naming the variable", async () => {
		const { dir, db } = workdir();
		const broken = join(dir, "broken.agent");
		writeFileSync(broken, JUDGE_ONLY.replace('    question: mutable string = ""\n', "").replace("            set @variables.question = @outputs.question\n", ""));
		const env = fauxModels();
		const r = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", broken, ...env.args], env);
		expect(r.code).toBe(2);
		expect(r.err).toContain("question is not declared; declare it as string");
	});
});

describe("task/cli: run prints the loop id before any model call", () => {
	it("Scenario: The resume hint is the first stderr line", async () => {
		const { script, db } = workdir();
		const env = fauxModels();
		let callsAtHint = -1;
		env.faux.setResponses([verdict(true)]);
		const err: string[] = [];
		const code = await main(["run", tinyChange(), "1.1", "--db", db, "--script", script, ...env.args], {
			models: () => env.models,
			cwd: temp("task-cwd-"),
			env: {},
			out: () => {},
			err: (line) => {
				if (err.length === 0) callsAtHint = env.faux.state.callCount;
				err.push(line);
			},
		});
		expect(code).toBe(0);
		expect(err[0]).toMatch(/^loop \d+ — resume with: specsesh task resume \d+ --db /);
		expect(err[0]).toContain(`--db ${db}`);
		expect(callsAtHint).toBe(0);
	});
});

describe("task/cli: resume continues a stored loop without the change files", () => {
	it("Scenario: An unknown loop id is refused", async () => {
		const { db } = workdir();
		const r = await cli(["resume", "42", "--db", db]);
		expect(r.err).toContain(`no loop 42 in ${db}`);
		expect(r.code).toBe(2);
		const nan = await cli(["resume", "x", "--db", db]);
		expect(nan.err).toContain(`no loop x in ${db}`);
		expect(nan.code).toBe(2);
	});

	it("finishes a stored loop after its change directory is gone", async () => {
		const { db } = workdir();
		const dir = tinyChange();
		const workspace = temp("task-ws-");
		const env = fauxModels();
		// Created by a process that never resumed it.
		const registry = createRegistry();
		for (const extension of taskLoopExtensions({ workspace })) registry.install(extension);
		const harness = await Harness.open(await openNodeSqliteStorage(db), { models: env.models, registry }, context);
		const model = env.models.getModel(env.args[1]!, env.args[3]!)!;
		const id = await startTaskLoop(
			harness,
			{ change: { dir }, task: "1.1", script: { text: JUDGE_ONLY }, workspace, model: { provider: model.provider, modelId: model.id } },
			context,
		);
		await harness.close(context);
		rmSync(dir, { recursive: true, force: true });

		env.faux.setResponses([verdict(true)]);
		const r = await cli(["resume", String(id), "--db", db], env);
		expect(r.code, r.err).toBe(0);
		expect(r.out).toContain(`# loop ${id} — converged`);
		expect(r.out).toContain("ticked: false");
		expect(r.out).toContain("cannot be read");
	});
});

/**
 * Start task loop 1.1 of a tiny change in `db` and leave it: no owner row and
 * no lock, so `resume --all` finds it interrupted.
 */
async function interrupted(db: string, env: ReturnType<typeof fauxModels>, options: { worktree?: string } = {}): Promise<number> {
	const workspace = temp("task-ws-");
	const registry = createRegistry();
	for (const extension of taskLoopExtensions({ workspace })) registry.install(extension);
	const harness = await Harness.open(await openNodeSqliteStorage(db), { models: env.models, registry }, context);
	const model = env.models.getModel(env.args[1]!, env.args[3]!)!;
	const id = await startTaskLoop(
		harness,
		{
			change: { dir: tinyChange() },
			task: "1.1",
			script: { text: JUDGE_ONLY },
			workspace,
			escalateTo: "principal",
			model: { provider: model.provider, modelId: model.id },
			...(options.worktree !== undefined ? { worktree: { path: options.worktree, branch: "task/tiny/1.1" } } : {}),
		},
		context,
	);
	await harness.close(context);
	return Number(id);
}

/** Every `loop_owner` row, as stored; none for a database whose table was never created. */
async function ownerRows(db: string): Promise<unknown[]> {
	const sql = await openNodeSqliteDatabase(db);
	try {
		const table = await sql.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'loop_owner'");
		return table === undefined ? [] : await sql.all("SELECT * FROM loop_owner ORDER BY loop_id");
	} finally {
		await sql.close();
	}
}

/** What a resume would change: the stored loops and runs, and the owner rows. */
async function snapshot(db: string) {
	const { loops, runs } = await storedLoops(db);
	return { loops, runs, owners: await ownerRows(db) };
}

/** Nothing resumed: the stored state is as before, no model call, no lock left, no `loop <id>` line. */
async function expectNothingResumed(db: string, before: Awaited<ReturnType<typeof snapshot>>, r: Awaited<ReturnType<typeof cli>>, id: number) {
	const after = await snapshot(db);
	expect(after).toEqual(before);
	const loop = after.loops.find((l) => Number(l.id) === id);
	expect(loop).toBeDefined();
	expect(loop?.state.outcome).toBeUndefined();
	expect(after.owners.some((row) => Number((row as { loop_id: number | bigint }).loop_id) === id)).toBe(false);
	expect(r.env.faux.state.callCount).toBe(0);
	expect(existsSync(`${db}.lock`)).toBe(false);
	expect(r.out).not.toMatch(/^loop \d+/m);
}

const USAGE_LINES = [
	"specsesh task run <change> <task-id>|<group>|--next|--next-group [--db <path>] [options]",
	"specsesh task spec <change> [<stage>] [--intent <words>|--intent-file <path>] [--db <path>] [--json]",
	"specsesh task resume <loop-id>|--all [--db <path>] [--json]",
	"specsesh task answer <loop-id> [--db <path>] --by principal|agent --decision <text> [--principal <name>] [--json]",
	"specsesh task status [--db <path>]",
] as const;

describe("usage and argument refusals", () => {
	it("Scenario: A loop id with --all prints usage", async () => {
		const { db } = workdir();
		const env = fauxModels();
		// Interrupted: running, no outcome, not blocked, no lock and no owner row.
		const id = await interrupted(db, env);
		const before = await snapshot(db);
		expect(before.loops.find((l) => Number(l.id) === id)?.state.status).not.toMatch(/^(terminal|completing)$/);
		expect(before.owners).toEqual([]);
		const r = await cli(["resume", String(id), "--all", "--db", db], env);
		expect(r.err.startsWith("usage:")).toBe(true);
		expect(r.code).toBe(2);
		await expectNothingResumed(db, before, r, id);
		expect((await cli(["status", "--db", db], env)).out).toContain("interrupted");
	});

	it("Scenario: --json with --all is refused", async () => {
		const { db } = workdir();
		const env = fauxModels();
		const id = await interrupted(db, env);
		const before = await snapshot(db);
		const r = await cli(["resume", "--all", "--json", "--db", db], env);
		const message = "--json is not supported with --all";
		expect(r.err).toContain(message);
		expect(r.err.indexOf("usage:")).toBeGreaterThan(r.err.indexOf(message));
		expect(r.code).toBe(2);
		await expectNothingResumed(db, before, r, id);
	});

	it("Scenario: An unknown command prints usage", async () => {
		const r = await cli(["frobnicate"]);
		expect(r.err).toContain("usage:");
		expect(r.code).toBe(2);
	});

	it("Scenario: No command prints usage", async () => {
		const r = await cli([]);
		expect(r.err.startsWith("usage:")).toBe(true);
		for (const line of USAGE_LINES) expect(r.err).toContain(line);
		expect(r.code).toBe(2);
	});
});

describe("task/cli: resume --all", () => {
	it("prints no interrupted loops in <db>, exit 0, for a database without one", async () => {
		const { db } = workdir();
		const missing = await cli(["resume", "--all", "--db", db]);
		expect(missing.out).toBe(`no interrupted loops in ${db}`);
		expect(missing.code).toBe(0);

		const b = await blocked();
		const settled = await cli(["resume", "--all", "--db", b.db], b.env);
		expect(settled.out).toBe(`no interrupted loops in ${b.db}`);
		expect(settled.code).toBe(0);
	});

	it("resumes each root under one lock, one line each: a refusal, then a blocked root with its answer command, exit 1", async () => {
		const { db } = workdir();
		const env = fauxModels();
		const gone = join(temp("task-wt-"), "gone");
		const refused = await interrupted(db, env, { worktree: gone });
		const asks = await interrupted(db, env);
		// A harness resumes every unsettled task in its storage, so the refused root's loop runs too and takes a response.
		const ask = verdict(false, "two ways", "ask", "Which way?");
		env.faux.setResponses([ask, ask]);
		const r = await cli(["resume", "--all", "--db", db], env);
		expect(r.out.split("\n")).toEqual([
			`loop ${refused} tiny 1.1 — refused: worktree ${gone} does not exist`,
			`loop ${asks} tiny 1.1 — blocked: specsesh task answer ${asks} --db ${db} --by principal --decision "…"`,
		]);
		expect(r.code).toBe(1);
		// Progress events still reach stderr.
		expect(r.errLines.some((line) => line.includes('"event":"loop-ended"'))).toBe(true);
		expect(existsSync(`${db}.lock`)).toBe(false);
	});

	it("a live lock holder refuses the batch, exit 2, naming its pid", async () => {
		const { db } = workdir();
		const env = fauxModels();
		await interrupted(db, env);
		writeFileSync(`${db}.lock`, String(process.pid));
		const r = await cli(["resume", "--all", "--db", db], env);
		expect(r.err).toContain(`process ${process.pid}`);
		expect(r.code).toBe(2);
		expect(env.faux.state.callCount).toBe(0);
		rmSync(`${db}.lock`);
	});
});

/** Run a loop that blocks on its first iteration, escalated to the principal. */
async function blocked() {
	const { script, db } = workdir();
	const env = fauxModels();
	env.faux.setResponses([verdict(false, "two ways", "ask", "Which way?")]);
	const r = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", script, ...env.args], env);
	const id = Number(/^loop (\d+)/.exec(r.errLines[0] ?? "")?.[1]);
	return { ...r, db, id, env };
}

describe("task/cli: answer submits an escalation answer and waits for the resumed loop", () => {
	it("Scenario: The wrong recipient exits 2", async () => {
		const b = await blocked();
		expect(b.code).toBe(1);
		const r = await cli(["answer", String(b.id), "--db", b.db, "--by", "agent", "--decision", "go"], b.env);
		expect(r.code).toBe(2);
		expect(r.err).toContain("goes to the principal, not the agent");
		const { loops } = await storedLoops(b.db);
		expect(loops).toHaveLength(1);
		const again = await cli(["resume", String(b.id), "--db", b.db, "--json"], b.env);
		expect(JSON.parse(again.out).status).toBe("blocked");
	});

	it("the principal's answer runs the loop on, carrying the decision", async () => {
		const b = await blocked();
		b.env.faux.setResponses([verdict(true)]);
		const r = await cli(["answer", String(b.id), "--db", b.db, "--by", "principal", "--decision", "The first way", "--json"], b.env);
		expect(r.code, r.err).toBe(0);
		const parsed = JSON.parse(r.out);
		expect(parsed.loop).not.toBe(b.id);
		expect(parsed.status).toBe("converged");
		expect(parsed.iterations).toHaveLength(2);
		expect(r.errLines[0]).toMatch(new RegExp(`^loop ${parsed.loop} — resume with: specsesh task resume ${parsed.loop} --db `));
	});

	it("a missing --by or --decision prints usage, exit 2", async () => {
		const { db } = workdir();
		expect((await cli(["answer", "1", "--db", db, "--decision", "d"])).code).toBe(2);
		expect((await cli(["answer", "1", "--db", db, "--by", "nobody", "--decision", "d"])).err).toContain('--by must be principal or agent, got "nobody"');
		expect((await cli(["answer", "1", "--db", db, "--by", "principal"])).err).toContain("answer needs --decision");
	});

	it("--principal is accepted and ignored on a task loop", async () => {
		const b = await blocked();
		b.env.faux.setResponses([verdict(true)]);
		const r = await cli(["answer", String(b.id), "--db", b.db, "--by", "principal", "--decision", "go", "--principal", "alice", "--json"], b.env);
		expect(r.code, r.err).toBe(0);
		expect(JSON.parse(r.out).status).toBe("converged");
	});

	it("an answer to a loop that is not blocked exits 2", async () => {
		const { script, db } = workdir();
		const env = fauxModels();
		env.faux.setResponses([verdict(true)]);
		const run = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", script, ...env.args], env);
		const id = /^loop (\d+)/.exec(run.errLines[0] ?? "")?.[1];
		const r = await cli(["answer", String(id), "--db", db, "--by", "principal", "--decision", "d"], env);
		expect(r.code).toBe(2);
		expect(r.err).toContain("has not ended blocked");
	});
});

describe("task/cli: answer routes a spec loop to answerSpecLoop", () => {
	const proposal = proposalStage();
	const design: SpecStage = { name: "design", owns: ["design.md"], after: ["proposal"], script: proposal.script, gate: () => [] };

	/** `main` on a faux model over test stages, in `dir`. */
	async function spec(dir: string, argv: string[], env: Record<string, string | undefined>, responses: ReturnType<typeof draft>[] = [], stages = [proposal]) {
		const models = fauxModels();
		models.faux.setResponses(responses);
		const model = models.faux.getModel();
		const out: string[] = [];
		const err: string[] = [];
		const code = await main([...argv, "--db", join(dir, ".agentscript", "spec.sqlite")], {
			models: () => models.models,
			out: (line) => out.push(line),
			err: (line) => err.push(line),
			cwd: dir,
			env: { AGENTSCRIPT_PROVIDER: model.provider, AGENTSCRIPT_MODEL: model.id, ...env },
			stages,
		});
		return { code, out: out.join("\n"), err: err.join("\n") };
	}

	/** A proposal waiting for review, and its loop id. */
	async function review(stages = [proposal]) {
		const dir = temp("task-cli-spec-");
		const run = await spec(dir, ["spec", "add-plan-export", "--intent", "Export a plan"], {}, [draft("=== proposal.md\n# A proposal\n")], stages);
		expect(run.code, run.err).toBe(0);
		const id = /^# spec loop (\d+) — blocked \(review\)/.exec(run.out)?.[1] as string;
		return { dir, id, changeDir: join(dir, "openspec", "changes", "add-plan-export") };
	}

	const approvals = (changeDir: string) => JSON.parse(readFileSync(join(changeDir, "approvals.json"), "utf8")) as { approvals: { stage: string; principal: string }[] };

	it("approves with $USER as principal and points at execution once every stage is approved", async () => {
		const r = await review();
		const a = await spec(r.dir, ["answer", r.id, "--by", "principal", "--decision", "approve"], { USER: "jesse" });
		expect(a.code, a.err).toBe(0);
		expect(approvals(r.changeDir).approvals.map((e) => [e.stage, e.principal])).toEqual([["proposal", "jesse"]]);
		expect(a.out.split("\n").slice(-2)).toEqual([
			"proposal approved by jesse.",
			"Every stage of add-plan-export is approved. Execute it: specsesh task add-plan-export --next-group",
		]);
	});

	it("--principal overrides $USER, and an approval with a stage left points at spec", async () => {
		const r = await review([proposal, design]);
		const a = await spec(r.dir, ["answer", r.id, "--by", "principal", "--decision", " Approve ", "--principal", "alice"], { USER: "jesse" }, [], [proposal, design]);
		expect(a.code, a.err).toBe(0);
		expect(approvals(r.changeDir).approvals[0]?.principal).toBe("alice");
		expect(a.out.split("\n").at(-1)).toBe("Next: specsesh task spec add-plan-export");
	});

	it("a revision runs another draft and ends with both answer commands", async () => {
		const r = await review();
		const a = await spec(r.dir, ["answer", r.id, "--by", "principal", "--decision", "narrow it"], { USER: "jesse" }, [draft("=== proposal.md\n# Narrower\n")]);
		expect(a.code, a.err).toBe(0);
		const next = /^# spec loop (\d+) — blocked \(review\)/.exec(a.out)?.[1];
		expect(next).not.toBe(r.id);
		expect(a.out).toContain("## proposal draft 2: clean");
		expect(a.out.split("\n").slice(-2)).toEqual([
			`  approve:  specsesh task answer ${next} --by principal --decision approve`,
			`  revise:   specsesh task answer ${next} --by principal --decision "<what to change>"`,
		]);
		expect(readFileSync(join(r.changeDir, "proposal.md"), "utf8")).toBe("# Narrower\n");
	});

	it("--json prints the loop id merged with the outcome", async () => {
		const r = await review();
		const a = await spec(r.dir, ["answer", r.id, "--by", "principal", "--decision", "approve", "--json"], { USER: "jesse" });
		expect(a.code, a.err).toBe(0);
		const parsed = JSON.parse(a.out);
		expect([parsed.status, parsed.result.approved]).toEqual(["converged", true]);
	});

	it("with no principal anywhere, or --principal without a name, it refuses and records nothing", async () => {
		const r = await review();
		const none = await spec(r.dir, ["answer", r.id, "--by", "principal", "--decision", "approve"], {});
		expect([none.code, none.err]).toEqual([2, "no principal; pass --principal"]);
		const blank = await spec(r.dir, ["answer", r.id, "--by", "principal", "--decision", "approve", "--principal", " "], {});
		expect(blank.code).toBe(2);
		const bare = await spec(r.dir, ["answer", r.id, "--by", "principal", "--decision", "approve", "--principal"], {});
		expect(bare.code).toBe(2);
		expect(existsSync(join(r.changeDir, "approvals.json"))).toBe(false);
	});

	it("an agent's answer to a review is refused, exit 2", async () => {
		const r = await review();
		const a = await spec(r.dir, ["answer", r.id, "--by", "agent", "--decision", "approve"], { USER: "jesse" });
		expect(a.code).toBe(2);
		expect(a.err).toContain("only the principal answers the review");
		expect(existsSync(join(r.changeDir, "approvals.json"))).toBe(false);
	});
});

describe("task/cli: Text output reports each iteration and the outcome", () => {
	it("Scenario: A converged loop prints its iterations and ticked", async () => {
		const { script, db } = workdir();
		const env = fauxModels();
		env.faux.setResponses([verdict(false, "not yet: the value is 1", "retry"), verdict(true)]);
		const r = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", script, ...env.args], env);
		expect(r.code, r.err).toBe(0);
		expect(r.out).toContain("# loop");
		expect(r.out).toContain("converged");
		expect(r.out).toContain("## iteration 1: unmet\nnot yet: the value is 1");
		expect(r.out).toContain("## iteration 2: met");
		expect(r.out).toContain("ticked: true");
	});

	it("Scenario: A blocked loop ends with the answer command", async () => {
		const { dir, script } = workdir();
		const env = fauxModels();
		env.faux.setResponses([verdict(false, "two ways", "ask", "Which way?")]);
		const r = await cli(["run", tinyChange(), "1.1", "--db", "loops.sqlite", "--script", script, ...env.args], env, { cwd: dir });
		expect(r.code).toBe(1);
		const id = /^loop (\d+)/.exec(r.errLines[0] ?? "")?.[1];
		expect(r.out.split("\n").at(-1)).toBe(`specsesh task answer ${id} --db loops.sqlite --by principal --decision "…"`);
	});

	it("a blocked loop prints the escalation's recipient and question", async () => {
		const b = await blocked();
		expect(b.out).toContain("— blocked");
		expect(b.out).toContain("escalation to: principal");
		expect(b.out).toContain("question: Which way?");
	});
});

describe("task/cli: JSON output is the loop id merged with the outcome", () => {
	it("Scenario: JSON carries status and iterations", async () => {
		const { script, db } = workdir();
		const env = fauxModels();
		env.faux.setResponses([verdict(true)]);
		const r = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", script, ...env.args, "--json"], env);
		const parsed = JSON.parse(r.out);
		expect(Number.isInteger(parsed.loop)).toBe(true);
		expect(parsed.status).toBe("converged");
		expect(Array.isArray(parsed.iterations)).toBe(true);
		expect(parsed.result).toEqual({ task: "1.1", ticked: true });
	});
});

describe("task/cli: The exit code says whether the task converged", () => {
	it("Scenario: A blocked loop exits 1", async () => {
		const b = await blocked();
		expect(b.out).toContain("— blocked");
		expect(b.code).toBe(1);
	});

	it("Scenario: A converged loop exits 0", async () => {
		const { script, db } = workdir();
		const env = fauxModels();
		env.faux.setResponses([verdict(true)]);
		const r = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", script, ...env.args], env);
		expect(r.out).toContain("— converged");
		expect(r.code).toBe(0);
	});

	it("exhausted and failed loops exit 1", async () => {
		const { script, db } = workdir();
		const assigning = join(dirname(script), "assigning.agent");
		writeFileSync(assigning, JUDGE_ONLY_ASSIGNING("done"));
		const env = fauxModels();
		env.faux.setResponses([verdict(false, "x", "retry"), verdict(false, "x", "retry")]);
		const exhausted = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", script, ...env.args, "--max-iterations", "1"], env);
		expect(exhausted.out).toContain("— exhausted");
		expect(exhausted.code).toBe(1);
		const failed = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", assigning, ...env.args], env);
		expect(failed.out).toContain("— failed");
		expect(failed.out).toContain('note: the script broke the task-script contract: next_action is "done"');
		expect(failed.code).toBe(1);
	});
});

describe("task/cli: ollama is registered when a loop needs it", () => {
	const savedHost = process.env.OLLAMA_HOST;
	const fakes: FakeOllama[] = [];
	afterEach(async () => {
		for (const fake of fakes.splice(0)) await fake.close();
		if (savedHost === undefined) delete process.env.OLLAMA_HOST;
		else process.env.OLLAMA_HOST = savedHost;
		built.splice(0);
	});

	/** A fake Ollama listing `qwen3:8b`, answering `reply`, with OLLAMA_HOST pointing at it. */
	async function fakeOllama(reply?: FakeOllamaReply | ((body: unknown) => FakeOllamaReply)) {
		const fake = await startFakeOllama({ models: ["qwen3:8b"], ...(reply !== undefined ? { reply } : {}) });
		fakes.push(fake);
		process.env.OLLAMA_HOST = fake.url;
		return fake;
	}

	const chats = (fake: FakeOllama) => fake.requests.filter((r) => r.method === "POST" && r.path === "/v1/chat/completions");
	const MET = { met: true, unmet: "", next_action: "retry", question: "", amend_path: "", amend_text: "" };

	/** The bundled task script's steps: a plan for orient, text for act, a met verdict for the judge. */
	function taskSteps(body: unknown): FakeOllamaReply {
		type Tool = { function: { name: string; parameters?: { properties?: Record<string, unknown> } } };
		const submit = ((body as { tools?: Tool[] }).tools ?? []).find((tool) => tool.function.name === "submit_result");
		if (submit === undefined) return { text: "Nothing to change." };
		return { toolCall: { arguments: "plan" in (submit.function.parameters?.properties ?? {}) ? { plan: "nothing to change" } : MET } };
	}

	/** A directory holding `agentscript.config.json` as given. */
	function configured(config: unknown) {
		const dir = temp("task-ollama-");
		writeFileSync(join(dir, "agentscript.config.json"), JSON.stringify(config));
		return { dir, db: join(dir, "loops.sqlite") };
	}

	it("Scenario: A task loop converges on a pulled ollama model", async () => {
		const fake = await fakeOllama(taskSteps);
		const { dir, db } = configured({ task: { provider: "ollama", model: "qwen3:8b", script: "task", checks: ["pnpm test"], allow: ["pnpm"] } });
		const env = fauxModels();

		const r = await cli(["run", tinyChange(), "1.1", "--db", db], env, { cwd: dir });

		expect(r.code, r.err).toBe(0);
		expect(r.out).toContain("— converged");
		// orient, act and judge each asked the pulled model; nothing else was asked
		expect(chats(fake)).toHaveLength(3);
		for (const chat of chats(fake)) expect((chat.body as { model?: string }).model).toBe("qwen3:8b");
		expect(env.faux.state.callCount).toBe(0);
		expect((await storedLoops(db)).inputs[0]?.model).toEqual({ provider: "ollama", modelId: "qwen3:8b" });
	});

	it("Scenario: A named model on ollama reaches the harness", async () => {
		await fakeOllama();
		const { dir, db } = configured({ models: { local: { provider: "ollama", model: "qwen3:8b" } } });
		const script = join(dir, "judge.agent");
		writeFileSync(script, JUDGE_ONLY);
		const env = fauxModels();
		env.faux.setResponses([verdict(true)]);

		const r = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", script, ...env.args], env, { cwd: dir });

		expect(r.code, r.err).toBe(0);
		expect(built).toHaveLength(1);
		expect(built[0]?.models["local"]).toEqual({ provider: "ollama", modelId: "qwen3:8b" });
	});

	it("Scenario: Other providers never contact Ollama", async () => {
		const fake = await fakeOllama();
		const { dir, db } = configured({ task: { provider: "anthropic" } });

		const r = await cli(["run", tinyChange(), "1.1", "--db", db, "--model", "claude-nope"], fauxModels(), { cwd: dir });

		expect(r.code).toBe(2);
		expect(r.err).toContain('no model "claude-nope" on provider "anthropic"');
		expect(r.err).not.toContain("Ollama at");
		expect(fake.requests).toEqual([]);
	});

	it("Scenario: An unreachable ollama is named in the refusal", async () => {
		const url = await closedPortUrl();
		process.env.OLLAMA_HOST = url;
		const { dir, db } = configured({ task: { provider: "ollama", model: "qwen3:8b" } });

		const r = await cli(["run", tinyChange(), "1.1", "--db", db], fauxModels(), { cwd: dir });

		expect(r.err).toContain(`no model "qwen3:8b" on provider "ollama" (Ollama at ${url}`);
		expect(r.code).toBe(2);
		// Refused before the database is even opened, so no task exists.
		expect(existsSync(db)).toBe(false);
	});

	it("Scenario: A crashed ollama loop resumes on its model", async () => {
		const db = join(temp("task-crash-"), "loops.sqlite");
		const workspace = temp("task-ws-");
		let out = "";
		let status: number | null = 0;
		try {
			execFileSync(process.execPath, ["--import", TS_HOOK, join(HERE, "fixtures", "crash-ollama-loop-child.ts"), db, tinyChange(), workspace], { encoding: "utf8" });
		} catch (error) {
			const e = error as { stdout: string; status: number | null };
			status = e.status;
			out = e.stdout;
		}
		expect(status).toBe(137);
		const id = /LOOP (\d+)/.exec(out)?.[1] ?? "";
		expect(id).toMatch(/^\d+$/);

		const fake = await fakeOllama({ toolCall: { arguments: MET } });
		const env = fauxModels();
		const r = await cli(["resume", id, "--db", db], env);

		expect(r.code, r.err).toBe(0);
		expect(r.out).toContain(`# loop ${id} — converged`);
		expect(chats(fake).length).toBeGreaterThan(0);
		for (const chat of chats(fake)) expect((chat.body as { model?: string }).model).toBe("qwen3:8b");
		expect(env.faux.state.callCount).toBe(0);
	}, 90_000);
});
