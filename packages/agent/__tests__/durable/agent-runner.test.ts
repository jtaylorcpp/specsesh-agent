/**
 * The `agent` runner at runner level: grant terms, the checks against a
 * harness's models and registry, the child's `RunInput`, and `finish`'s mapping.
 * The harness wiring and a real child run are separate tasks.
 */

import type { TaskOutcome } from "@earendil-works/pi-durable";
import { describe, expect, it } from "vitest";
import { validateGrants } from "../../src/durable/delegation.js";
import {
	DelegateGrantError,
	agentRunner,
	createActionRegistry,
	isAgentDelegate,
	type AgentRunnerContext,
	type DurableFinishContext,
	type ExecutedHostAction,
	type HostAction,
} from "../../src/durable/index.js";
import type { RunResult, VariableValue } from "../../src/interpreter/index.js";
import { hostAction } from "./action-scripts.js";

const reader = (name: string): ExecutedHostAction => ({
	name,
	kind: "read",
	inputs: { glob: "string" },
	outputs: { paths: "string" },
	replay: "safe",
	execute: async () => ({ ok: true, outputs: { paths: "" } }),
});

const registry = createActionRegistry([
	hostAction("read_file", async () => ({ ok: true, outputs: { content: "" } })),
	hostAction("edit_file", async () => ({ ok: true, outputs: { ok: true } })),
	reader("list_files"),
	reader("search_files"),
]);

const models = { default: { provider: "faux", modelId: "small" }, opus: { provider: "faux", modelId: "big" } };
const context: AgentRunnerContext = { models, actions: registry };

const READ_ACTION = `        read_file:
            description: "Read a file in the workspace"
            inputs:
                path: string
            outputs:
                content: string
            target: "mcpTool://read_file"
`;

const EDIT_ACTION = `        edit_file:
            description: "Replace a file's content in the workspace"
            inputs:
                path: string
                content: string
            outputs:
                ok: boolean
            target: "mcpTool://edit_file"
`;

/** A delegate script with two subagents; `variables` replaces the contract block. */
function delegateScript({ actions = READ_ACTION, variables }: { actions?: string; variables?: string } = {}): string {
	return `config:
    agent_name: "delegate"

variables:
${variables ?? `    instructions: mutable string = ""
    ok: mutable boolean = False
    summary: mutable string = ""`}

subagent work:
    description: "Work"

    actions:
${actions}
    reasoning:
        instructions: ->
            | {!@variables.instructions}

subagent report:
    description: "Report"

    reasoning:
        instructions: ->
            | Report.
`;
}

function build(grant: Record<string, unknown>) {
	const runner = agentRunner();
	const [terms] = validateGrants({ reviewer: { runner: "agent", ...grant } as never }, { agent: runner });
	return runner.action(terms!, context);
}

function refusal(grant: Record<string, unknown>): DelegateGrantError {
	try {
		build(grant);
	} catch (error) {
		expect(error).toBeInstanceOf(DelegateGrantError);
		return error as DelegateGrantError;
	}
	throw new Error("the grant was accepted");
}

const completed = (variables: Record<string, VariableValue>): TaskOutcome<RunResult> => ({
	status: "completed",
	result: { kind: "completed", steps: [], actions: [], variables },
});

function finishContext(extra: Partial<DurableFinishContext> = {}): DurableFinishContext {
	return { workspace: "/w", child: 7 as DurableFinishContext["child"], ...extra };
}

describe("agentRunner", () => {
	it("is kind agent and builds a branded, durable delegate/<name>", () => {
		expect(agentRunner().kind).toBe("agent");
		const action = build({ model: "opus", script: delegateScript() });
		expect(action.name).toBe("delegate/reviewer");
		expect(action.replay).toBe("safe");
		expect(action.durable).toBeDefined();
		expect(isAgentDelegate(action)).toBe(true);
		expect(isAgentDelegate(registry.get("read_file") as HostAction)).toBe(false);
		// The brand lets a registry hold it.
		expect(createActionRegistry([action]).get("delegate/reviewer")).toBe(action);
	});

	it("fills tools and maxSteps with their defaults", () => {
		const [terms] = validateGrants({ reviewer: { runner: "agent", model: "default", script: "x" } }, { agent: agentRunner() });
		expect(terms!["tools"]).toEqual(["read_file", "list_files", "search_files"]);
		expect(terms!["maxSteps"]).toBe(20);
	});

	it("refuses an unknown key and a non-positive maxSteps", () => {
		expect(() => validateGrants({ r: { runner: "agent", model: "default", script: "x", allow: [] } }, { agent: agentRunner() })).toThrow(
			/allow is not a key the agent runner accepts/,
		);
		expect(() => validateGrants({ r: { runner: "agent", model: "default", script: "x", maxSteps: 0 } }, { agent: agentRunner() })).toThrow(
			/maxSteps must be a positive integer/,
		);
	});

	it("requires model and script", () => {
		expect(refusal({ script: delegateScript() }).message).toContain("model is required");
		expect(refusal({ model: "default" }).message).toContain("script is required");
	});

	it("refuses an unknown model, listing the models", () => {
		const error = refusal({ model: "haiku", script: delegateScript() });
		expect(error.grant).toBe("reviewer");
		expect(error.message).toMatch(/haiku.*default, opus/);
	});

	it("refuses a delegate/ tool and an unregistered tool", () => {
		expect(refusal({ model: "default", script: delegateScript(), tools: ["read_file", "delegate/claude_code"] }).message).toContain(
			"delegate/claude_code",
		);
		expect(refusal({ model: "default", script: delegateScript(), tools: ["run_checks"] }).message).toContain("run_checks is not registered");
	});

	it("refuses a script that uses a tool it was not granted", () => {
		const error = refusal({ model: "default", script: delegateScript({ actions: READ_ACTION + EDIT_ACTION }), tools: ["read_file"] });
		expect(error.key).toBe("script");
		expect(error.message).toContain("edit_file");
	});

	it("refuses a script that breaks the delegate contract, naming the variable and its type", () => {
		const error = refusal({
			model: "default",
			script: delegateScript({ variables: `    instructions: mutable string = ""\n    ok: mutable boolean = False` }),
		});
		expect(error.message).toMatch(/summary.*string/);
		const mistyped = refusal({
			model: "default",
			script: delegateScript({ variables: `    instructions: mutable string = ""\n    ok: mutable string = ""\n    summary: mutable string = ""` }),
		});
		expect(mistyped.message).toMatch(/ok is declared string; the contract needs boolean/);
	});

	it("refuses a script that does not parse", () => {
		expect(refusal({ model: "default", script: "subagent : :" }).key).toBe("script");
	});

	it("starts the child with every subagent, the instructions, the model, scope and maxSteps", async () => {
		const action = build({ model: "opus", script: delegateScript(), tools: ["read_file"], maxSteps: 3 });
		const input = await action.durable.start({ instructions: "Review src/a.ts" }, { workspace: "/w" });
		expect(input).toEqual({
			source: delegateScript(),
			options: { entry: ["work", "report"], variables: { instructions: "Review src/a.ts" } },
			model: models.opus,
			scope: ["read_file"],
			maxSteps: 3,
		});
	});

	it("refuses to start past maxCalls", async () => {
		const action = build({ model: "default", script: delegateScript(), maxCalls: 1 });
		const started = await action.durable.start({ instructions: "x" }, { workspace: "/w", priorCalls: () => 1 });
		expect(started).toEqual({ ok: false, message: "delegate reviewer reached its limit of 1 calls in this run" });
	});

	it("answers the child's ok and summary, recording the delegate and the child", async () => {
		const action = build({ model: "default", script: delegateScript() });
		const result = await action.durable.finish({}, completed({ ok: true, summary: "Looks right.\nDetails." }), finishContext());
		expect(result).toMatchObject({ ok: true, outputs: { ok: true, summary: "Looks right.\nDetails.", files_changed: -1 } });
		expect(result.record).toEqual({
			action: { kind: "delegate", summary: "Looks right.", refs: ["delegate/reviewer", "run:7"] },
			evidence: [],
		});
	});

	it("counts the files the child changed, with DiffEvidence", async () => {
		const action = build({ model: "default", script: delegateScript() });
		const result = await action.durable.finish(
			{},
			completed({ ok: true, summary: "Edited." }),
			finishContext({ before: new Map([["src/a.ts", " M:aaa"]]), after: new Map([["src/a.ts", " M:bbb"]]) }),
		);
		expect(result).toMatchObject({ ok: true, outputs: { files_changed: 1 } });
		expect((result.record as { evidence: unknown }).evidence).toEqual([{ kind: "diff", files: [{ path: "src/a.ts", change: "modified" }] }]);
	});

	it("fails the call with the child's summary when it answers ok false", async () => {
		const action = build({ model: "default", script: delegateScript() });
		const result = await action.durable.finish({}, completed({ ok: false, summary: "Could not find it." }), finishContext());
		expect(result).toMatchObject({ ok: false, message: "Could not find it." });
	});

	it("fails the call with the child's failure message when it did not complete", async () => {
		const action = build({ model: "default", script: delegateScript() });
		const failed: TaskOutcome<RunResult> = {
			status: "completed",
			result: {
				kind: "failed",
				steps: [
					{
						subagent: "work",
						request: {} as never,
						outcome: { kind: "failed", category: "unknown", message: "reached its limit of 1 steps" },
					},
				],
				actions: [],
				variables: { ok: true, summary: "" },
			},
		};
		const result = await action.durable.finish({}, failed, finishContext());
		expect(result).toMatchObject({ ok: false, message: "reached its limit of 1 steps" });
		expect(result.record).toMatchObject({ action: { summary: "reached its limit of 1 steps", refs: ["delegate/reviewer", "run:7"] } });
		const crashed = await action.durable.finish({}, { status: "failed", error: { message: "boom" } }, finishContext());
		expect(crashed).toMatchObject({ ok: false, message: "boom" });
	});
});
