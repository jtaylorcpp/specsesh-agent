#!/usr/bin/env node
/**
 * agentscript-durable — run Agent Script as resumable pi-durable tasks on Node.
 *
 *   agentscript-durable run <file> --db <runs.sqlite> [--provider anthropic] [--model claude-haiku-4-5]
 *                                  [--entry <subagent>]... [--var name=value]... [--json]
 *   agentscript-durable resume <task-id> --db <runs.sqlite> [--json]
 *
 * `run` prints the task ID before the first model call. If the process dies,
 * `resume` with that ID on the same database finishes the run from its last step.
 * The script is stored in the task, so `resume` does not need the file.
 *
 * Credentials are pi-ai's (ANTHROPIC_API_KEY, OPENAI_API_KEY, ...).
 * `--provider claude-code` runs each step through your own `claude` binary on your
 * Claude subscription (claudeCodeProvider from @specsesh/agent/claude-code), for local work.
 */

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { RunResult, VariableValue } from "../interpreter/index.js";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai";
import { createRegistry, Harness, type TaskId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { AgentScript, AgentScriptStepExtension } from "../durable/extension.js";
import { startScript, waitForScript } from "../durable/host.js";

export const DEFAULT_PROVIDER = "anthropic";
export const DEFAULT_MODEL = "claude-haiku-4-5";

const USAGE = `usage:
  agentscript-durable run <file> --db <path> [--provider <id>] [--model <id>] [--entry <subagent>]... [--var name=value]... [--json]
  agentscript-durable resume <task-id> --db <path> [--json]`;

export interface CliDeps {
	/** The pi-ai model collection. Defaults to every built-in provider. */
	readonly models?: () => Promise<Models> | Models;
	readonly out?: (line: string) => void;
	readonly err?: (line: string) => void;
}

export function parseVar(raw: string): [string, VariableValue] {
	const eq = raw.indexOf("=");
	if (eq <= 0) throw new Error(`--var expects name=value, got "${raw}"`);
	const name = raw.slice(0, eq);
	const value = raw.slice(eq + 1);
	if (value === "True") return [name, true];
	if (value === "False") return [name, false];
	if (value !== "" && /^-?\d+(\.\d+)?$/.test(value)) return [name, Number(value)];
	return [name, value];
}

async function builtin(): Promise<Models> {
	const { builtinModels } = await import("@earendil-works/pi-ai/providers/all");
	const { claudeCodeProvider } = await import("../claude-code/index.js");
	const models = builtinModels();
	models.setProvider(claudeCodeProvider());
	return models;
}

export async function main(argv: readonly string[], deps: CliDeps = {}): Promise<number> {
	const out = deps.out ?? ((line) => process.stdout.write(`${line}\n`));
	const err = deps.err ?? ((line) => process.stderr.write(`${line}\n`));
	const [command, ...rest] = argv;
	if (command !== "run" && command !== "resume") {
		err(USAGE);
		return 2;
	}

	const { values, positionals } = parseArgs({
		args: [...rest],
		allowPositionals: true,
		options: {
			db: { type: "string" },
			provider: { type: "string" },
			model: { type: "string" },
			entry: { type: "string", multiple: true },
			var: { type: "string", multiple: true },
			json: { type: "boolean", default: false },
		},
	});
	const target = positionals[0];
	if (target === undefined || values.db === undefined) {
		err(USAGE);
		return 2;
	}

	const context = BACKGROUND_CONTEXT;
	const models = await (deps.models ?? builtin)();
	const registry = createRegistry();
	registry.install(AgentScript);
	registry.install(AgentScriptStepExtension);
	const harness = await Harness.open(await openNodeSqliteStorage(values.db), { models, registry }, context);

	try {
		let id: TaskId<RunResult>;
		if (command === "run") {
			const provider = values.provider ?? process.env.AGENTSCRIPT_PROVIDER ?? DEFAULT_PROVIDER;
			const modelId = values.model ?? process.env.AGENTSCRIPT_MODEL ?? DEFAULT_MODEL;
			if (models.getModel(provider, modelId) === undefined) {
				err(`no model "${modelId}" on provider "${provider}"`);
				return 2;
			}
			id = await startScript(
				harness,
				readFileSync(target, "utf8"),
				{
					model: { provider, modelId },
					...(values.entry !== undefined ? { entry: values.entry } : {}),
					...(values.var !== undefined ? { variables: Object.fromEntries(values.var.map(parseVar)) } : {}),
				},
				context,
			);
			// Before any model call, so a crash still leaves you the ID to resume.
			err(`task ${id} — resume with: agentscript-durable resume ${id} --db ${values.db}`);
		} else {
			id = Number(target) as TaskId<RunResult>;
			if (!Number.isInteger(id) || (await harness.getTask(id, context)) === undefined) {
				err(`no task ${target} in ${values.db}`);
				return 2;
			}
		}

		harness.resume();
		const result = await waitForScript(harness, id, context);
		if (values.json) {
			out(JSON.stringify({ task: id, ...result }, null, 2));
		} else {
			out(`# task ${id} — ${result.kind}`);
			for (const [i, step] of result.steps.entries()) {
				out(`## step ${i + 1}: ${step.subagent} → ${step.outcome.kind}`);
				if (step.outcome.kind === "failed") out(`${step.outcome.category}: ${step.outcome.message}`);
				else if (step.outcome.text) out(step.outcome.text);
				if (step.outcome.kind === "answered" && step.outcome.structured !== undefined) {
					out(`structured: ${JSON.stringify(step.outcome.structured)}`);
				}
			}
			out("## variables");
			for (const [name, value] of Object.entries(result.variables)) out(`${name} = ${JSON.stringify(value)}`);
		}
		return result.kind === "completed" ? 0 : 1;
	} finally {
		await harness.close(context);
	}
}

// Run only as the entry point: through a bin symlink argv[1] is the link, so compare real paths.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(error: unknown) => {
			process.stderr.write(`${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`);
			process.exit(1);
		},
	);
}
