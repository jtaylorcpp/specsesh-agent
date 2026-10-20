// Every model step of the bundled task scripts sees the same system block, tool-less ones
// included, so the block is role-neutral and each step's prompt says its role. The judges see
// the plan as another step's instructions, and carried feedback under a neutral label.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { RESULT_TOOL } from "../../src/durable/index.js";
import { claudeCodeRunner } from "../../src/node/index.js";
import { BUNDLED_SCRIPTS } from "../../src/task/index.js";
import { gitRepo } from "./cli-helpers.js";
import { COUNT_CHECK, cleanTemps, context, plan, prompts, runLoop, temp, text, verdict } from "./helpers.js";

afterEach(() => cleanTemps());

const TASK_SCRIPT = fileURLToPath(BUNDLED_SCRIPTS.task);
const DELEGATE_SCRIPT = fileURLToPath(BUNDLED_SCRIPTS.delegate);
const NO_TOOLS = "You have no tools: decide only from the text below.";
const PLAN = "Edit src/a.ts";
const MET_LINE = "When the task is met, next_action is ignored: answer retry.";
const ANSWER_LINE = "Answer next_action with exactly one word: retry, amend-spec or ask. Put every explanation in unmet, never in next_action.";

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

/** The `claude_code` grant on a fake `claude` and a passing check, with `delete_file` granted or not. */
const granted = (deleteFiles: boolean) => ({
	overrides: { delegates: { claude_code: { runner: "claude-code" as const } }, checks: [COUNT_CHECK], ...(deleteFiles ? { deleteFiles } : {}) },
	actions: { runners: { "claude-code": claudeCodeRunner({ binary: idleClaude() }) }, ...(deleteFiles ? { deleteFiles } : {}) },
});

const retire = (path: string) => fauxAssistantMessage([fauxToolCall(RESULT_TOOL, { retire_path: path })], { stopReason: "toolUse" });

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

/** One converging iteration of task-delegate.agent whose orient answers PLAN. */
async function delegateRun(deleteFiles: boolean) {
	const grant = granted(deleteFiles);
	const r = await runLoop(
		deleteFiles ? [plan(PLAN), retire(""), verdict(true)] : [plan(PLAN), verdict(true)],
		{ script: { path: DELEGATE_SCRIPT }, workspace: gitRepo(), budget: { maxIterations: 1 }, ...grant.overrides },
		grant.actions,
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
		for (const r of [await taskRun(), await delegateRun(false)]) {
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
		for (const r of [await taskRun(), await delegateRun(false)]) {
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

	it("Scenario: task-delegate.agent's tool-less steps say their role", async () => {
		const all = prompts((await delegateRun(true)).env.requests);
		for (const name of ["orient", "retire", "judge"]) {
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

	it("Scenario: Without the delete grant, retire makes no model request", async () => {
		const all = prompts((await delegateRun(false)).env.requests);
		expect(step(all, "orient")).toHaveLength(1);
		expect(step(all, "retire")).toHaveLength(0);
	});
});

describe("task/agent: The bundled judges see the plan as another step's instructions", () => {
	it("Scenario: task-delegate.agent's judge sees the delegate's instructions", async () => {
		const [judge] = step(prompts((await delegateRun(false)).env.requests), "judge");
		expect(judge).toContain(`The instructions the delegate was given (for the delegate, not for you): ${PLAN}`);
		expect(judge!.split("\n").some((line) => line.startsWith("Plan:"))).toBe(false);
	});

	it("Scenario: task.agent's judge sees the act step's plan", async () => {
		const [judge] = step(prompts((await taskRun()).env.requests), "judge");
		expect(judge).toContain(`The plan the act step followed (for the act step, not for you): ${PLAN}`);
		expect(judge!.split("\n").some((line) => line.startsWith("Plan:"))).toBe(false);
	});
});

describe("task/agent: The bundled judges say what next_action is when the task is met", () => {
	it("Scenario: The judges say next_action is ignored when the task is met", async () => {
		for (const r of [await taskRun(), await delegateRun(false)]) {
			const [judge] = step(prompts(r.env.requests), "judge");
			const lines = judge!.split("\n");
			const at = lines.indexOf(MET_LINE);
			expect(at).toBeGreaterThan(-1);
			expect(lines[at + 1]).toBe(ANSWER_LINE);
		}
	});
});
