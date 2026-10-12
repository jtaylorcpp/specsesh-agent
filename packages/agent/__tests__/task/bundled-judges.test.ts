import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { apply, applyAction, next, start, type ReasoningRequest, type VariableValue } from "../../src/interpreter/index.js";
import { SCRIPTS } from "./helpers.js";

const TASK_VARIABLES: Record<string, VariableValue> = {
	task_id: "2.4",
	task_text: "Make the thing work",
	proposal: "A proposal.",
	design: "",
	deltas: "## task/agent\nA delta.",
	iteration: 1,
	carried: "",
};

const GROUP_VARIABLES: Record<string, VariableValue> = {
	group_number: 2,
	group_title: "The group",
	tasks: "2.1 First — converged\n2.2 Second — converged",
	proposal: "A proposal.",
	deltas: "## task/group\nA delta.",
	check_output: "pnpm test exited 1",
	rework_count: 1,
};

const read = (name: string): string => readFileSync(join(SCRIPTS, name), "utf8");

/** The script's subagents, in source order. */
function subagents(source: string): string[] {
	return [...source.matchAll(/^subagent (\w+):/gm)].map((m) => m[1] as string);
}

/** A minimal structured answer for a schema: one placeholder per property, by type. */
function faux(schema: unknown): Record<string, unknown> {
	const properties = (schema as { properties?: Record<string, { type?: string }> }).properties ?? {};
	const answer: Record<string, unknown> = {};
	for (const [name, { type }] of Object.entries(properties)) {
		answer[name] = type === "number" || type === "integer" ? 0 : type === "boolean" ? true : "x";
	}
	return answer;
}

/**
 * Walk the script with faux answers until the step that writes `next_action`, and
 * return its request. Earlier reasoning steps get a minimal answer, deterministic
 * actions a canned ok result. No port, no provider.
 */
function composeJudge(source: string, variables: Record<string, VariableValue>): ReasoningRequest {
	let state = start(source, { entry: subagents(source), variables });
	for (let guard = 0; guard < 50; guard += 1) {
		const step = next(source, state);
		if (step.type === "done") throw new Error("the run finished without a step that writes next_action");
		if (step.type === "action") {
			const outputs: Record<string, VariableValue> | undefined =
				step.call.action === "run_checks"
					? { passed: true, output: "ok" }
					: step.call.action === "delegate_claude_code"
						? { ok: true, summary: "done" }
						: undefined;
			if (outputs === undefined) throw new Error(`unexpected action ${step.call.action}`);
			state = applyAction(source, step.state, { ok: true, outputs });
			continue;
		}
		const schema = step.request.outputSchema as { properties?: Record<string, unknown> } | undefined;
		if (schema?.properties !== undefined && "next_action" in schema.properties) return step.request;
		const answer =
			schema === undefined
				? { kind: "answered" as const, text: "ok" }
				: { kind: "answered" as const, text: "ok", structured: faux(schema) };
		state = apply(source, step.state, answer);
	}
	throw new Error("no judge step within 50 steps");
}

describe.each(["task.agent", "task-delegate.agent"])("task/agent: The judge defaults to retry (%s)", (name) => {
	it("Scenario: The judge prompt says retry is the default", () => {
		const { prompt } = composeJudge(read(name), TASK_VARIABLES);
		expect(prompt).toContain("It is done only when the checks pass");
		expect(prompt).toContain("Default to retry");
		expect(prompt).toContain("Answer next_action with exactly one word");
	});
});

describe("task/group: The bundled judge prefers rework", () => {
	it("Scenario: The bundled judge reworks first", () => {
		const { prompt } = composeJudge(read("group.agent"), { ...GROUP_VARIABLES, rework_count: 1 });
		expect(prompt).toContain("rework the task most likely at fault");
		expect(prompt).not.toContain("Prefer asking");
	});
});
