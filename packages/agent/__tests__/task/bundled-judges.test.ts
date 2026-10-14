import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { apply, applyAction, next, start, type ReasoningRequest, type VariableValue } from "../../src/interpreter/index.js";
import { BUNDLED_SCRIPTS } from "../../src/task/index.js";
import { SCRIPTS, cleanTemps, context, fakePnpm, plan, runLoop, text, tinyChange, verdict } from "./helpers.js";

afterEach(cleanTemps);

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
					: step.call.tool === "delegate/claude_code"
						? { ok: true, summary: "done", files_changed: 1 }
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

type Offered = { name: string; parameters?: { properties?: Record<string, Record<string, unknown>> } };

/**
 * Run the bundled task.agent over `change` to one met verdict, and return the
 * properties of the first `submit_result` offered with `next_action`: the judge's.
 */
async function dispatchJudge(change: string = tinyChange()): Promise<Record<string, Record<string, unknown>>> {
	const restore = fakePnpm();
	try {
		const r = await runLoop([plan("p"), text("Done."), verdict(true)], {
			change: { dir: change },
			script: { path: BUNDLED_SCRIPTS.task.pathname },
			checks: ["pnpm test"],
			allow: ["pnpm"],
		});
		await r.harness.close(context);
		expect(r.outcome.status).toBe("converged");
		const judge = r.env.requests
			.flatMap((request) =>
				(request.messages as unknown as { role: string; toolsAdded?: Offered[] }[])
					.filter((m) => m.role === "system")
					.flatMap((m) => m.toolsAdded ?? []),
			)
			.find((t) => t.name === "submit_result" && t.parameters?.properties?.["next_action"] !== undefined);
		if (judge?.parameters?.properties === undefined) throw new Error("no judge step was dispatched");
		return judge.parameters.properties;
	} finally {
		restore();
	}
}

describe.each(["task.agent", "task-delegate.agent"])("task/agent: The judge defaults to retry (%s)", (name) => {
	it("Scenario: The judge prompt says retry is the default", () => {
		const { prompt } = composeJudge(read(name), TASK_VARIABLES);
		expect(prompt).toContain("It is done only when the checks pass");
		expect(prompt).toContain("Default to retry");
		expect(prompt).toContain("Answer next_action with exactly one word");
	});
});

describe.each(["task.agent", "task-delegate.agent"])("task/agent: The script declares the variables the loop reads back (%s)", (name) => {
	it("Scenario: The judge prompt asks for the whole file", () => {
		const { prompt } = composeJudge(read(name), TASK_VARIABLES);
		expect(prompt).toContain("set amend_path to the delta that is wrong");
		expect(prompt).toContain("the whole new text of that file, not a patch");
		expect(prompt).toContain("leave both empty");
	});
});

describe("task/agent: The loop constrains next_action to its contract values", () => {
	it("Scenario: The judge step's schema lists the three values", async () => {
		const properties = await dispatchJudge();
		expect(properties["next_action"]).toEqual({ type: "string", enum: ["retry", "amend-spec", "ask"] });
	});

	it("Scenario: The judge step's schema lists the change's deltas", async () => {
		// Written host first: the choices follow the sorted deltas, not the file system.
		const properties = await dispatchJudge(tinyChange({ capabilities: ["durable/host", "durable/cli"] }));
		expect(properties["amend_path"]?.["enum"]).toEqual(["", "specs/durable/cli/spec.md", "specs/durable/host/spec.md"]);
		expect(properties["amend_text"]?.["type"]).toBe("string");
		expect(properties["amend_text"]).not.toHaveProperty("enum");
	});
});

describe("task/group: The bundled judge prefers rework", () => {
	it("Scenario: The bundled judge reworks first", () => {
		const { prompt } = composeJudge(read("group.agent"), { ...GROUP_VARIABLES, rework_count: 1 });
		expect(prompt).toContain("rework the task most likely at fault");
		expect(prompt).not.toContain("Prefer asking");
	});

	it("Scenario: The bundled judge is told how to amend a delta", () => {
		const { prompt } = composeJudge(read("group.agent"), { ...GROUP_VARIABLES, rework_count: 1 });
		expect(prompt).toContain("when the spec delta itself is wrong");
		expect(prompt).toContain("amend-spec");
		expect(prompt).toContain("amend_path");
		expect(prompt).toContain("amend_text");
	});
});
