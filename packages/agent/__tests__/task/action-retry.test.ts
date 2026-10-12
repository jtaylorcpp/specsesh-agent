import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { RunResult } from "../../src/interpreter/index.js";
import { claudeCodeRunner } from "../../src/node/index.js";
import { failedActionOf, readRun } from "../../src/task/iteration.js";
import { SCRIPTS, cleanTemps, context, plan, prompts, runLoop, temp, verdict } from "./helpers.js";

afterEach(cleanTemps);

/** task-delegate.agent without its checks subagent, so no gate or `run_checks` is involved. */
const DELEGATE_NO_CHECKS = (() => {
	const source = readFileSync(join(SCRIPTS, "task-delegate.agent"), "utf8");
	return source.slice(0, source.indexOf("subagent check:")) + source.slice(source.indexOf("subagent judge:"));
})();

const FAKE_CLAUDE = `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "Edited." }));\n`;

/** A binary path with nothing at it: the delegate action answers `ok` false (it could not start). */
const missingClaude = () => join(temp("task-claude-"), "claude");
const installClaude = (path: string) => {
	writeFileSync(path, FAKE_CLAUDE, { mode: 0o755 });
	chmodSync(path, 0o755);
};

/** The `claude_code` grant, its runner on `binary`. */
const granted = (binary: string) => ({
	overrides: { delegates: { claude_code: { runner: "claude-code" } } },
	actions: { runners: { "claude-code": claudeCodeRunner({ binary }) } },
});

const TIMED_OUT = "Claude Code timed out after 900000ms";
const failedRun = (message: string): RunResult => ({
	kind: "failed",
	steps: [],
	actions: [
		{
			subagent: "act",
			call: { subagent: "act", action: "claude_code", tool: "delegate/claude_code", inputs: {}, index: 0 },
			result: { ok: false, message },
		},
	],
	variables: { plan: "p" },
});

describe("task/agent: A run ended by a failed action is retried within budget", () => {
	it("Scenario: A delegate timeout costs one iteration", async () => {
		// The timeout itself takes ten minutes to happen, so a pure read pins its message and the loop runs on the other `ok` false answer.
		expect(failedActionOf(failedRun(TIMED_OUT))).toEqual({ action: "claude_code", message: TIMED_OUT });
		expect(readRun(failedRun(TIMED_OUT), undefined, ["act"])).toMatchObject({ ok: false, actionFailed: true, message: TIMED_OUT });

		const claude = missingClaude();
		const grant = granted(claude);
		const r = await runLoop(
			[
				plan("edit a"),
				// Iteration 2 begins here: the binary now exists, so the delegate succeeds.
				() => {
					installClaude(claude);
					return plan("edit a again");
				},
				verdict(true),
			],
			{ script: { text: DELEGATE_NO_CHECKS }, budget: { maxIterations: 8 }, ...grant.overrides },
			grant.actions,
		);
		await r.harness.close(context);

		expect(r.outcome.status).toBe("converged");
		expect(r.outcome.iterations).toHaveLength(2);
		const [first] = r.outcome.iterations;
		expect(first?.verdict.met).toBe(false);
		expect(first?.verdict.unmet[0]?.reason).toContain("Claude Code could not start");
		expect(first?.feedback[0]).toMatchObject({ action: "retry", from: { kind: "environment" } });
		expect(prompts(r.env.requests)[1]).toContain("Still unmet from before: Claude Code could not start");
	});

	it("Scenario: A failed action on the last iteration exhausts", async () => {
		const grant = granted(missingClaude());
		const r = await runLoop([plan("edit a")], { script: { text: DELEGATE_NO_CHECKS }, budget: { maxIterations: 1 }, ...grant.overrides }, grant.actions);
		await r.harness.close(context);

		expect(r.outcome.status).toBe("exhausted");
		expect(r.outcome.iterations).toHaveLength(1);
		expect(r.outcome.iterations[0]?.verdict.met).toBe(false);
	});

	it("Scenario: A failed step still fails the loop", async () => {
		// The faux provider carries no HTTP status, so its failed step is `unknown`; a pure read pins `rate_limit`.
		const rateLimited: RunResult = {
			kind: "failed",
			steps: [{ subagent: "judge", request: {} as never, outcome: { kind: "failed", category: "rate_limit", message: "slow down" } }],
			actions: [],
			variables: {},
		};
		expect(failedActionOf(rateLimited)).toBeUndefined();
		expect(readRun(rateLimited, undefined, ["judge"])).toMatchObject({ ok: false, message: expect.stringContaining("rate_limit") });
		expect(readRun(rateLimited, undefined, ["judge"])).not.toHaveProperty("actionFailed");

		const r = await runLoop([fauxAssistantMessage([], { stopReason: "error", errorMessage: "slow down" })], { budget: { maxIterations: 8 } });
		await r.harness.close(context);

		expect(r.outcome.status).toBe("failed");
		expect(r.outcome.iterations).toHaveLength(1);
		expect(r.outcome.iterations[0]?.feedback[0]?.from.kind).toBe("environment");
		expect(r.notes[0]).toMatch(/^the run ended failed/);
	});
});
