// Every model step of the bundled task scripts sees the same system block, tool-less ones
// included, so the block is role-neutral and each step's prompt says its role. The judges see
// the plan as another step's instructions, and carried feedback under a neutral label.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { RESULT_TOOL } from "../../src/durable/index.js";
import { BUNDLED_SCRIPTS } from "../../src/task/index.js";
import { gitRepo } from "./cli-helpers.js";
import { COUNT_CHECK, cleanTemps, context, plan, prompts, runLoop, temp, text, toolCall, verdict } from "./helpers.js";

afterEach(() => cleanTemps());

const TASK_SCRIPT = fileURLToPath(BUNDLED_SCRIPTS.task);
const NO_TOOLS = "You have no tools: decide only from the text below.";
const PLAN = "Edit src/a.ts";
const MET_LINE = "When the task is met, next_action is ignored: answer retry.";
const ANSWER_LINE = "Answer next_action with exactly one word: retry, amend-spec or ask. Put every explanation in unmet, never in next_action.";

/** One converging iteration of task.agent whose orient answers PLAN. */
async function taskRun() {
	const r = await runLoop(
		[plan(PLAN), text("Nothing to change."), verdict(true)],
		{ script: { path: TASK_SCRIPT }, workspace: gitRepo(), checks: [COUNT_CHECK], allow: ["pnpm", "node"] },
	);
	await r.harness.close(context);
	expect(r.outcome.status).toBe("converged");
	return r;
}

/** Each model request's `instructions` section, without pi-durable's wrapping tag. */
function instructionSections(requests: readonly { messages: readonly unknown[] }[]): string[] {
	return requests.map((request) => {
		const messages = request.messages as { role: string; sections?: Record<string, string> }[];
		const section = Object.assign({}, ...messages.filter((m) => m.role === "system").map((m) => m.sections ?? {}))["instructions"] as string;
		return section.replace(/^<instructions>\n/, "");
	});
}

const step = (all: string[], name: string) => all.filter((p) => p.startsWith(`You are the ${name} step`));

describe("task/agent: The bundled task scripts' system block is role-neutral", () => {
	it("Scenario: The system block names no workspace", async () => {
		for (const r of [await taskRun()]) {
			const sections = instructionSections(r.env.requests);
			expect(sections.length).toBeGreaterThan(0);
			for (const section of sections) {
				expect(section.startsWith("You are one step of a task loop that implements one task of an OpenSpec change")).toBe(true);
				expect(section).toContain("Each step's prompt says its role.");
				expect(section).toContain("A step without tools decides only from the text it is given.");
				expect(section).not.toContain("real workspace");
				expect(section).not.toContain("You implement one task");
			}
		}
	});

	it("Scenario: The system block keeps the contract rules", async () => {
		for (const r of [await taskRun()]) {
			const section = instructionSections(r.env.requests)[0];
			expect(section).toContain("The spec deltas are the contract");
			expect(section).toContain("never tick boxes");
			expect(section).toContain("never edit the spec");
			expect(section).toContain("If the spec itself looks wrong, say so");
		}
	});
});

describe("task/agent: Each bundled task step's prompt says its role", () => {
	it("Scenario: task.agent's tool-less steps say their role", async () => {
		const all = prompts((await taskRun()).env.requests);
		for (const name of ["orient", "judge"]) {
			const found = step(all, name);
			expect(found).toHaveLength(1);
			expect(found[0]).toContain(NO_TOOLS);
		}
	});

	it("Scenario: task.agent's act step acts in the real workspace", async () => {
		const all = prompts((await taskRun()).env.requests);
		const act = step(all, "act");
		expect(act).toHaveLength(1);
		expect(act[0]).toContain("you act in the real workspace");
		expect(act[0]).toContain("Carry out this plan");
		expect(act[0]).not.toContain("You have no tools");
	});

	it("Scenario: task.agent's act step can search and list the workspace", async () => {
		const r = await runLoop(
			[plan(PLAN), toolCall("search", { pattern: "a = 1", glob: "src/**" }), toolCall("list", { glob: "src/*" }), text("Found it."), verdict(true)],
			{ script: { path: TASK_SCRIPT }, workspace: gitRepo(), checks: [COUNT_CHECK], allow: ["pnpm", "node"] },
		);
		await r.harness.close(context);
		expect(r.outcome.status).toBe("converged");
		// Each call's result reaches the model in the act step's next request, as a successful tool result.
		type Message = { role: string; toolName?: string; isError?: boolean; content?: { type: string; text?: string }[] };
		const results = (r.env.requests.at(-2)?.messages ?? []) as unknown as Message[];
		const result = (tool: string) => {
			const found = results.find((m) => m.role === "toolResult" && m.toolName === tool);
			expect(found?.isError, tool).toBe(false);
			return JSON.parse(found?.content?.[0]?.text ?? "{}") as Record<string, string>;
		};
		expect(result("search")).toEqual({ matches: "src/a.ts:1: export const a = 1;" });
		expect(result("list")).toEqual({ paths: "src/a.ts" });
	});

});

describe("task/agent: The bundled judges see the plan as another step's instructions", () => {
	it("Scenario: task.agent's judge sees the act step's plan", async () => {
		const [judge] = step(prompts((await taskRun()).env.requests), "judge");
		expect(judge).toContain(`The plan the act step followed (for the act step, not for you): ${PLAN}`);
		expect(judge!.split("\n").some((line) => line.startsWith("Plan:"))).toBe(false);
	});
});

describe("task/agent: The bundled judges say what next_action is when the task is met", () => {
	it("Scenario: The judges say next_action is ignored when the task is met", async () => {
		for (const r of [await taskRun()]) {
			const [judge] = step(prompts(r.env.requests), "judge");
			const lines = judge!.split("\n");
			const at = lines.indexOf(MET_LINE);
			expect(at).toBeGreaterThan(-1);
			expect(lines[at + 1]).toBe(ANSWER_LINE);
		}
	});
});
