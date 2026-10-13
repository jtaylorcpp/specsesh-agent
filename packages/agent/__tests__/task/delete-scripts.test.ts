// The bundled scripts with `delete_file` granted: task.agent's orient asks for deletion and its act
// step is offered the tool; task-delegate.agent deletes the first file a fake `claude` retires.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { RESULT_TOOL } from "../../src/durable/index.js";
import { claudeCodeRunner } from "../../src/node/index.js";
import { BUNDLED_SCRIPTS } from "../../src/task/index.js";
import { iterationEvents } from "../../src/task/events.js";
import { gitRepo } from "./cli-helpers.js";
import { COUNT_CHECK, cleanTemps, context, plan, prompts, runLoop, runTasks, temp, text, toolCall, verdict } from "./helpers.js";

afterEach(() => cleanTemps());

const TASK_SCRIPT = fileURLToPath(BUNDLED_SCRIPTS.task);
const DELEGATE_SCRIPT = fileURLToPath(BUNDLED_SCRIPTS.delegate);
const ORIENT_LINE = "If the task retires a file, delete it with delete_file; do not empty it.";

/** The tools a model request was offered: pi-durable lists them on its system messages. */
function offeredTools(request: { messages: readonly unknown[] } | undefined): string[] {
	const messages = (request?.messages ?? []) as { role: string; toolsAdded?: { name: string }[] }[];
	return messages.filter((m) => m.role === "system").flatMap((m) => m.toolsAdded ?? []).map((t) => t.name);
}

/** A fake `claude` that changes no file and replies `reply`. */
function replyingClaude(reply: string): string {
	const binary = join(temp("task-claude-"), "claude");
	writeFileSync(
		binary,
		`#!${process.execPath}\ntry { require("node:fs").readFileSync(0, "utf8"); } catch {}\nprocess.stdout.write(JSON.stringify({ type: "result", is_error: false, result: ${JSON.stringify(reply)} }));\n`,
		{ mode: 0o755 },
	);
	return binary;
}

/** A fake `claude` that copies the prompt it is given on stdin to `prompt.txt` beside it, changes no file, and replies `reply`. */
function recordingClaude(reply: string): { binary: string; prompt: string } {
	const dir = temp("task-claude-");
	const binary = join(dir, "claude");
	const prompt = join(dir, "prompt.txt");
	writeFileSync(
		binary,
		`#!${process.execPath}\nconst fs = require("node:fs");\nlet input = "";\ntry { input = fs.readFileSync(0, "utf8"); } catch {}\nfs.writeFileSync(${JSON.stringify(prompt)}, input);\nprocess.stdout.write(JSON.stringify({ type: "result", is_error: false, result: ${JSON.stringify(reply)} }));\n`,
		{ mode: 0o755 },
	);
	return { binary, prompt };
}

/** The `claude_code` grant on a fake `claude` at `binary`, a passing check, and `delete_file` granted. */
const grantedDeleting = (binary: string) => ({
	overrides: { delegates: { claude_code: { runner: "claude-code" } }, checks: [COUNT_CHECK], deleteFiles: true },
	actions: { runners: { "claude-code": claudeCodeRunner({ binary }) }, deleteFiles: true },
});

/** The retire step's answer. */
const retire = (path: string) => fauxAssistantMessage([fauxToolCall(RESULT_TOOL, { retire_path: path })], { stopReason: "toolUse" });

describe("task/agent: task.agent can delete when granted", () => {
	it("Scenario: Granted, orient asks for deletion", async () => {
		const workspace = gitRepo({ "src/old.ts": "export {};\n" });
		const r = await runLoop(
			[plan("retire src/old.ts"), toolCall("delete", { path: "src/old.ts" }), text("Deleted src/old.ts."), verdict(true)],
			{ script: { path: TASK_SCRIPT }, workspace, checks: [COUNT_CHECK], allow: ["pnpm", "node"], deleteFiles: true },
			{ deleteFiles: true },
		);
		await r.harness.close(context);

		expect(r.outcome.status).toBe("converged");
		const orient = prompts(r.env.requests).find((p) => p.includes("Write a short, concrete plan for this iteration"));
		expect(orient).toContain(ORIENT_LINE);
		// The act step names delete_file under the alias `delete`; calling it deletes in the workspace.
		const act = r.env.requests.find((request) => JSON.stringify(request.messages).includes("Carry out this plan"));
		expect(offeredTools(act)).toEqual(["read", "edit", "shell", "delete"]);
		expect(existsSync(join(workspace, "src/old.ts"))).toBe(false);
		expect(r.outcome.iterations[0]?.actions).toContainEqual({ kind: "edit", summary: "delete_file src/old.ts", refs: ["src/old.ts"] });
	});

	it("Scenario: Not granted, orient says nothing of deletion", async () => {
		const workspace = gitRepo({ "src/a.ts": "export {};\n" });
		const r = await runLoop(
			[plan("touch nothing"), text("Nothing to change."), verdict(true)],
			{ script: { path: TASK_SCRIPT }, workspace, checks: [COUNT_CHECK], allow: ["pnpm", "node"] },
		);
		await r.harness.close(context);

		expect(r.outcome.status).toBe("converged");
		const orient = prompts(r.env.requests).find((p) => p.includes("Write a short, concrete plan for this iteration"));
		expect(orient).toBeDefined();
		expect(orient).not.toContain("delete_file");
	});
});

describe("task/agent: An ungranted delete_file is an optional target", () => {
	it("Scenario: A model step is not offered an ungranted delete", async () => {
		const workspace = gitRepo({ "src/a.ts": "export {};\n" });
		const r = await runLoop(
			[plan("touch nothing"), text("Nothing to change."), verdict(true)],
			{ script: { path: TASK_SCRIPT }, workspace, checks: [COUNT_CHECK], allow: ["pnpm", "node"] },
		);
		const runs = await runTasks(r.storage);
		await r.harness.close(context);

		// runLoop resolving at all means the start was not refused.
		expect(r.outcome.status).toBe("converged");
		const seeded = (runs[0]?.input as { options?: { variables?: Record<string, unknown> } }).options?.variables;
		expect(seeded?.["delete_granted"]).toBe(false);
		// The act step offers read_file, edit_file and run_command under their aliases, and no `delete`.
		const act = r.env.requests.find((request) => JSON.stringify(request.messages).includes("Carry out this plan"));
		expect(offeredTools(act)).toEqual(["read", "edit", "shell"]);
		expect(existsSync(join(workspace, "src/a.ts"))).toBe(true);
	});
});

describe("task/agent: task-delegate.agent's outer step deletes what the delegate retires", () => {
	it("Scenario: The delegate's retired file is deleted", async () => {
		const path = "packages/agent/src/old-workspace.ts";
		const workspace = gitRepo({ [path]: "export {};\n" });
		const grant = grantedDeleting(replyingClaude(`Moved everything out.\nRETIRE: ${path}`));
		const r = await runLoop(
			[plan("move it out"), retire(path), verdict(true)],
			{ script: { path: DELEGATE_SCRIPT }, workspace, budget: { maxIterations: 1 }, ...grant.overrides },
			grant.actions,
		);
		await r.harness.close(context);

		expect(r.outcome.status).toBe("converged");
		expect(existsSync(join(workspace, path))).toBe(false);
		const stream = r.outcome.iterations.flatMap((iteration) => iterationEvents(Number(r.id), iteration));
		expect(stream).toContainEqual(
			expect.objectContaining({ event: "action", iteration: 1, kind: "edit", summary: `delete_file ${path}`, refs: expect.arrayContaining([path]) }),
		);
		const all = prompts(r.env.requests);
		const orient = all.find((p) => p.includes("Write a short, concrete plan for this iteration"));
		expect(orient).toContain("You cannot delete files.");
		expect(orient).toContain("RETIRE: <path>");
		const retiring = all.find((p) => p.includes("Set retire_path to the path on the first line starting"));
		expect(retiring).toContain(`RETIRE: ${path}`);
		const judge = all.filter((p) => p.includes("Is the task done against the spec deltas?"));
		expect(judge).toHaveLength(1);
		expect(judge[0]).toContain(`Files deleted: ${path}`);
	});

	it("Scenario: One file is retired per iteration", async () => {
		const workspace = gitRepo({ "src/a.ts": "export {};\n", "src/b.ts": "export {};\n" });
		const grant = grantedDeleting(replyingClaude("Moved both out.\nRETIRE: src/a.ts\nRETIRE: src/b.ts"));
		const r = await runLoop(
			[plan("retire both"), retire("src/a.ts"), verdict(false, "src/b.ts remains")],
			{ script: { path: DELEGATE_SCRIPT }, workspace, budget: { maxIterations: 1 }, ...grant.overrides },
			grant.actions,
		);
		await r.harness.close(context);

		expect(r.outcome.status).toBe("exhausted");
		expect(r.outcome.iterations).toHaveLength(1);
		expect(existsSync(join(workspace, "src/a.ts"))).toBe(false);
		expect(existsSync(join(workspace, "src/b.ts"))).toBe(true);
		const deletes = r.outcome.iterations[0]?.actions.filter((a) => a.summary.startsWith("delete_file"));
		expect(deletes).toEqual([{ kind: "edit", summary: "delete_file src/a.ts", refs: ["src/a.ts"] }]);
	});

	it("Scenario: Not granted, the delegate is not asked to retire", async () => {
		const workspace = gitRepo({ "src/a.ts": "export {};\n" });
		// Even a delegate that asks to retire a file gets nothing deleted without the grant.
		const claude = recordingClaude("Nothing to change.\nRETIRE: src/a.ts");
		const r = await runLoop(
			[plan("touch nothing"), verdict(true)],
			{
				script: { path: DELEGATE_SCRIPT },
				workspace,
				budget: { maxIterations: 1 },
				delegates: { claude_code: { runner: "claude-code" } },
				checks: [COUNT_CHECK],
			},
			{ runners: { "claude-code": claudeCodeRunner({ binary: claude.binary }) } },
		);
		await r.harness.close(context);

		expect(r.outcome.status).toBe("converged");
		const all = prompts(r.env.requests);
		const orient = all.find((p) => p.includes("Write a short, concrete plan for this iteration"));
		expect(orient).toBeDefined();
		expect(orient).not.toContain("RETIRE:");
		expect(orient).not.toContain("You cannot delete files.");
		const delegated = readFileSync(claude.prompt, "utf8");
		expect(delegated).toContain("touch nothing");
		expect(delegated).not.toContain("RETIRE:");
		expect(delegated).not.toContain("You cannot delete files.");
		expect(all.some((p) => p.includes("Set retire_path"))).toBe(false);
		const stream = r.outcome.iterations.flatMap((iteration) => iterationEvents(Number(r.id), iteration));
		expect(stream.filter((e) => e.event === "action" && String(e.summary).startsWith("delete_file"))).toEqual([]);
		expect(existsSync(join(workspace, "src/a.ts"))).toBe(true);
		const judge = all.filter((p) => p.includes("Is the task done against the spec deltas?"));
		expect(judge).toHaveLength(1);
		expect(judge[0]).toContain("Files deleted: none");
	});
});
