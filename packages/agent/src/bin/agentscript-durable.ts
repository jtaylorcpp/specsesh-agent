#!/usr/bin/env node
/**
 * agentscript-durable — run Agent Script as resumable pi-durable tasks on Node.
 *
 *   agentscript-durable run <file> --db <runs.sqlite> [--provider anthropic] [--model claude-haiku-4-5]
 *                                  [--entry <subagent>]... [--var name=value]... [--json]
 *                                  [--tools <module>]... [--mcp <file>]... [--workspace <dir>]
 *   agentscript-durable resume <task-id> --db <runs.sqlite> [--json] [--tools <module>]... [--mcp <file>]...
 *                                  [--workspace <dir>]
 *
 * `run` prints the task ID before the first model call. If the process dies,
 * `resume` with that ID on the same database finishes the run from its last step.
 * The script is stored in the task, so `resume` does not need the file.
 *
 * `--tools` loads host actions from the user's modules (see ./tools.ts) before the
 * database opens. The tools are not stored: `resume` must be given them again (the
 * resume hint repeats the flags), and re-checks the stored script against them.
 * `--mcp` adds the tools of the MCP servers its files name, the same way; every
 * connection is closed after the harness.
 *
 * Credentials are pi-ai's (ANTHROPIC_API_KEY, OPENAI_API_KEY, ...).
 * `--provider claude-code` runs each step through your own `claude` binary on your
 * Claude subscription (claudeCodeProvider from @specsesh/agent/claude-code), for local work.
 */

import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { RunResult, VariableValue } from "../interpreter/index.js";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai";
import { createRegistry, Harness, type ModelRef, type TaskId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { ActionBindingError, checkBindings, createActionRegistry, type ActionRegistry } from "../durable/actions.js";
import { AgentScript, agentScriptExtensions, AgentScriptStepExtension, type RunInput } from "../durable/extension.js";
import { startScript, waitForScript } from "../durable/host.js";
import { cliModels, ollamaSuffix, withOllama } from "./models.js";
import { loadActions, reportSkipped } from "./tools.js";

export const DEFAULT_PROVIDER = "anthropic";
export const DEFAULT_MODEL = "claude-haiku-4-5";

export const USAGE = `usage:
  agentscript-durable run <file> --db <path> [--provider <id>] [--model <id>] [--entry <subagent>]... [--var name=value]... [--json]
                          [--tools <module>]... [--mcp <file>]... [--workspace <dir>]
  agentscript-durable resume <task-id> --db <path> [--json] [--tools <module>]... [--mcp <file>]... [--workspace <dir>]
tools: JavaScript modules (compile TypeScript first); resume needs the same --tools and --mcp as run
tools: under --provider claude-code, a step that offers tools fails invalid_request`;

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
			tools: { type: "string", multiple: true },
			mcp: { type: "string", multiple: true },
			workspace: { type: "string" },
		},
	});
	const target = positionals[0];
	if (target === undefined || values.db === undefined) {
		err(USAGE);
		return 2;
	}

	// Tools and MCP servers are loaded before the database opens, so a bad module or
	// server leaves no task behind.
	const toolPaths = values.tools ?? [];
	const mcpFiles = values.mcp ?? [];
	let actions: ActionRegistry = createActionRegistry([]);
	let closeMcp = async (): Promise<void> => {};
	const registry = createRegistry();
	if (toolPaths.length > 0 || mcpFiles.length > 0) {
		const workspace = resolve(values.workspace ?? ".");
		const loaded = await loadActions(toolPaths, mcpFiles, { cwd: process.cwd(), workspace });
		if (!loaded.ok) {
			err(loaded.message);
			return 2;
		}
		actions = loaded.registry;
		const mcp = loaded.mcp;
		closeMcp = () => mcp.close();
		const extensions = agentScriptExtensions({ actions, workspace });
		registry.install(extensions.run);
		registry.install(extensions.step);
		reportSkipped(mcp.skipped, { write: (line: string) => err(line.replace(/\n$/, "")) });
	} else {
		registry.install(AgentScript);
		registry.install(AgentScriptStepExtension);
	}

	// The connections outlive the harness: it may still be calling a tool until it closes.
	try {
		return await runOnHarness(command, target, { ...values, db: values.db }, toolPaths, mcpFiles, actions, registry, deps, out, err);
	} finally {
		await closeMcp();
	}
}

async function runOnHarness(
	command: "run" | "resume",
	target: string,
	values: {
		readonly db: string;
		readonly provider?: string;
		readonly model?: string;
		readonly entry?: string[];
		readonly var?: string[];
		readonly json?: boolean;
		readonly workspace?: string;
	},
	toolPaths: readonly string[],
	mcpFiles: readonly string[],
	actions: ActionRegistry,
	registry: ReturnType<typeof createRegistry>,
	deps: CliDeps,
	out: (line: string) => void,
	err: (line: string) => void,
): Promise<number> {
	const context = BACKGROUND_CONTEXT;
	const models = await (deps.models ?? cliModels)();
	const harness = await Harness.open(await openNodeSqliteStorage(values.db), { models, registry }, context);

	try {
		let id: TaskId<RunResult>;
		if (command === "run") {
			const provider = values.provider ?? process.env.AGENTSCRIPT_PROVIDER ?? DEFAULT_PROVIDER;
			const modelId = values.model ?? process.env.AGENTSCRIPT_MODEL ?? DEFAULT_MODEL;
			const ollama = await withOllama(models, [{ provider, modelId }]);
			if (models.getModel(provider, modelId) === undefined) {
				err(`no model "${modelId}" on provider "${provider}"${ollamaSuffix(ollama, provider)}`);
				return 2;
			}
			try {
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
			} catch (error) {
				if (!(error instanceof ActionBindingError)) throw error;
				err(error.message);
				return 2;
			}
			// Before any model call, so a crash still leaves you the ID to resume. The tools
			// are not stored, so the hint repeats the flags as they were given.
			const toolFlags = toolPaths.map((path) => ` --tools ${path}`).join("");
			const mcpFlags = mcpFiles.map((file) => ` --mcp ${file}`).join("");
			const workspaceFlag = values.workspace !== undefined ? ` --workspace ${values.workspace}` : "";
			err(`task ${id} — resume with: agentscript-durable resume ${id} --db ${values.db}${toolFlags}${mcpFlags}${workspaceFlag}`);
		} else {
			id = Number(target) as TaskId<RunResult>;
			const task = Number.isInteger(id) ? await harness.getTask(id, context) : undefined;
			if (task === undefined) {
				err(`no task ${target} in ${values.db}`);
				return 2;
			}
			// The tools are not stored: the stored script must still bind to the ones given now.
			const input = task.input as RunInput | null;
			if (input !== null) {
				try {
					checkBindings(input.source, actions, input.scope);
				} catch (error) {
					if (!(error instanceof ActionBindingError)) throw error;
					err(error.message);
					return 2;
				}
			}
			// Before resuming, so a run started on a pulled model finds it again.
			const stored = (task.input as { model?: ModelRef } | null)?.model;
			if (stored !== undefined) await withOllama(models, [stored]);
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
