// The `actions/agent-runner` call scenarios: a granted agent delegate runs as a durable child on
// another faux model in the caller's local workspace. Memory storage, except the crash case, which
// kills a fixture process mid-child and resumes from its SQLite file.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { MemoryStorage, type Storage, type TaskId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import {
	EDIT_AGENT,
	READ_AGENT,
	AgentScriptRun,
	RESULT_TOOL,
	startScript,
	waitForScript,
	type DelegateGrants,
	type RunCheckpoint,
	type RunInput,
} from "../../src/durable/index.js";
import type { RunResult } from "../../src/interpreter/index.js";
import { CALLER, agentHarness, childRuns, fauxModels } from "./agent-runner-scripts.js";
import { context } from "./helpers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TS_HOOK = join(HERE, "fixtures", "ts-resolve.mjs");
const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

/** A workspace holding `src/a.ts`; with `git`, committed in a fresh repository. */
function workspace({ git = false } = {}): string {
	const dir = temp("agentscript-agent-ws-");
	mkdirSync(join(dir, "src"));
	writeFileSync(join(dir, "src", "a.ts"), "export const a = 1;\n");
	if (git) {
		const run = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
		run("init", "-q");
		run("add", ".");
		run("-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "init");
	}
	return dir;
}

const call = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
	fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });

/** Run CALLER with `instructions` through the durable runtime; the result, its id and its child runs. */
async function callReviewer(
	storage: Storage,
	dir: string,
	faux: ReturnType<typeof fauxModels>,
	delegates: DelegateGrants,
	instructions = "Review src/a.ts",
) {
	const { harness, models } = await agentHarness(storage, dir, faux.models, delegates);
	const id = await startScript(harness, CALLER, { model: models.default, variables: { instructions } }, context);
	const result = await waitForScript(harness, id, context);
	const children = await childRuns(storage, id);
	await harness.close(context);
	return { result, id, children };
}

/** Two model steps: `work` answers in text, `report` sets `ok` and `summary`. */
const TWO_STEPS = `config:
    agent_name: "two-steps"

system:
    instructions: "You are a delegate."

variables:
    instructions: mutable string = ""
    ok: mutable boolean = False
    summary: mutable string = ""

subagent work:
    description: "Work"

    reasoning:
        instructions: ->
            | {!@variables.instructions}

subagent report:
    description: "Report"

    reasoning:
        instructions: ->
            | Report.
            set @variables.ok = @outputs.ok
            set @variables.summary = @outputs.summary
`;

describe("actions/agent-runner: a call runs the script as a durable child", () => {
	it("Scenario: A reviewer on another model answers", async () => {
		const faux = fauxModels();
		faux.script("opus", [call("read_file", { path: "src/a.ts" }), call(RESULT_TOOL, { ok: true, summary: "src/a.ts looks right." })]);
		const storage = new MemoryStorage();
		const { result, children } = await callReviewer(storage, workspace(), faux, {
			reviewer: { runner: "agent", model: "opus", script: READ_AGENT },
		});

		expect(faux.asked.default).toHaveLength(0);
		expect(faux.asked.opus).toHaveLength(2);
		const prompt = faux.asked.opus[0]?.messages.find((message) => message.role === "user");
		expect(JSON.stringify(prompt)).toContain("Review src/a.ts");
		// The read went through the caller's workspace and back to the model.
		expect(JSON.stringify(faux.asked.opus[1]?.messages)).toContain("export const a = 1;");
		expect(result.kind).toBe("completed");
		expect(result.variables).toMatchObject({ ok: true, summary: "src/a.ts looks right." });
		expect(children).toHaveLength(1);
	});

	it("Scenario: An editing delegate's changes are counted", async () => {
		const faux = fauxModels();
		faux.script("opus", [
			call("edit_file", { path: "src/a.ts", content: "export const a = 2;\n" }),
			call(RESULT_TOOL, { ok: true, summary: "Set a to 2." }),
		]);
		const dir = workspace({ git: true });
		const { result, children } = await callReviewer(new MemoryStorage(), dir, faux, {
			reviewer: {
				runner: "agent",
				model: "opus",
				script: EDIT_AGENT,
				tools: ["read_file", "list_files", "search_files", "edit_file", "run_command"],
			},
		});

		expect(readFileSync(join(dir, "src", "a.ts"), "utf8")).toBe("export const a = 2;\n");
		expect(result.kind).toBe("completed");
		expect(result.variables["files_changed"]).toBe(1);
		const reported = result.actions.at(-1)?.result;
		expect(reported).toMatchObject({ ok: true, outputs: { ok: true, summary: "Set a to 2.", files_changed: 1 } });
		expect(reported?.record).toEqual({
			action: { kind: "delegate", summary: "Set a to 2.", refs: ["delegate/reviewer", `run:${children[0]}`] },
			evidence: [{ kind: "diff", files: [{ path: "src/a.ts", change: "modified" }] }],
		});
	});

	it("Scenario: An agent delegate is seeded with the run's preamble", async () => {
		const faux = fauxModels();
		faux.script("opus", [call(RESULT_TOOL, { ok: true, summary: "Fine." })]);
		const storage = new MemoryStorage();
		const { harness, models } = await agentHarness(storage, workspace(), faux.models, {
			reviewer: { runner: "agent", model: "opus", script: READ_AGENT },
		});
		// startScript takes no preamble: create the caller's run with a whole RunInput, as the task loop does.
		const root = await harness.root(context);
		const agent = await root.agent(context);
		const runTask = agent.extensions
			.flatMap((extension) => extension.tasks ?? [])
			.find((task) => task.definition.name === AgentScriptRun.definition.name) as typeof AgentScriptRun;
		const input: RunInput = {
			source: CALLER,
			options: { variables: { instructions: "Review src/a.ts" } },
			model: models.default,
			delegatePreamble: "Task 2.1: Do X",
		};
		const id = await root.commit((tx) => tx.createTask(runTask, input, { ownership: { kind: "conversation" } }), context);
		const result = await waitForScript(harness, id, context);
		const [child] = await childRuns(storage, id);
		const childInput = (await harness.getTask(child as TaskId<RunResult>, context))?.input as unknown as RunInput;
		await harness.close(context);

		expect(result.kind).toBe("completed");
		expect(childInput.options?.variables).toEqual({ instructions: "Task 2.1: Do X\n\nReview src/a.ts" });
		expect(childInput).not.toHaveProperty("delegatePreamble");
	});
});

describe("actions/agent-runner: a failed child is a failed call", () => {
	it("Scenario: A child past its step limit fails the call", async () => {
		const faux = fauxModels();
		faux.script("opus", [fauxAssistantMessage([fauxText("Working on it.")])]);
		const { result, children } = await callReviewer(new MemoryStorage(), workspace(), faux, {
			reviewer: { runner: "agent", model: "opus", script: TWO_STEPS, tools: [], maxSteps: 1 },
		});

		expect(faux.asked.opus).toHaveLength(1);
		expect(children).toHaveLength(1);
		expect(result.kind).toBe("failed");
		const reported = result.actions.at(-1)?.result;
		expect(reported?.ok).toBe(false);
		expect(reported?.ok === false ? reported.message : "").toContain("reached its limit of 1 steps");
	});
});

describe("actions/agent-runner: a crash while the child runs never starts a second child", () => {
	it("Scenario: Resume waits for the same child", async () => {
		const dir = workspace();
		const dbPath = join(temp("agentscript-agent-crash-"), "run.sqlite");
		let out = "";
		let status: number | null = 0;
		try {
			out = execFileSync(process.execPath, ["--import", TS_HOOK, join(HERE, "fixtures", "agent-runner-crash.ts"), dbPath, dir], {
				encoding: "utf8",
				timeout: 60_000,
			});
		} catch (error) {
			const e = error as { stdout?: string; status?: number | null };
			out = e.stdout ?? "";
			status = e.status ?? null;
		}
		expect(out).toContain("CRASH");
		expect(status).toBe(137);
		const id = Number(/TASK (\d+)/.exec(out)?.[1]) as TaskId<RunResult>;

		const faux = fauxModels();
		faux.script("opus", [call(RESULT_TOOL, { ok: true, summary: "Reviewed after the crash." })]);
		const storage = await openNodeSqliteStorage(dbPath);
		const { harness } = await agentHarness(storage, dir, faux.models, {
			reviewer: { runner: "agent", model: "opus", script: READ_AGENT },
		});
		const stranded = ((await harness.getTask(id, context))?.state as { checkpoint?: RunCheckpoint }).checkpoint;
		const before = await childRuns(storage, id);
		harness.resume();
		const result = await waitForScript(harness, id, context);
		const after = await childRuns(storage, id);
		await harness.close(context);

		expect(stranded).toMatchObject({ phase: "act", intent: { replay: "safe" } });
		const child = stranded?.phase === "act" ? Number(stranded.child) : undefined;
		expect(child).toBeDefined();
		expect(before).toEqual([child]);
		expect(after).toEqual([child]);
		expect(faux.asked.default).toHaveLength(0);
		expect(result.kind).toBe("completed");
		expect(result.variables).toMatchObject({ ok: true, summary: "Reviewed after the crash." });
		expect(result.actions.at(-1)?.result.record).toMatchObject({ action: { refs: ["delegate/reviewer", `run:${child}`] } });
	}, 90_000);
});
