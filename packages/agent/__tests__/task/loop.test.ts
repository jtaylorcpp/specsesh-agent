import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { TaskId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { LoopOutcome, TaskOutcome, check, type LoopOutcome as LoopOutcomeType, type TaskOutcome as TaskOutcomeType } from "../../src/openspec/index.js";
import { BUNDLED_SCRIPTS, TASK_LOOP, startTaskLoop, waitForTaskLoop, waitForTaskLoopResult } from "../../src/task/index.js";
import {
	JUDGE_ONLY,
	JUDGE_ONLY_ASSIGNING,
	PROPOSAL,
	baselineCopy,
	cleanTemps,
	context,
	fakePnpm,
	loopEnv,
	loopHarness,
	plan,
	prompts,
	runLoop,
	runTasks,
	temp,
	text,
	tinyChange,
	toolCall,
	verdict,
} from "./helpers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TS_HOOK = join(HERE, "..", "durable", "fixtures", "ts-resolve.mjs");

afterEach(cleanTemps);

describe("task/agent: The task entry exports the task loop", () => {
	it("Scenario: A host starts and awaits a task loop", async () => {
		const { env, workspace } = loopEnv();
		const harness = await loopHarness(env);
		env.faux.setResponses([verdict(true)]);
		const id = await startTaskLoop(
			harness,
			{ change: { dir: baselineCopy() }, task: "2.4", script: { text: JUDGE_ONLY }, workspace, model: env.model },
			context,
		);
		harness.resume();
		const outcome = await waitForTaskLoop(harness, id, context);
		await harness.close(context);

		expect(Number.isInteger(id)).toBe(true);
		expect(check(LoopOutcome(TaskOutcome), outcome)).toBe(true);
		expect(outcome).toMatchObject({ status: "converged", result: { task: "2.4", ticked: true } });
	});
});

describe("task/agent: A harness binds the loop's actions to one workspace", () => {
	it("Scenario: The extensions run the loop's actions in its workspace", async () => {
		const restore = fakePnpm();
		try {
			const workspace = temp("task-ws-");
			const r = await runLoop(
				[plan("write a.ts"), toolCall("edit", { path: "src/a.ts", content: "export {};" }), text("Done."), verdict(true)],
				{ script: { path: BUNDLED_SCRIPTS.task.pathname }, workspace, checks: ["pnpm test"], allow: ["pnpm"] },
			);
			await r.harness.close(context);
			expect(r.outcome.status).toBe("converged");
			expect(readFileSync(join(workspace, "src/a.ts"), "utf8")).toBe("export {};");
		} finally {
			restore();
		}
	});
});

describe("task/agent: The loop constrains next_action to its contract values", () => {
	it("Scenario: The judge step's schema lists the three values", async () => {
		const restore = fakePnpm();
		try {
			const r = await runLoop([plan("p"), text("Done."), verdict(false, "x", "retry"), plan("p"), text("Done."), verdict(true)], {
				script: { path: BUNDLED_SCRIPTS.task.pathname },
				checks: ["pnpm test"],
				allow: ["pnpm"],
			});
			const runs = await runTasks(r.storage);
			await r.harness.close(context);
			expect(r.outcome.status).toBe("converged");

			type Offered = { name: string; parameters?: { properties?: Record<string, unknown> } };
			const submitted = r.env.requests.flatMap((request) =>
				(request.messages as unknown as { role: string; toolsAdded?: Offered[] }[])
					.filter((m) => m.role === "system")
					.flatMap((m) => m.toolsAdded ?? [])
					.filter((t) => t.name === "submit_result" && t.parameters?.properties?.["next_action"] !== undefined),
			);
			expect(submitted).toHaveLength(2);
			for (const tool of submitted) {
				expect(tool.parameters?.properties?.["next_action"]).toEqual({
					type: "string",
					enum: ["retry", "amend-spec", "ask"],
				});
			}

			// Every iteration's child carries the choices, retries included.
			expect(runs).toHaveLength(2);
			for (const run of runs) {
				expect((run.input as { options: { choices: unknown } }).options.choices).toEqual({
					next_action: ["retry", "amend-spec", "ask"],
				});
			}
		} finally {
			restore();
		}
	});
});

describe("task/agent: Defaults for optional options", () => {
	it("Scenario: Budget defaults to eight iterations", async () => {
		const retry = () => verdict(false, "still red", "retry");
		const r = await runLoop([...Array.from({ length: 8 }, retry), verdict(true)]);
		await r.harness.close(context);
		expect(r.options.budget).toBeUndefined();
		expect(r.outcome.status).toBe("exhausted");
		expect(r.outcome.iterations).toHaveLength(8);
		// A ninth iteration would have taken the met verdict.
		expect(r.env.requests).toHaveLength(8);
	});
});

/** Crash a loop at iteration 1's first model request in a child process; the loop is left at `await`. */
function crashedLoop() {
	const dir = tinyChange();
	const workspace = temp("task-ws-");
	const dbPath = join(temp("task-crash-"), "loops.sqlite");
	let out = "";
	let status: number | null = 0;
	try {
		out = execFileSync(process.execPath, ["--import", TS_HOOK, join(HERE, "fixtures", "crash-loop-child.ts"), dbPath, dir, workspace], {
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
	const id = Number(/LOOP (\d+)/.exec(out)?.[1]) as TaskId<LoopOutcomeType<TaskOutcomeType>>;
	expect(Number.isInteger(id)).toBe(true);
	return { dir, workspace, dbPath, id };
}

async function resumeCrashed(crashed: ReturnType<typeof crashedLoop>) {
	const storage = await openNodeSqliteStorage(crashed.dbPath);
	const { env } = loopEnv({ workspace: crashed.workspace });
	env.faux.setResponses([verdict(true)]);
	const harness = await loopHarness(env, storage);
	const stranded = await harness.getTask(crashed.id, context);
	const before = await runTasks(storage);
	harness.resume();
	const outcome = await waitForTaskLoop(harness, crashed.id, context);
	const after = await runTasks(storage);
	await harness.close(context);
	return { stranded, before, after, outcome, env };
}

describe("task/agent: The loop is one durable task with three phases", () => {
	it("Scenario: A crash during await does not start a second run", async () => {
		const crashed = crashedLoop();
		const { stranded, before, after, outcome } = await resumeCrashed(crashed);

		expect(stranded?.kind).toBe(TASK_LOOP);
		const checkpoint = (stranded?.state as { checkpoint?: { phase: string; child: number } }).checkpoint;
		expect(checkpoint?.phase).toBe("await");
		expect(before.map((t) => t.id)).toEqual([checkpoint?.child]);
		// The same child finished the iteration; no other run was created.
		expect(after.map((t) => t.id)).toEqual([checkpoint?.child]);
		expect(after[0]?.state.status).toBe("terminal");
		expect(outcome.status).toBe("converged");
		expect(outcome.iterations).toHaveLength(1);
	}, 90_000);
});

describe("task/agent: Sources are read once, at start, into the durable input", () => {
	it("Scenario: A resumed loop ignores edits to the files", async () => {
		const crashed = crashedLoop();
		writeFileSync(join(crashed.dir, "proposal.md"), "## Why\n\nEDITED AFTER THE START\n");
		const { outcome, env } = await resumeCrashed(crashed);

		expect(outcome.status).toBe("converged");
		const [prompt] = prompts(env.requests);
		expect(prompt).toContain(`Proposal: ${PROPOSAL.trimEnd().split("\n")[0]}`);
		expect(prompt).toContain("The value file must say 2.");
		expect(prompt).not.toContain("EDITED AFTER THE START");
	}, 90_000);
});

describe("task/agent: Judge maps a failed run and a met verdict", () => {
	it("Scenario: A failed step fails the loop", async () => {
		// A structured step answered in text never submits its result: the step fails, and so the run.
		const r = await runLoop([text("I will not call the tool.")]);
		await r.harness.close(context);
		expect(r.outcome.status).toBe("failed");
		expect(r.outcome.iterations).toHaveLength(1);
		const finding = r.outcome.iterations[0]?.feedback[0]?.from;
		expect(finding?.kind).toBe("environment");
		expect(finding?.evidence).toContainEqual(expect.objectContaining({ kind: "check", command: "agentscript.run", exitCode: 1 }));
		expect(r.notes[0]).toMatch(/^the run ended failed/);
	});

	it("Scenario: A met verdict converges", async () => {
		const r = await runLoop([verdict(false, "not yet", "retry"), verdict(true)]);
		await r.harness.close(context);
		expect(r.outcome.status).toBe("converged");
		expect(r.outcome.iterations).toHaveLength(2);
		expect(r.outcome.iterations.map((i) => i.verdict.met)).toEqual([false, true]);
	});
});

describe("task/agent: Judge maps retry to another iteration or exhaustion", () => {
	it("Scenario: Retry carries the unmet summary", async () => {
		const r = await runLoop([verdict(false, "the --json case is untested", "retry"), verdict(true)]);
		const runs = await runTasks(r.storage);
		await r.harness.close(context);
		const variables = runs.map((t) => (t.input as { options: { variables: Record<string, unknown> } }).options.variables);
		expect(variables[1]).toMatchObject({ carried: "the --json case is untested", iteration: 2 });
		expect(prompts(r.env.requests)[1]).toContain("iteration 2");
		expect(prompts(r.env.requests)[1]).toContain("Carried: the --json case is untested");
	});

	it("Scenario: Retry with no budget left exhausts", async () => {
		const r = await runLoop([verdict(false, "a", "retry"), verdict(false, "b", "retry"), verdict(true)], {
			budget: { maxIterations: 2 },
		});
		await r.harness.close(context);
		expect(r.outcome.status).toBe("exhausted");
		expect(r.outcome.iterations).toHaveLength(2);
		expect(r.env.requests).toHaveLength(2);
	});
});

describe("task/agent: Judge maps ask and amend-spec to a blocked loop", () => {
	it("Scenario: An amend-spec verdict blocks with a spec defect", async () => {
		const question = "The spec says run throws UndeclaredVariableError; the lint refuses first. Amend?";
		const r = await runLoop([verdict(false, "the spec and the lint disagree", "amend-spec", question)]);
		await r.harness.close(context);
		expect(r.outcome.status).toBe("blocked");
		if (r.outcome.status !== "blocked") return;
		expect(r.outcome.escalation).toEqual({ level: "task", to: "principal", reason: "the spec and the lint disagree", question });
		expect(r.outcome.iterations[0]?.feedback).toEqual([
			expect.objectContaining({ action: "amend-spec", from: expect.objectContaining({ kind: "spec-defect" }) }),
		]);
	});

	it("an ask verdict blocks with a needs-decision finding, to the configured recipient", async () => {
		const r = await runLoop([verdict(false, "two ways to do it", "ask", "Which way?")], { escalateTo: "agent" });
		await r.harness.close(context);
		expect(r.outcome).toMatchObject({ status: "blocked", escalation: { to: "agent", question: "Which way?" } });
		expect(r.outcome.iterations[0]?.feedback[0]).toMatchObject({ action: "ask", from: { kind: "needs-decision" } });
	});

	it("an empty question falls back to the unmet summary", async () => {
		const r = await runLoop([verdict(false, "which database?", "ask", "")]);
		await r.harness.close(context);
		expect(r.outcome).toMatchObject({ status: "blocked", escalation: { question: "which database?" } });
	});
});

describe("task/agent: Judge fails a run that breaks the contract", () => {
	it("Scenario: An unknown next_action fails the loop", async () => {
		const r = await runLoop([verdict(false, "nothing", "retry")], { script: { text: JUDGE_ONLY_ASSIGNING("done") } });
		await r.harness.close(context);
		expect(r.outcome.status).toBe("failed");
		expect(r.notes.join("\n")).toContain('"done"');
		expect(r.notes.join("\n")).toContain("task-script contract");
	});
});

describe("task/agent: Each iteration is recorded as an ontology Iteration", () => {
	it("Scenario: Actions and evidence are kept per iteration", async () => {
		const restore = fakePnpm();
		try {
			const r = await runLoop(
				[
					plan("edit and test"),
					toolCall("edit", { path: "src/a.ts", content: "export {};" }),
					toolCall("shell", { command: "pnpm test" }),
					text("Edited and tested."),
					verdict(true),
				],
				{ script: { path: BUNDLED_SCRIPTS.task.pathname }, checks: ["pnpm test"], allow: ["pnpm"] },
			);
			await r.harness.close(context);
			const [iteration] = r.outcome.iterations;
			expect(iteration?.n).toBe(1);
			expect(iteration?.plan).toBe("edit and test");
			expect(iteration?.actions).toContainEqual({ kind: "edit", summary: "create src/a.ts", refs: ["src/a.ts"] });
			expect(iteration?.actions).toContainEqual({ kind: "command", summary: "pnpm test", refs: ["pnpm test"] });
			expect(iteration?.evidence).toContainEqual({ kind: "diff", files: [{ path: "src/a.ts", change: "added" }] });
			expect(iteration?.evidence).toContainEqual({ kind: "check", command: "pnpm test", exitCode: 0, output: "ran test" });
			expect(iteration?.verdict).toEqual({ met: true, satisfied: [{ check: "task 1.1" }], unmet: [] });
			expect(iteration?.feedback).toEqual([]);
		} finally {
			restore();
		}
	});

	it("a script with no plan variable records an empty plan", async () => {
		const r = await runLoop([verdict(true)], { script: { text: JUDGE_ONLY.replace('    plan: mutable string = ""\n', "") } });
		await r.harness.close(context);
		expect(r.outcome.iterations[0]?.plan).toBe("");
	});
});

describe("task/agent: An unmet iteration carries one finding", () => {
	it("Scenario: A retry verdict is a code defect", async () => {
		const r = await runLoop([verdict(false, "red", "retry"), verdict(true)]);
		await r.harness.close(context);
		const [first] = r.outcome.iterations;
		expect(first?.verdict).toEqual({ met: false, satisfied: [], unmet: [{ target: { check: "task 1.1" }, reason: "red" }] });
		expect(first?.feedback).toHaveLength(1);
		expect(first?.feedback[0]).toEqual({
			action: "retry",
			from: {
				kind: "code-defect",
				target: { check: "task 1.1" },
				evidence: [{ kind: "review", reviewer: "agent", verdict: "changes", notes: "red" }],
				message: "red",
			},
		});
	});
});

describe("task/agent: The outcome is a LoopOutcome of TaskOutcome", () => {
	it("Scenario: A blocked outcome carries an escalation and no result", async () => {
		const r = await runLoop([verdict(false, "unsure", "ask", "Which?")]);
		await r.harness.close(context);
		expect(r.outcome.status).toBe("blocked");
		expect("escalation" in r.outcome).toBe(true);
		expect("result" in r.outcome).toBe(false);
		expect(check(LoopOutcome(TaskOutcome), r.outcome)).toBe(true);
	});

	it("every ending is a valid LoopOutcome, with result exactly when converged", async () => {
		for (const [responses, status] of [
			[[verdict(true)], "converged"],
			[[verdict(false, "x", "retry")], "exhausted"],
			[[text("no tool")], "failed"],
		] as const) {
			const r = await runLoop([...responses], { budget: { maxIterations: 1 } });
			await r.harness.close(context);
			expect(r.outcome.status).toBe(status);
			expect(check(LoopOutcome(TaskOutcome), r.outcome)).toBe(true);
			expect("result" in r.outcome).toBe(status === "converged");
			expect("escalation" in r.outcome).toBe(false);
		}
	});

	it("waitForTaskLoopResult carries the notes beside the outcome", async () => {
		const r = await runLoop([verdict(true)], {
			change: { proposal: { text: PROPOSAL }, deltas: [{ text: "x" }], tasks: { text: "- [ ] 1.1 do it\n" } },
		});
		const again = await waitForTaskLoopResult(r.harness, r.id, context);
		await r.harness.close(context);
		expect(again.outcome).toEqual(r.outcome);
		expect(again.notes).toEqual([expect.stringContaining("given as text")]);
	});
});
