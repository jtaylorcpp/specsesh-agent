#!/usr/bin/env node
/**
 * agentscript-task — run the task loop for one task of an OpenSpec change,
 * durably, on a Node SQLite database.
 *
 *   agentscript-task run <change-dir> <task-id> --db <path> [--script <path>] [--workspace <dir>]
 *                    [--check <command>]... [--allow <word>]... [--max-iterations <n>]
 *                    [--escalate-to principal|agent] [--provider <id>] [--model <id>] [--json]
 *   agentscript-task resume <loop-id> --db <path> [--json]
 *   agentscript-task answer <loop-id> --db <path> --by principal|agent --decision <text> [--json]
 *
 * `run` prints the loop ID before the first model call; `resume` finishes a loop
 * whose process died, from the database alone. `answer` answers a blocked loop's
 * escalation and waits for the new run it starts.
 *
 * Provider and model resolve like agentscript-durable's: flag, then
 * AGENTSCRIPT_PROVIDER / AGENTSCRIPT_MODEL, then anthropic / claude-haiku-4-5.
 * `--provider claude-code` runs each step through your own `claude` binary; pair
 * it with the bundled task-delegate.agent, since that provider serves no
 * model-callable tools.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai";
import { createRegistry, Harness, type Registry, type TaskId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { Escalation, LoopOutcome, Recipient, TaskOutcome } from "../openspec/index.js";
import {
	TASK_LOOP,
	TaskLoop,
	answerEscalation,
	startTaskLoop,
	taskLoopExtensions,
	waitForTaskLoopResult,
	type TaskLoopInput,
	type TaskLoopOptions,
	type TaskLoopResult,
} from "../task/index.js";

export const DEFAULT_PROVIDER = "anthropic";
export const DEFAULT_MODEL = "claude-haiku-4-5";

const USAGE = `usage:
  agentscript-task run <change-dir> <task-id> --db <path> [options]
      options: --script <path>  --workspace <dir>  --check <command>...  --allow <word>...
               --max-iterations <n>  --escalate-to principal|agent  --provider <id>  --model <id>  --json
  agentscript-task resume <loop-id> --db <path> [--json]
  agentscript-task answer <loop-id> --db <path> --by principal|agent --decision <text> [--json]`;

export interface CliDeps {
	/** The pi-ai model collection. Defaults to every built-in provider plus claude-code. */
	readonly models?: () => Promise<Models> | Models;
	readonly out?: (line: string) => void;
	readonly err?: (line: string) => void;
	/** The working directory `--workspace` defaults to. Defaults to `process.cwd()`. */
	readonly cwd?: () => string;
}

type LoopId = TaskId<LoopOutcome<TaskOutcome>>;

async function builtin(): Promise<Models> {
	const { builtinModels } = await import("@earendil-works/pi-ai/providers/all");
	const { claudeCodeProvider } = await import("../claude-code/index.js");
	const models = builtinModels();
	models.setProvider(claudeCodeProvider());
	return models;
}

const isRecipient = (value: string | undefined): value is Recipient => value === "principal" || value === "agent";

export async function main(argv: readonly string[], deps: CliDeps = {}): Promise<number> {
	const out = deps.out ?? ((line) => process.stdout.write(`${line}\n`));
	const err = deps.err ?? ((line) => process.stderr.write(`${line}\n`));
	const usage = (message?: string) => {
		if (message !== undefined) err(message);
		err(USAGE);
		return 2;
	};
	const [command, ...rest] = argv;
	if (command !== "run" && command !== "resume" && command !== "answer") return usage();

	let parsed;
	try {
		parsed = parseArgs({
			args: [...rest],
			allowPositionals: true,
			options: {
				db: { type: "string" },
				script: { type: "string" },
				workspace: { type: "string" },
				check: { type: "string", multiple: true },
				allow: { type: "string", multiple: true },
				"max-iterations": { type: "string" },
				"escalate-to": { type: "string" },
				provider: { type: "string" },
				model: { type: "string" },
				by: { type: "string" },
				decision: { type: "string" },
				json: { type: "boolean", default: false },
			},
		});
	} catch (error) {
		return usage(error instanceof Error ? error.message : String(error));
	}
	const { values, positionals } = parsed;
	const db = values.db;
	if (db === undefined) return usage();

	if (command === "run") {
		const [dir, task] = positionals;
		if (dir === undefined || task === undefined) return usage();
		const maxIterations = values["max-iterations"];
		if (maxIterations !== undefined && !/^[1-9][0-9]*$/.test(maxIterations)) {
			return usage(`--max-iterations must be a positive integer, got "${maxIterations}"`);
		}
		const escalateTo = values["escalate-to"];
		if (escalateTo !== undefined && !isRecipient(escalateTo)) {
			return usage(`--escalate-to must be principal or agent, got "${escalateTo}"`);
		}
		const models = await (deps.models ?? builtin)();
		const provider = values.provider ?? process.env.AGENTSCRIPT_PROVIDER ?? DEFAULT_PROVIDER;
		const modelId = values.model ?? process.env.AGENTSCRIPT_MODEL ?? DEFAULT_MODEL;
		if (models.getModel(provider, modelId) === undefined) {
			err(`no model "${modelId}" on provider "${provider}"`);
			return 2;
		}
		const options: TaskLoopOptions = {
			change: { dir },
			task,
			...(values.script !== undefined ? { script: { path: values.script } } : {}),
			workspace: values.workspace ?? (deps.cwd ?? (() => process.cwd()))(),
			...(maxIterations !== undefined ? { budget: { maxIterations: Number(maxIterations) } } : {}),
			checks: values.check ?? [],
			allow: values.allow ?? [],
			...(escalateTo !== undefined ? { escalateTo } : {}),
			model: { provider, modelId },
		};
		const registry = createRegistry();
		for (const extension of taskLoopExtensions(options)) registry.install(extension);
		const harness = await Harness.open(await openNodeSqliteStorage(db), { models, registry }, BACKGROUND_CONTEXT);
		try {
			let id: LoopId;
			try {
				id = await startTaskLoop(harness, options, BACKGROUND_CONTEXT);
			} catch (error) {
				err(error instanceof Error ? error.message : String(error));
				return 2;
			}
			// Before any model call, so a crash still leaves you the ID to resume.
			err(`loop ${id} — resume with: agentscript-task resume ${id} --db ${db}`);
			return await finish(harness, id, values.json, out);
		} finally {
			await harness.close(BACKGROUND_CONTEXT);
		}
	}

	// resume and answer: the loop's workspace, checks and allowlist come from the database.
	const target = positionals[0];
	if (target === undefined) return usage();
	let by: Recipient | undefined;
	if (command === "answer") {
		if (!isRecipient(values.by)) {
			return usage(values.by === undefined ? "answer needs --by principal|agent" : `--by must be principal or agent, got "${values.by}"`);
		}
		if (values.decision === undefined) return usage("answer needs --decision <text>");
		by = values.by;
	}
	const models = await (deps.models ?? builtin)();
	const registry = createRegistry();
	registry.install(TaskLoop);
	const harness = await Harness.open(await openNodeSqliteStorage(db), { models, registry }, BACKGROUND_CONTEXT);
	try {
		const id = Number(target) as LoopId;
		const record = Number.isInteger(id) ? await harness.getTask(id, BACKGROUND_CONTEXT) : undefined;
		if (record === undefined || record.kind !== TASK_LOOP) {
			err(`no loop ${target} in ${db}`);
			return 2;
		}
		installActions(registry, record.input as unknown as TaskLoopInput);
		if (command === "resume") return await finish(harness, id, values.json, out);

		const settled = record.state.status === "terminal" && record.state.outcome.status === "completed"
			? (record.state.outcome.result as unknown as TaskLoopResult)
			: undefined;
		const escalation = settled?.outcome.status === "blocked" ? (settled.outcome.escalation as Escalation) : undefined;
		let next: LoopId;
		try {
			if (escalation === undefined) throw new Error(`loop ${id} has not ended blocked, so it has no escalation to answer`);
			next = await answerEscalation(
				harness,
				id,
				{ escalation, by: by as Recipient, decision: values.decision as string, feedback: [] },
				BACKGROUND_CONTEXT,
			);
		} catch (error) {
			err(error instanceof Error ? error.message : String(error));
			return 2;
		}
		err(`loop ${next} — resume with: agentscript-task resume ${next} --db ${db}`);
		return await finish(harness, next, values.json, out);
	} finally {
		await harness.close(BACKGROUND_CONTEXT);
	}
}

/** Bind the loop's actions to the workspace, checks and allowlist it was started with. */
function installActions(registry: Registry, input: TaskLoopInput): void {
	const [, run, step] = taskLoopExtensions({ workspace: input.workspace, checks: input.checks, allow: input.allow });
	registry.install(run);
	registry.install(step);
}

async function finish(harness: Harness, id: LoopId, json: boolean | undefined, out: (line: string) => void): Promise<number> {
	harness.resume();
	const { outcome, notes } = await waitForTaskLoopResult(harness, id, BACKGROUND_CONTEXT);
	if (json === true) {
		out(JSON.stringify({ loop: id, ...outcome }, null, 2));
	} else {
		out(`# loop ${id} — ${outcome.status}`);
		for (const iteration of outcome.iterations) {
			out(`## iteration ${iteration.n}: ${iteration.verdict.met ? "met" : "unmet"}`);
			if (!iteration.verdict.met) for (const unmet of iteration.verdict.unmet) out(unmet.reason);
		}
		if (outcome.status === "blocked") {
			out(`escalation to: ${outcome.escalation.to}`);
			out(`question: ${outcome.escalation.question}`);
		}
		if (outcome.status === "converged") out(`ticked: ${outcome.result.ticked}`);
		for (const note of notes) out(`note: ${note}`);
	}
	return outcome.status === "converged" ? 0 : 1;
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
