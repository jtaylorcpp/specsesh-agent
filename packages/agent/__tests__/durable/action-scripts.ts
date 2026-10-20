/**
 * Scripts and host actions for the durable action scenarios, shared by the tests
 * and the crash fixture.
 */

import type { TaskOutcome } from "@earendil-works/pi-durable";
import type { ActionResult, RunResult, VariableValue } from "../../src/interpreter/index.js";
import type { ActionContext, DurableFinishContext, DurableHostAction, ExecutedHostAction, RunInput } from "../../src/durable/index.js";

/** The built-ins' signatures, so a script binds to a fake exactly as to the real one. */
export const SIGNATURES = {
	run_checks: { kind: "command", inputs: { task_id: "string" }, outputs: { passed: "boolean", output: "string" }, replay: "unsafe" },
	run_command: { kind: "command", inputs: { command: "string" }, outputs: { exit_code: "number", output: "string" }, replay: "unsafe" },
	edit_file: { kind: "edit", inputs: { path: "string", content: "string" }, outputs: { ok: "boolean" }, replay: "safe" },
	read_file: { kind: "read", inputs: { path: "string" }, outputs: { content: "string" }, replay: "safe" },
} as const;

export type ActionName = keyof typeof SIGNATURES;

/** A host action with a built-in's signature and the given executor. */
export function hostAction(
	name: ActionName,
	execute: (inputs: Readonly<Record<string, VariableValue>>) => Promise<ActionResult>,
): ExecutedHostAction {
	const signature = SIGNATURES[name];
	return { name, ...signature, execute: (inputs) => execute(inputs) };
}

/** A host action that records each call's inputs and answers with `result`. */
export function recordingAction(name: ActionName, result: ActionResult) {
	const calls: Readonly<Record<string, VariableValue>>[] = [];
	const action = hostAction(name, async (inputs) => {
		calls.push(inputs);
		return result;
	});
	return { action, calls };
}

/** A host action that records the context of each call and answers with `result`. */
export function contextAction(name: ActionName, result: ActionResult) {
	const contexts: ActionContext[] = [];
	const action: ExecutedHostAction = {
		name,
		...SIGNATURES[name],
		execute: async (_inputs, context) => {
			contexts.push(context);
			return result;
		},
	};
	return { action, contexts };
}

/**
 * `run_checks` as a durable action: its child runs `deterministicScript("run_command")`,
 * and `finish` answers `passed` when the child completed with `exit_code` 0.
 * `startResult` replaces the child input, for a start that refuses.
 */
export function durableChecks(startResult?: Extract<ActionResult, { ok: false }>) {
	const starts: Readonly<Record<string, VariableValue>>[] = [];
	const startContexts: ActionContext[] = [];
	const finishes: { outcome: TaskOutcome<RunResult>; context: DurableFinishContext }[] = [];
	const action: DurableHostAction = {
		name: "run_checks",
		kind: "command",
		inputs: SIGNATURES.run_checks.inputs,
		outputs: SIGNATURES.run_checks.outputs,
		replay: "safe",
		durable: {
			async start(inputs, context): Promise<RunInput | Extract<ActionResult, { ok: false }>> {
				starts.push(inputs);
				startContexts.push(context);
				return startResult ?? { source: deterministicScript("run_command"), scope: ["run_command"] };
			},
			async finish(_inputs, outcome, context) {
				finishes.push({ outcome, context });
				const passed = outcome.status === "completed" && outcome.result.variables["exit_code"] === 0;
				return { ok: true, outputs: { passed, output: `child ${context.child} ${outcome.status}` } };
			},
		},
	};
	return { action, starts, startContexts, finishes };
}

const DEFINITIONS: Record<ActionName, string> = {
	run_checks: `        run_checks:
            description: "Run the checks configured for this task"
            inputs:
                task_id: string
            outputs:
                passed: boolean
                output: string
            target: "mcpTool://run_checks"
`,
	run_command: `        run_command:
            description: "Run an allowed command in the workspace"
            inputs:
                command: string
            outputs:
                exit_code: number
                output: string
            target: "mcpTool://run_command"
`,
	edit_file: `        edit_file:
            description: "Replace a file's content in the workspace"
            inputs:
                path: string
                content: string
            outputs:
                ok: boolean
            target: "mcpTool://edit_file"
`,
	read_file: `        read_file:
            description: "Read a file in the workspace"
            inputs:
                path: string
            outputs:
                content: string
            target: "mcpTool://read_file"
`,
};

const RUNS: Record<"run_checks" | "run_command" | "edit_file", string> = {
	run_checks: `            run @actions.run_checks
                with task_id = "2.4"
                set @variables.passed = @outputs.passed`,
	run_command: `            run @actions.run_command
                with command = "pnpm test"
                set @variables.exit_code = @outputs.exit_code`,
	edit_file: `            run @actions.edit_file
                with path = "src/a.ts"
                with content = "hello"
                set @variables.edited = @outputs.ok`,
};

/** One deterministic subagent: `stage = "acting"`, one `run`, then `after = "continued"`. */
export function deterministicScript(action: keyof typeof RUNS): string {
	return `config:
    agent_name: "act-${action}"

variables:
    stage: mutable string = "start"
    after: mutable string = ""
    passed: mutable boolean = False
    exit_code: mutable number = 99
    edited: mutable boolean = False

subagent act:
    description: "Run one action"

    actions:
${DEFINITIONS[action]}
    reasoning:
        instructions: ->
            set @variables.stage = "acting"
${RUNS[action]}
            set @variables.after = "continued"
`;
}

/** A model step offering `shell` (run_command) and `note` (edit_file bound to NOTES.md). */
export const OFFERING = `config:
    agent_name: "offering"

system:
    instructions: |
        You act in a workspace.

variables:
    last_exit: mutable number = 99

subagent act:
    description: "Act"

    actions:
${DEFINITIONS.run_command}${DEFINITIONS.edit_file}
    reasoning:
        instructions: ->
            | Do the work.
        actions:
            shell: @actions.run_command
                with command = ...
                set @variables.last_exit = @outputs.exit_code
            note: @actions.edit_file
                with path = "NOTES.md"
                with content = ...
`;

/** A model step, then a deterministic subagent whose one `run` calls `run_checks`. */
export const THINK_THEN_CHECK = `config:
    agent_name: "think-then-check"

system:
    instructions: "You answer briefly."

variables:
    passed: mutable boolean = False

subagent think:
    description: "Think"

    reasoning:
        instructions: ->
            | Say one.

subagent act:
    description: "Run one action"

    actions:
${DEFINITIONS.run_checks}
    reasoning:
        instructions: ->
${RUNS.run_checks}
`;
