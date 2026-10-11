/**
 * Documents with actions, for the add-agentscript-actions scenarios.
 *
 * The task scripts are the ones the package bundles, in `src/task/scripts/`.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ActionCall, ActionResult } from "../../../src/interpreter/index.js";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src", "task", "scripts");

/** A task script the package bundles. */
export function taskAgentFile(name: "task.agent" | "task-delegate.agent"): string {
	return readFileSync(join(SCRIPTS, name), "utf8");
}

/** The `run_checks` action definition, indented for a subagent's `actions:` block. */
export const RUN_CHECKS_DEFINITION = `    actions:
        run_checks:
            description: "Run the checks configured for this task"
            inputs:
                task_id: string
            outputs:
                passed: boolean
                output: string
            target: "mcpTool://run_checks"
`;

/** One subagent with the given actions block and instructions, after the given variables. */
export function subagentDocument(options: {
	variables?: string;
	name?: string;
	actions?: string;
	instructions: string;
	reasoningActions?: string;
	extra?: string;
}): string {
	const indent = (text: string, by: string) =>
		text
			.split("\n")
			.map((line) => (line === "" ? line : by + line))
			.join("\n");
	return [
		'config:\n    agent_name: "actions"\n',
		options.variables !== undefined ? `variables:\n${indent(options.variables, "    ")}\n` : "",
		`subagent ${options.name ?? "t"}:\n    description: "d"\n`,
		options.actions ?? "",
		"    reasoning:\n        instructions: ->\n" + indent(options.instructions, "            ") + "\n",
		options.reasoningActions !== undefined ? "        actions:\n" + indent(options.reasoningActions, "            ") + "\n" : "",
		options.extra ?? "",
	].join("\n");
}

/** A deterministic check subagent: optional logic, then one `run @actions.run_checks`. */
export const CHECK = subagentDocument({
	name: "check",
	variables: `task_id: mutable string = ""
stage: mutable string = "start"
checks_passed: mutable boolean = False
check_output: mutable string = ""`,
	actions: RUN_CHECKS_DEFINITION,
	instructions: `set @variables.stage = "checking"
run @actions.run_checks
    with task_id = @variables.task_id
    set @variables.checks_passed = @outputs.passed
    set @variables.check_output = @outputs.output`,
});

/** A host that records every call and answers each with the next result. */
export function recordingHost(...results: ActionResult[]) {
	const calls: ActionCall[] = [];
	const host = async (call: ActionCall): Promise<ActionResult> => {
		calls.push(call);
		return results[Math.min(calls.length - 1, results.length - 1)] ?? { ok: true, outputs: {} };
	};
	return { host, calls };
}

export const persist = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Two model steps with deterministic logic between them (`gate`). */
export const PIPELINE = `config:
    agent_name: "pipeline"

system:
    instructions: |
        You triage bug reports.

variables:
    report: mutable string = "it crashes"
    severity: mutable string = ""
    urgent: mutable boolean = False

subagent classify:
    description: "Classify the report"

    reasoning:
        instructions: ->
            | Classify: {!@variables.report}
            set @variables.severity = @outputs.severity

subagent gate:
    description: "Decide urgency without the model"

    reasoning:
        instructions: ->
            if @variables.severity == "high":
                set @variables.urgent = True

subagent respond:
    description: "Write the reply"

    reasoning:
        instructions: ->
            if @variables.urgent:
                | Write an urgent reply about: {!@variables.report}
            else:
                | Write a routine reply about: {!@variables.report}
`;

export const PIPELINE_ENTRIES = ["classify", "gate", "respond"];

/** A model step, then a deterministic check, then a step reading the check's outputs. */
export const STEP_THEN_CHECK = `config:
    agent_name: "step-then-check"

variables:
    task_id: mutable string = ""
    checks_passed: mutable boolean = False
    check_output: mutable string = ""
    verdict: mutable string = ""

subagent plan:
    description: "Pick the task"

    reasoning:
        instructions: ->
            | Pick a task.
            set @variables.task_id = @outputs.task_id

subagent check:
    description: "Run the checks"

${RUN_CHECKS_DEFINITION}
    reasoning:
        instructions: ->
            run @actions.run_checks
                with task_id = @variables.task_id
                set @variables.checks_passed = @outputs.passed
                set @variables.check_output = @outputs.output

subagent judge:
    description: "Judge"

    reasoning:
        instructions: ->
            | Passed: {!@variables.checks_passed}. Output: {!@variables.check_output}
            set @variables.verdict = @outputs.verdict
`;

/** One subagent with two `run`s and a logic line after each. */
export const TWO_RUNS = `config:
    agent_name: "two-runs"

variables:
    first: mutable boolean = False
    second: mutable boolean = False
    after: mutable string = ""

subagent check:
    description: "Run twice"

${RUN_CHECKS_DEFINITION}
    reasoning:
        instructions: ->
            run @actions.run_checks
                with task_id = "1"
                set @variables.first = @outputs.passed
            set @variables.after = "one"
            run @actions.run_checks
                with task_id = "2"
                set @variables.second = @outputs.passed
            set @variables.after = "two"
`;

/** A step offering `shell` and `note`, with output sets under `shell` and `edit`. */
export const OFFERS = `config:
    agent_name: "offers"

variables:
    last_exit: mutable number = 99
    edited: mutable boolean = True

subagent act:
    description: "Act"

    actions:
        run_command:
            description: "Run an allowed command"
            inputs:
                command: string
            outputs:
                exit_code: number
                output: string
            target: "mcpTool://run_command"
        edit_file:
            description: "Replace a file"
            inputs:
                path: string
                content: string
            outputs:
                ok: boolean
            target: "mcpTool://edit_file"

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
            edit: @actions.edit_file
                with path = ...
                with content = ...
                set @variables.edited = @outputs.ok
`;
