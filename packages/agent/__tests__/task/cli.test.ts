import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createModels, fauxProvider } from "@earendil-works/pi-ai";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { DEFAULT_MODEL, DEFAULT_PROVIDER, main } from "../../src/bin/agentscript-task.js";
import { TASK_LOOP, startTaskLoop, taskLoopExtensions, type TaskLoopInput } from "../../src/task/index.js";
import { JUDGE_ONLY, baselineDir, cleanTemps, context, temp, tinyChange, verdict } from "./helpers.js";

const savedEnv = { provider: process.env.AGENTSCRIPT_PROVIDER, model: process.env.AGENTSCRIPT_MODEL };
afterEach(() => {
	cleanTemps();
	for (const [key, value] of [["AGENTSCRIPT_PROVIDER", savedEnv.provider], ["AGENTSCRIPT_MODEL", savedEnv.model]] as const) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

/** A faux model collection, under the faux provider's ids or the ones given. */
function fauxModels(provider?: string, modelId?: string) {
	const faux = fauxProvider(provider !== undefined ? { provider, models: [{ id: modelId ?? "m" }] } : undefined);
	const models = createModels();
	models.setProvider(faux.provider);
	const model = faux.getModel();
	return { faux, models, args: ["--provider", model.provider, "--model", model.id] };
}

/** A temp directory with JUDGE_ONLY as a script file and a database path in it. */
function workdir() {
	const dir = temp("task-cli-");
	const script = join(dir, "judge.agent");
	writeFileSync(script, JUDGE_ONLY);
	return { dir, script, db: join(dir, "loops.sqlite") };
}

async function cli(argv: string[], env = fauxModels()) {
	const out: string[] = [];
	const err: string[] = [];
	const code = await main(argv, { models: () => env.models, out: (l) => out.push(l), err: (l) => err.push(l) });
	return { code, out: out.join("\n"), err: err.join("\n"), errLines: err, env };
}

/** The stored loop inputs in a database. */
async function storedLoops(db: string) {
	const storage = await openNodeSqliteStorage(db);
	const page = await storage.scanTasks({ kind: TASK_LOOP }, 10, undefined, context);
	const runs = await storage.scanTasks({ kind: "agentscript.run" }, 10, undefined, context);
	await storage.close(context);
	return { loops: page.items, inputs: page.items.map((t) => t.input as unknown as TaskLoopInput), runs: runs.items };
}

describe("task/cli: The CLI has exactly three commands and prints usage otherwise", () => {
	it("Scenario: An unknown command prints usage", async () => {
		const r = await cli(["frobnicate"]);
		expect(r.err).toContain("usage:");
		expect(r.code).toBe(2);
	});

	it("Scenario: No command prints usage", async () => {
		const r = await cli([]);
		expect(r.err.startsWith("usage:")).toBe(true);
		expect(r.err).toContain("agentscript-task run <change-dir> <task-id> --db <path> [options]");
		expect(r.err).toContain("agentscript-task resume <loop-id> --db <path> [--json]");
		expect(r.err).toContain("agentscript-task answer <loop-id> --db <path> --by principal|agent --decision <text> [--json]");
		expect(r.code).toBe(2);
	});

	it("an unknown flag prints the reason and usage, exit 2", async () => {
		const r = await cli(["run", "x", "1.1", "--db", "y", "--frob"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("--frob");
		expect(r.err).toContain("usage:");
	});
});

describe("task/cli: run takes a change directory, a task id and a database", () => {
	it("Scenario: run without --db prints usage", async () => {
		const r = await cli(["run", baselineDir(), "2.4"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("usage:");
	});

	it("Scenario: run without a task id prints usage", async () => {
		const { db } = workdir();
		const r = await cli(["run", baselineDir(), "--db", db]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("usage:");
		expect(existsSync(db)).toBe(false);
	});
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
		const r = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", script, ...env.args], env);
		expect(r.code, r.err).toBe(0);
		const { inputs } = await storedLoops(db);
		expect(inputs[0]?.workspace).toBe(process.cwd());
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

describe("task/cli: run resolves provider and model like agentscript-durable", () => {
	it("Scenario: Defaults apply when nothing is set", async () => {
		delete process.env.AGENTSCRIPT_PROVIDER;
		delete process.env.AGENTSCRIPT_MODEL;
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
		process.env.AGENTSCRIPT_PROVIDER = "envprov";
		process.env.AGENTSCRIPT_MODEL = "envmodel";
		env.faux.setResponses([verdict(true)]);
		const r = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", script], env);
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
			out: () => {},
			err: (line) => {
				if (err.length === 0) callsAtHint = env.faux.state.callCount;
				err.push(line);
			},
		});
		expect(code).toBe(0);
		expect(err[0]).toMatch(/^loop \d+ — resume with: agentscript-task resume \d+ --db /);
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
		expect(r.errLines[0]).toMatch(new RegExp(`^loop ${parsed.loop} — resume with: agentscript-task resume ${parsed.loop} --db `));
	});

	it("a missing --by or --decision prints usage, exit 2", async () => {
		const { db } = workdir();
		expect((await cli(["answer", "1", "--db", db, "--decision", "d"])).code).toBe(2);
		expect((await cli(["answer", "1", "--db", db, "--by", "nobody", "--decision", "d"])).err).toContain('--by must be principal or agent, got "nobody"');
		expect((await cli(["answer", "1", "--db", db, "--by", "principal"])).err).toContain("answer needs --decision");
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
		const env = fauxModels();
		env.faux.setResponses([verdict(false, "x", "retry"), verdict(false, "x", "done")]);
		const exhausted = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", script, ...env.args, "--max-iterations", "1"], env);
		expect(exhausted.out).toContain("— exhausted");
		expect(exhausted.code).toBe(1);
		const failed = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", script, ...env.args], env);
		expect(failed.out).toContain("— failed");
		expect(failed.out).toContain('note: the script broke the task-script contract: next_action is "done"');
		expect(failed.code).toBe(1);
	});
});
