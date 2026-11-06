// The bundled task script with `delete_file` granted: task.agent's orient asks for deletion and its
// act step is offered the tool.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { RESULT_TOOL } from "../../src/durable/index.js";
import { jsonRunner } from "../durable/delegation-scripts.js";
import { BUNDLED_SCRIPTS } from "../../src/task/index.js";
import { iterationEvents } from "../../src/task/events.js";
import { gitRepo } from "./cli-helpers.js";
import { COUNT_CHECK, cleanTemps, context, plan, prompts, runLoop, runTasks, temp, text, toolCall, verdict } from "./helpers.js";

afterEach(() => cleanTemps());

const TASK_SCRIPT = fileURLToPath(BUNDLED_SCRIPTS.task);
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
	actions: { runners: { "claude-code": jsonRunner(binary) }, deleteFiles: true },
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
		expect(offeredTools(act)).toEqual(["read", "list", "search", "edit", "shell", "delete"]);
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
		expect(offeredTools(act)).toEqual(["read", "list", "search", "edit", "shell"]);
		expect(existsSync(join(workspace, "src/a.ts"))).toBe(true);
	});
});
