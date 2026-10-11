/**
 * Task-loop fixtures: a faux-model harness with the loop's extensions, temp
 * change directories, a copy of the archived `baseline-agentscript-durable`
 * change, and the model answers a task script's steps take.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { MemoryStorage, type Storage } from "@earendil-works/pi-durable";
import { RESULT_TOOL } from "../../src/durable/index.js";
import { taskLoopExtensions, type TaskLoopActionOptions } from "../../src/task/index.js";
import { context, openHarness, setup } from "../durable/helpers.js";

export { context };

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..", "..");
export const SCRIPTS = join(HERE, "..", "..", "src", "task", "scripts");

const dirs: string[] = [];
export function temp(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}
export function cleanTemps(): void {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** A faux-model environment with `taskLoopExtensions` installed for `actions`. */
export function loopEnv(actions: Partial<TaskLoopActionOptions> = {}) {
	const workspace = actions.workspace ?? temp("task-ws-");
	const env = setup();
	for (const extension of taskLoopExtensions({ ...actions, workspace })) env.registry.install(extension);
	return { env, workspace };
}

export async function loopHarness(env: ReturnType<typeof setup>, storage: Storage = new MemoryStorage()) {
	return openHarness(storage, env);
}

/** The archived baseline change, wherever the archive put it. */
export function baselineDir(): string {
	const archive = join(REPO, "openspec", "changes", "archive");
	const dir = readdirSync(archive).find((d) => d.endsWith("-baseline-agentscript-durable"));
	if (dir === undefined) throw new Error("baseline-agentscript-durable is not archived");
	return join(archive, dir);
}

/** A copy of the baseline change in a temp directory, with task 2.4 unticked. */
export function baselineCopy(): string {
	const dir = join(temp("task-change-"), "baseline-agentscript-durable");
	cpSync(baselineDir(), dir, { recursive: true });
	const tasks = join(dir, "tasks.md");
	writeFileSync(tasks, readFileSync(tasks, "utf8").replace("- [x] 2.4 ", "- [ ] 2.4 "));
	return dir;
}

export const PROPOSAL = "## Why\n\nThe value file must say 2.\n";
export const DELTA = "## ADDED Requirements\n\n### Requirement: The value is two\nThe file SHALL hold `2`.\n";
export const TASKS = "## 1. Value\n\n- [ ] 1.1 `src/value.txt` holds 2\n- [ ] 1.2 something else\n";

/** A small change directory: proposal.md, one delta under `specs/<capability>`, tasks.md and maybe design.md. */
export function tinyChange(options: { design?: string; capabilities?: string[]; tasks?: string } = {}): string {
	const dir = join(temp("task-change-"), "tiny");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "proposal.md"), PROPOSAL);
	if (options.design !== undefined) writeFileSync(join(dir, "design.md"), options.design);
	for (const capability of options.capabilities ?? ["value/file"]) {
		mkdirSync(join(dir, "specs", capability), { recursive: true });
		writeFileSync(join(dir, "specs", capability, "spec.md"), `${DELTA.replace("two", capability)}`);
	}
	writeFileSync(join(dir, "tasks.md"), options.tasks ?? TASKS);
	return dir;
}

/** The contract and nothing more: one judge step reading every seeded variable. */
export const JUDGE_ONLY = `config:
    agent_name: "judge-only"

variables:
    task_id: mutable string = ""
    task_text: mutable string = ""
    proposal: mutable string = ""
    design: mutable string = ""
    deltas: mutable string = ""
    iteration: mutable number = 1
    carried: mutable string = ""
    plan: mutable string = ""
    met: mutable boolean = False
    unmet: mutable string = ""
    next_action: mutable string = "retry"
    question: mutable string = ""

subagent judge:
    description: "Judge the task"

    reasoning:
        instructions: ->
            | Task {!@variables.task_id}, iteration {!@variables.iteration}: {!@variables.task_text}
            | Carried: {!@variables.carried}
            | Proposal: {!@variables.proposal}
            | Design: {!@variables.design}
            | Deltas: {!@variables.deltas}
            set @variables.met = @outputs.met
            set @variables.unmet = @outputs.unmet
            set @variables.next_action = @outputs.next_action
            set @variables.question = @outputs.question
`;

/** JUDGE_ONLY with a declaration removed or retyped. */
export const judgeOnlyWith = (replace: [string, string]) => JUDGE_ONLY.replace(replace[0], replace[1]);

const submit = (args: Record<string, string | boolean>) =>
	fauxAssistantMessage([fauxToolCall(RESULT_TOOL, args)], { stopReason: "toolUse" });

export const verdict = (met: boolean, unmet = "", nextAction = "retry", question = "") =>
	submit({ met, unmet, next_action: nextAction, question });
export const plan = (text: string) => submit({ plan: text });
export const toolCall = (name: string, args: Record<string, string>) =>
	fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
export const text = (value: string) => fauxAssistantMessage([fauxText(value)]);

/** The user prompts of every model request, in order. */
export function prompts(requests: readonly { messages: readonly { role: string; content: unknown }[] }[]): string[] {
	return requests.map((request) =>
		request.messages
			.filter((m) => m.role === "user")
			.map((m) =>
				typeof m.content === "string"
					? m.content
					: (m.content as { text?: string }[]).map((c) => c.text ?? "").join(""),
			)
			.join("\n"),
	);
}
