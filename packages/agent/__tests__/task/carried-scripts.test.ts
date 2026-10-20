// The bundled task scripts show `carried` whenever it is non-empty: on the first iteration of a
// run resumed by an answer (which starts with no earlier iterations), and never on a fresh run.
// The judge sees it too, so it does not ask again a question the principal's answer settled.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { claudeCodeRunner } from "../../src/node/index.js";
import { BUNDLED_SCRIPTS, prepareTaskLoop, waitForTaskLoopResult, type TaskLoopOptions } from "../../src/task/index.js";
import { createLoop } from "../../src/task/start.js";
import { gitRepo } from "./cli-helpers.js";
import { COUNT_CHECK, cleanTemps, context, loopEnv, loopHarness, plan, prompts, runLoop, temp, text, tinyChange, verdict, type LoopActions } from "./helpers.js";

afterEach(() => cleanTemps());

const TASK_SCRIPT = fileURLToPath(BUNDLED_SCRIPTS.task);
const DELEGATE_SCRIPT = fileURLToPath(BUNDLED_SCRIPTS.delegate);
const ANSWER = "Use the v2 API";
const ORIENT = "Write a short, concrete plan for this iteration";
const JUDGE = "Is the task done against the spec deltas";
const JUDGE_CARRIED = "Feedback carried in (from an earlier iteration or the principal's answer)";
const OLD_JUDGE_CARRIED = "The principal's answer or earlier feedback";
const NO_REASK = "do not choose ask for that question again";

/** A fake `claude` that changes no file. */
function idleClaude(): string {
	const binary = join(temp("task-claude-"), "claude");
	writeFileSync(
		binary,
		`#!${process.execPath}\ntry { require("node:fs").readFileSync(0, "utf8"); } catch {}\nprocess.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "nothing" }));\n`,
		{ mode: 0o755 },
	);
	return binary;
}

/** The `claude_code` grant on a fake `claude` and a passing check. */
const granted = () => ({
	overrides: { delegates: { claude_code: { runner: "claude-code" as const } }, checks: [COUNT_CHECK] },
	actions: { runners: { "claude-code": claudeCodeRunner({ binary: idleClaude() }) } },
});

/**
 * A run shaped like one an answer resumes inside a group (`taskLoopInputFor`): no earlier
 * iterations, so its first iteration is 1, and `carried` the principal's answer.
 */
async function resumedLoop(
	responses: Parameters<ReturnType<typeof loopEnv>["env"]["faux"]["setResponses"]>[0],
	overrides: Partial<TaskLoopOptions>,
	actions: LoopActions,
	carried: string,
) {
	const { env, workspace } = loopEnv({
		...actions,
		...(overrides.workspace !== undefined ? { workspace: overrides.workspace } : {}),
		...(overrides.checks !== undefined ? { checks: overrides.checks } : {}),
		...(overrides.allow !== undefined ? { allow: overrides.allow } : {}),
		...(overrides.delegates !== undefined ? { delegates: overrides.delegates } : {}),
	});
	const harness = await loopHarness(env, new MemoryStorage());
	env.faux.setResponses(responses);
	const options: TaskLoopOptions = { change: { dir: tinyChange() }, task: "1.1", script: { path: TASK_SCRIPT }, workspace, model: env.model, ...overrides };
	const id = await createLoop(harness, { ...prepareTaskLoop(options), carried, earlier: [] }, context);
	harness.resume();
	const { outcome } = await waitForTaskLoopResult(harness, id, context);
	await harness.close(context);
	const all = prompts(env.requests);
	return { outcome, orients: all.filter((p) => p.includes(ORIENT)), judges: all.filter((p) => p.includes(JUDGE)) };
}

describe("task/agent: The bundled task scripts show carried feedback whenever it is non-empty", () => {
	it("Scenario: task.agent shows an answer on a resumed run's first iteration", async () => {
		const r = await resumedLoop(
			[plan("call v2"), text("Done."), verdict(true)],
			{ script: { path: TASK_SCRIPT }, workspace: gitRepo(), checks: [COUNT_CHECK], allow: ["pnpm", "node"] },
			{},
			ANSWER,
		);

		expect(r.outcome.status).toBe("converged");
		expect(r.outcome.iterations).toHaveLength(1);
		expect(r.orients).toHaveLength(1);
		expect(r.orients[0]).toContain(ANSWER);
		expect(r.orients[0]).toContain(`Carried in (still unmet from an earlier iteration, or the principal's answer): ${ANSWER}`);
		expect(r.orients[0]).not.toContain("This is iteration");
	});

	it("Scenario: task-delegate.agent shows an answer on a resumed run's first iteration", async () => {
		const grant = granted();
		const r = await resumedLoop(
			[plan("call v2"), verdict(true)],
			{ script: { path: DELEGATE_SCRIPT }, workspace: gitRepo(), budget: { maxIterations: 1 }, ...grant.overrides },
			grant.actions,
			ANSWER,
		);

		expect(r.outcome.status).toBe("converged");
		expect(r.orients).toHaveLength(1);
		expect(r.orients[0]).toContain(ANSWER);
		expect(r.orients[0]).toContain("the last approach did not work");
	});

	it("Scenario: A fresh run's first iteration shows no carried line", async () => {
		const task = await runLoop(
			[plan("touch nothing"), text("Nothing to change."), verdict(true)],
			{ script: { path: TASK_SCRIPT }, workspace: gitRepo(), checks: [COUNT_CHECK], allow: ["pnpm", "node"] },
		);
		await task.harness.close(context);
		const grant = granted();
		const delegate = await runLoop(
			[plan("touch nothing"), verdict(true)],
			{ script: { path: DELEGATE_SCRIPT }, workspace: gitRepo(), budget: { maxIterations: 1 }, ...grant.overrides },
			grant.actions,
		);
		await delegate.harness.close(context);

		for (const r of [task, delegate]) {
			expect(r.outcome.status).toBe("converged");
			const orients = prompts(r.env.requests).filter((p) => p.includes(ORIENT));
			expect(orients).toHaveLength(1);
			expect(orients[0]).not.toContain("Carried in");
			expect(orients[0]).not.toContain("This is iteration");
			const judges = prompts(r.env.requests).filter((p) => p.includes(JUDGE));
			expect(judges).toHaveLength(1);
			expect(judges[0]).not.toContain("Feedback carried in");
		}
	});

	it("Scenario: task.agent's judge sees an answer on a resumed run's first iteration", async () => {
		const r = await resumedLoop(
			[plan("call v2"), text("Done."), verdict(true)],
			{ script: { path: TASK_SCRIPT }, workspace: gitRepo(), checks: [COUNT_CHECK], allow: ["pnpm", "node"] },
			{},
			ANSWER,
		);

		expect(r.outcome.status).toBe("converged");
		expect(r.judges).toHaveLength(1);
		expect(r.judges[0]).toContain(`${JUDGE_CARRIED}: ${ANSWER}`);
		expect(r.judges[0]).toContain(NO_REASK);
		expect(r.judges[0]).not.toContain(OLD_JUDGE_CARRIED);
	});

	it("Scenario: task-delegate.agent's judge sees an answer on a resumed run's first iteration", async () => {
		const grant = granted();
		const r = await resumedLoop(
			[plan("call v2"), verdict(true)],
			{ script: { path: DELEGATE_SCRIPT }, workspace: gitRepo(), budget: { maxIterations: 1 }, ...grant.overrides },
			grant.actions,
			ANSWER,
		);

		expect(r.outcome.status).toBe("converged");
		expect(r.judges).toHaveLength(1);
		expect(r.judges[0]).toContain(`${JUDGE_CARRIED}: ${ANSWER}`);
		expect(r.judges[0]).toContain(NO_REASK);
		expect(r.judges[0]).not.toContain(OLD_JUDGE_CARRIED);
	});
});
