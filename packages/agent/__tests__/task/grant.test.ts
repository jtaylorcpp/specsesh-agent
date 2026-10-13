// The `delete_file` grant: stored with the loop and bound by the harness, or, ungranted, an
// optional target the start lets through, hidden from model steps and refused when called.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DELETE_NOT_GRANTED, type TaskLoopInput } from "../../src/task/index.js";
import { JUDGE_ONLY, cleanTemps, context, runLoop, runTasks, temp, text, verdict } from "./helpers.js";

afterEach(() => cleanTemps());

const DELETE_ACTION = `    actions:
        delete_file:
            description: "Delete a file in the workspace"
            inputs:
                path: string
            outputs:
                ok: boolean
            target: "mcpTool://delete_file"
`;

/** JUDGE_ONLY with a subagent before the judge that deletes `path` without the model. */
const deleting = (path: string) =>
	JUDGE_ONLY.replace(
		"subagent judge:",
		`subagent retire:
    description: "Delete the retired file"

${DELETE_ACTION}
    reasoning:
        instructions: ->
            run @actions.delete_file
                with path = "${path}"

subagent judge:`,
	);

/** JUDGE_ONLY declaring `delete_granted`, with a model step offered `delete_file` before the judge. */
const OFFERING = JUDGE_ONLY.replace("    plan: mutable string = \"\"\n", "    plan: mutable string = \"\"\n    delete_granted: mutable boolean = False\n").replace(
	"subagent judge:",
	`subagent act:
    description: "Carry out the task"

${DELETE_ACTION}
    reasoning:
        instructions: ->
            | Granted: {!@variables.delete_granted}
            | Carry out the task.
        actions:
            remove: @actions.delete_file
                with path = ...

subagent judge:`,
);

/** The tools a model request was offered: pi-durable lists them on its system messages. */
function offeredTools(request: { messages: readonly unknown[] } | undefined): string[] {
	const messages = (request?.messages ?? []) as { role: string; toolsAdded?: { name: string }[] }[];
	return messages.filter((m) => m.role === "system").flatMap((m) => m.toolsAdded ?? []).map((t) => t.name);
}

/** A workspace holding `path`. */
function workspaceWith(path: string): string {
	const workspace = temp("task-ws-");
	mkdirSync(join(workspace, "src"), { recursive: true });
	writeFileSync(join(workspace, path), "export {};\n");
	return workspace;
}

describe("task/agent: A harness binds the loop's actions to one workspace", () => {
	it("Scenario: The delete grant is stored and bound", async () => {
		const workspace = workspaceWith("src/old.ts");
		const r = await runLoop([verdict(true)], { script: { text: deleting("src/old.ts") }, workspace, deleteFiles: true }, { deleteFiles: true });
		const input = (await r.harness.getTask(r.id, context))?.input as unknown as TaskLoopInput;
		await r.harness.close(context);

		expect(input.deleteFiles).toBe(true);
		expect(existsSync(join(workspace, "src/old.ts"))).toBe(false);
		expect(r.outcome.status).toBe("converged");
	});
});

describe("task/agent: An ungranted delete_file is an optional target", () => {
	it("Scenario: A deterministic ungranted delete is retried with the message", async () => {
		const workspace = workspaceWith("src/legacy.ts");
		const r = await runLoop([], { script: { text: deleting("src/legacy.ts") }, workspace, budget: { maxIterations: 8 } });
		const input = (await r.harness.getTask(r.id, context))?.input as unknown as TaskLoopInput;
		const runs = await runTasks(r.storage);
		await r.harness.close(context);

		expect(input.deleteFiles).toBe(false);
		expect(existsSync(join(workspace, "src/legacy.ts"))).toBe(true);
		expect(r.outcome.status).toBe("exhausted");
		const first = runs[0]?.state.outcome as { result?: { actions?: { result: { ok: boolean; message?: string } }[] } } | undefined;
		expect(first?.result?.actions?.[0]?.result).toEqual({ ok: false, message: DELETE_NOT_GRANTED });
		const seeded = (runs[1]?.input as { options?: { variables?: Record<string, unknown> } }).options?.variables;
		expect(seeded?.["carried"]).toContain(DELETE_NOT_GRANTED);
		expect(seeded).not.toHaveProperty("delete_granted");
	});

	it("a model step is not offered an ungranted delete_file, and delete_granted is seeded false", async () => {
		const r = await runLoop([text("nothing to delete"), verdict(true)], { script: { text: OFFERING } });
		const runs = await runTasks(r.storage);
		await r.harness.close(context);

		expect(r.outcome.status).toBe("converged");
		const seeded = (runs[0]?.input as { options?: { variables?: Record<string, unknown> } }).options?.variables;
		expect(seeded?.["delete_granted"]).toBe(false);
		const act = r.env.requests[0];
		expect(JSON.stringify(act?.messages)).toContain("Granted: false");
		expect(offeredTools(act)).toEqual([]);
	});

	it("granted, the same model step is offered delete_file and delete_granted is seeded true", async () => {
		const r = await runLoop([text("nothing to delete"), verdict(true)], { script: { text: OFFERING }, deleteFiles: true }, { deleteFiles: true });
		await r.harness.close(context);

		expect(r.outcome.status).toBe("converged");
		expect(JSON.stringify(r.env.requests[0]?.messages)).toContain("Granted: true");
		expect(offeredTools(r.env.requests[0])).toEqual(["remove"]);
	});

	it("a delete_granted declared other than boolean is refused at start", async () => {
		const script = OFFERING.replace("delete_granted: mutable boolean = False", 'delete_granted: mutable string = ""');
		await expect(runLoop([], { script: { text: script } })).rejects.toThrow(/delete_granted is declared string/);
	});
});
