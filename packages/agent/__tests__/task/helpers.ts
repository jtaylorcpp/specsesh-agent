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
import {
	startTaskLoop,
	taskLoopExtensions,
	waitForTaskLoopResult,
	type TaskLoopActionOptions,
	type TaskLoopOptions,
} from "../../src/task/index.js";
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

/** What a fake `openspec` prints on stdout, and exits with, for one subcommand. */
export interface FakeOpenspecReply {
	readonly stdout: string;
	readonly exit?: number;
}

/**
 * An executable `openspec` in `dir` (a workspace's `node_modules/.bin`, or a PATH directory),
 * printing `version` for `--version` and the given reply for `validate` or `show`. Every call,
 * `--version` included, appends `<path> <OPENSPEC_TELEMETRY> <args>` to `log`. POSIX only.
 */
export function fakeOpenspecBin(
	dir: string,
	replies: { version?: string; validate?: FakeOpenspecReply; show?: FakeOpenspecReply } = {},
): { path: string; log: string } {
	const data = temp("fake-openspec-data-");
	const log = join(data, "calls.log");
	const reply = (name: "validate" | "show") => {
		writeFileSync(join(data, `${name}.out`), replies[name]?.stdout ?? "");
		return `  ${name}) cat '${join(data, `${name}.out`)}'; exit ${replies[name]?.exit ?? 0} ;;`;
	};
	const path = join(dir, "openspec");
	mkdirSync(dir, { recursive: true });
	const script = [
		"#!/bin/sh",
		`printf '%s %s %s\\n' "$0" "$OPENSPEC_TELEMETRY" "$*" >> '${log}'`,
		'case "$1" in',
		`  --version) echo '${replies.version ?? "1.14.1"}' ;;`,
		reply("validate"),
		reply("show"),
		"esac",
		"",
	].join("\n");
	writeFileSync(path, script, { mode: 0o755 });
	return { path, log };
}

/** The fake's calls so far, one line each; none when it never ran. */
export function openspecCalls(log: string): string[] {
	try {
		return readFileSync(log, "utf8").split("\n").filter((line) => line !== "");
	} catch {
		return [];
	}
}

/** The loop's action options as the tests give them: a directory, or a `Workspace` whose `root` is the input's directory. */
export type LoopActions = Partial<TaskLoopActionOptions>;

/** A faux-model environment with `taskLoopExtensions` installed for `actions`; `workspace` is the directory. */
export function loopEnv(actions: LoopActions = {}) {
	const bound = actions.workspace ?? temp("task-ws-");
	const env = setup();
	for (const extension of taskLoopExtensions({ ...actions, workspace: bound })) env.registry.install(extension);
	return { env, workspace: typeof bound === "string" ? bound : bound.root };
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
    amend_path: mutable string = ""
    amend_text: mutable string = ""

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

/** The `edit_file` action, declared for a logic-only step. */
const EDIT_FILE = `    actions:
        edit_file:
            description: "Replace a file's content in the workspace"
            inputs:
                path: string
                content: string
            outputs:
                ok: boolean
            target: "mcpTool://edit_file"
`;

/**
 * JUDGE_ONLY declaring `changed`, with a logic-only `write` step first that writes each of
 * `files[n - 1]` in iteration `n`, and the judge showing `changed`.
 */
export function writer(files: readonly (readonly string[])[]): string {
	const writes = files
		.map((paths, i) =>
			paths.length === 0
				? ""
				: `            if @variables.iteration == ${i + 1}:\n` +
					paths.map((path) => `                run @actions.edit_file\n                    with path = "${path}"\n                    with content = "${path} ${i + 1}"\n`).join(""),
		)
		.join("");
	const write = writes === "" ? "" : `subagent write:\n    description: "Write the iteration's files, without the model"\n\n${EDIT_FILE}\n    reasoning:\n        instructions: ->\n${writes}\n`;
	return JUDGE_ONLY.replace('    carried: mutable string = ""\n', '    carried: mutable string = ""\n    changed: mutable string = ""\n')
		.replace("subagent judge:", `${write}subagent judge:`)
		.replace("            | Carried: {!@variables.carried}\n", "            | Carried: {!@variables.carried}\n            | Changed: {!@variables.changed}\n");
}

/** The group judge's contract and nothing more. */
export const GROUP_JUDGE = `config:
    agent_name: "group-judge"

variables:
    group_number: mutable number = 1
    group_title: mutable string = ""
    tasks: mutable string = ""
    proposal: mutable string = ""
    deltas: mutable string = ""
    check_output: mutable string = ""
    rework_count: mutable number = 0
    next_action: mutable string = "rework"
    rework_task: mutable string = ""
    feedback: mutable string = ""
    question: mutable string = ""
    amend_path: mutable string = ""
    amend_text: mutable string = ""

subagent judge:
    description: "Judge the group"

    reasoning:
        instructions: ->
            | Group {!@variables.group_number}: {!@variables.group_title}
            | Check output: {!@variables.check_output}
            set @variables.next_action = @outputs.next_action
            set @variables.rework_task = @outputs.rework_task
            set @variables.feedback = @outputs.feedback
            set @variables.question = @outputs.question
`;

/** JUDGE_ONLY with a declaration removed or retyped. */
/** JUDGE_ONLY whose script assigns `next_action` itself, not from the result, so the step's enum does not guard it. */
export const JUDGE_ONLY_ASSIGNING = (value: string) =>
	JUDGE_ONLY.replace("set @variables.next_action = @outputs.next_action", `set @variables.next_action = "${value}"`);

export const judgeOnlyWith = (replace: [string, string]) => JUDGE_ONLY.replace(replace[0], replace[1]);

const submit = (args: Record<string, string | boolean>) =>
	fauxAssistantMessage([fauxToolCall(RESULT_TOOL, args)], { stopReason: "toolUse" });

/** A judge's answer with every task.agent field; `amend_path` and `amend_text` are empty unless overridden. */
export const verdict = (
	met: boolean,
	unmet = "",
	nextAction = "retry",
	question = "",
	overrides: { amend_path?: string; amend_text?: string } = {},
) => submit({ met, unmet, next_action: nextAction, question, amend_path: "", amend_text: "", ...overrides });
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

/** A check that appends a line to `count.txt` in the workspace and exits 0. No spaces: commands are split on whitespace with no shell. */
export const COUNT_CHECK = "node -e require('fs').appendFileSync('count.txt','x\\n')";

/** A fake `pnpm` first on PATH: prints what it ran and exits 0. Returns the restore function. */
export function fakePnpm(): () => void {
	const bin = temp("task-bin-");
	writeFileSync(join(bin, "pnpm"), `#!${process.execPath}\nprocess.stdout.write("ran " + process.argv.slice(2).join(" "));\n`, { mode: 0o755 });
	const saved = process.env.PATH;
	process.env.PATH = `${bin}:${saved ?? ""}`;
	return () => {
		process.env.PATH = saved;
	};
}

/**
 * Start a loop of JUDGE_ONLY (unless a script is given) over a tiny change (unless
 * given), answer with `responses`, and wait for it.
 */
export async function runLoop(
	responses: Parameters<ReturnType<typeof setup>["faux"]["setResponses"]>[0],
	overrides: Partial<TaskLoopOptions> = {},
	actions: LoopActions = {},
) {
	const { env, workspace } = loopEnv({
		...actions,
		...(overrides.workspace !== undefined ? { workspace: overrides.workspace } : {}),
		...(overrides.checks !== undefined ? { checks: overrides.checks } : {}),
		...(overrides.allow !== undefined ? { allow: overrides.allow } : {}),
		...(overrides.delegates !== undefined ? { delegates: overrides.delegates } : {}),
	});
	const storage = new MemoryStorage();
	const harness = await loopHarness(env, storage);
	env.faux.setResponses(responses);
	const options: TaskLoopOptions = {
		change: overrides.change ?? { dir: tinyChange() },
		task: "1.1",
		script: { text: JUDGE_ONLY },
		workspace,
		model: env.model,
		...overrides,
	};
	const id = await startTaskLoop(harness, options, context);
	harness.resume();
	const { outcome, notes } = await waitForTaskLoopResult(harness, id, context);
	return { id, outcome, notes, env, storage, harness, options, workspace };
}

/** Every `agentscript.run` task in the storage, oldest first. */
export async function runTasks(storage: Storage) {
	const page = await storage.scanTasks({ kind: "agentscript.run" }, 100, undefined, context);
	return page.items;
}
