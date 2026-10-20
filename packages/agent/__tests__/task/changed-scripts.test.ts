// What the bundled task scripts show of `changed`: the judge's files lines and question, and
// orient's earlier work. Composed with the interpreter alone: no port, no provider.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { apply, applyAction, next, start, type VariableValue } from "../../src/interpreter/index.js";
import { SCRIPTS } from "./helpers.js";

const BUNDLED = ["task.agent", "task-delegate.agent"] as const;

const read = (name: string): string => readFileSync(join(SCRIPTS, name), "utf8");

/** The contract's seeds, for iteration `iteration` with `changed`. */
const seeded = (iteration: number, changed: string): Record<string, VariableValue> => ({
	task_id: "1.1",
	task_text: "Make the thing work",
	proposal: "A proposal.",
	design: "",
	deltas: "## task/agent\nA delta.",
	iteration,
	carried: "",
	changed,
});

/** A minimal structured answer for a schema: one placeholder per property, by type. */
function faux(schema: unknown): Record<string, unknown> {
	const properties = (schema as { properties?: Record<string, { type?: string }> }).properties ?? {};
	return Object.fromEntries(
		Object.entries(properties).map(([name, { type }]) => [name, type === "number" || type === "integer" ? 0 : type === "boolean" ? true : "x"]),
	);
}

/** The subagents in source order. */
const entries = (source: string) => [...source.matchAll(/^subagent (\w+):/gm)].map((m) => m[1] as string);

/** The prompt of the first reasoning step: orient's. */
function orientPrompt(source: string, variables: Record<string, VariableValue>): string {
	const step = next(source, start(source, { entry: entries(source), variables }));
	if (step.type !== "request") throw new Error(`the first step is ${step.type}, not orient's`);
	return step.request.prompt;
}

/**
 * The judge's prompt: the run walked with faux answers to the step that writes `next_action`.
 * The delegate, when there is one, answers as one that changed `filesChanged` files.
 */
function judgePrompt(source: string, variables: Record<string, VariableValue>, filesChanged = 0): string {
	let state = start(source, { entry: entries(source), variables });
	for (let guard = 0; guard < 50; guard += 1) {
		const step = next(source, state);
		if (step.type === "done") throw new Error("the run finished without a judge step");
		if (step.type === "action") {
			const outputs: Record<string, VariableValue> =
				step.call.action === "run_checks" ? { passed: true, output: "ok" } : { ok: true, summary: "nothing to do", files_changed: filesChanged };
			state = applyAction(source, step.state, { ok: true, outputs });
			continue;
		}
		const schema = step.request.outputSchema as { properties?: Record<string, unknown> } | undefined;
		if (schema?.properties !== undefined && "next_action" in schema.properties) return step.request.prompt;
		state = apply(source, step.state, schema === undefined ? { kind: "answered", text: "ok" } : { kind: "answered", text: "ok", structured: faux(schema) });
	}
	throw new Error("no judge step within 50 steps");
}

describe("task/agent: The bundled task judges see the changes since the loop started", () => {
	it("Scenario: The judge counts work done in an earlier iteration", () => {
		const prompt = judgePrompt(read("task-delegate.agent"), seeded(2, "src/a.ts"));
		expect(prompt).toContain("Files changed since the loop started (iteration 2):\nsrc/a.ts");
		expect(prompt).toContain("Files the delegate changed in this iteration: 0");
	});

	it("Scenario: task.agent's judge shows none on a fresh loop", () => {
		const prompt = judgePrompt(read("task.agent"), seeded(1, ""));
		expect(prompt).toContain("Files changed since the loop started (iteration 1):\nnone");
	});

	it("Scenario: The judge asks about the work since the loop started", () => {
		for (const name of BUNDLED) {
			const prompt = judgePrompt(read(name), seeded(1, ""));
			expect(prompt, name).toContain("counting the work of every iteration since the loop started");
			expect(prompt, name).toContain("It is done only when the checks pass");
		}
	});

	it("Scenario: Orient shows earlier work from iteration 2", () => {
		for (const name of BUNDLED) {
			const later = orientPrompt(read(name), seeded(2, "src/a.ts"));
			expect(later, name).toContain("Files changed since the loop started:\nsrc/a.ts");
			expect(later, name).toContain("Earlier iterations may already have done part of the task");
			expect(orientPrompt(read(name), seeded(1, "")), name).not.toContain("Files changed since the loop started");
		}
	});
});

describe("task/agent: The delegate script shows the judge what changed and changes approach", () => {
	it("Scenario: The judge sees an idle delegate after earlier changes", () => {
		const prompt = judgePrompt(read("task-delegate.agent"), seeded(2, "src/a.ts"));
		expect(prompt).toContain(
			"Files the delegate changed in this iteration: 0 (-1 means unknown). Earlier iterations may already have done the work, so 0 alone does not mean the task is unfinished.",
		);
		expect(prompt).not.toContain("0 means the delegate changed nothing");
	});

	it("Scenario: The judge sees a delegate that changed files", () => {
		const prompt = judgePrompt(read("task-delegate.agent"), seeded(1, ""), 2);
		expect(prompt).toContain("Files the delegate changed in this iteration: 2 (-1 means unknown).");
		expect(prompt).not.toContain("0 means the delegate changed nothing");
	});
});
