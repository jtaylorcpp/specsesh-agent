#!/usr/bin/env node
/**
 * agentscript-task — run the task loop for one task of an OpenSpec change,
 * durably, on a Node SQLite database, unattended.
 *
 *   agentscript-task run <change> <task-id>|<group>|--next|--next-group [--db <path>] [--script <name|path>] [--workspace <dir>]
 *                    [--check <command>]... [--allow <word>]... [--max-iterations <n>]
 *                    [--escalate-to principal|agent] [--provider <id>] [--model <id>]
 *                    [--allow-dirty] [--worktree] [--json]
 *   agentscript-task resume <loop-id> [--db <path>] [--json]
 *   agentscript-task answer <loop-id> [--db <path>] --by principal|agent --decision <text> [--json]
 *   agentscript-task status [--db <path>]
 *
 * Defaults come from the nearest `agentscript.config.json` (its `task` object);
 * each value resolves flag → environment → config → default. `<change>` is an
 * id under the config's `changesDir`, or a path.
 *
 * Headless by construction: it never reads stdin and never prompts. Progress
 * goes to stderr as JSON Lines after the resume hint; the outcome goes to
 * stdout. A blocked loop exits 1 and ends with the exact `answer` command.
 *
 * `run` refuses a dirty working tree unless `--allow-dirty`, and never commits:
 * it prints the files the loop changed. `--worktree` runs the loop in a new git
 * worktree on `task/<change-id>/<task-id>` (a group: `task/<change-id>/<group>`,
 * one worktree for all its tasks) instead, and needs its own `--db`.
 * A database is held by one live process at a time (`<db>.lock`).
 *
 * `--provider claude-code` runs each step through your own `claude` binary; pair
 * it with the bundled task-delegate script, since that provider serves no
 * model-callable tools.
 */

import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
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
	groupLoopExtensions,
	startGroupLoop,
	startTaskLoop,
	taskLoopExtensions,
	waitForGroupLoop,
	waitForTaskLoopResult,
	type GroupLoopOptions,
	type LoopWorktree,
	type TaskLoopInput,
	type TaskLoopOptions,
	type TaskLoopResult,
} from "../task/index.js";
import {
	ConfigError,
	DEFAULT_MODEL,
	DEFAULT_PROVIDER,
	loadConfig,
	resolveDb,
	resolveGroupScript,
	resolveRunSettings,
	type DbPath,
	type LoadedConfig,
	type ResolvedScript,
	type RunSettings,
} from "../task/config.js";
import { LoopWatcher, jsonLines, now, type EventSink, type TaskEvent } from "../task/events.js";
import { changedBetween, insideGit, repoRoot, snapshot, status } from "../task/git.js";
import { DatabaseLockedError, lockDatabase, type DbLock } from "../task/lock.js";
import { ChangeNotFoundError, nextGroup, nextTask, resolveChange } from "../task/resolve.js";
import { changeOf, formatLoop, listLoops, scriptOf } from "../task/status.js";
import { WorktreeRefusedError, checkWorktree, createWorktree, inRepo, planWorktree, rebase, runSetup } from "../task/worktree.js";

export { DEFAULT_MODEL, DEFAULT_PROVIDER };

/** How many dirty paths a refusal lists before saying how many more there are. */
export const DIRTY_LISTED = 20;

const USAGE = `usage:
  agentscript-task run <change> <task-id>|<group>|--next|--next-group [--db <path>] [options]
      options: --script <name|path>  --workspace <dir>  --check <command>...  --allow <word>...
               --max-iterations <n>  --escalate-to principal|agent  --provider <id>  --model <id>
               --allow-dirty  --worktree  --json
  agentscript-task resume <loop-id> [--db <path>] [--json]
  agentscript-task answer <loop-id> [--db <path>] --by principal|agent --decision <text> [--json]
  agentscript-task status [--db <path>]`;

export interface CliDeps {
	/** The pi-ai model collection. Defaults to every built-in provider plus claude-code. */
	readonly models?: () => Promise<Models> | Models;
	readonly out?: (line: string) => void;
	readonly err?: (line: string) => void;
	/** The directory the CLI runs in. Defaults to `process.cwd()`. */
	readonly cwd?: string;
	/** The environment it reads. Defaults to `process.env`. */
	readonly env?: Readonly<Record<string, string | undefined>>;
	/** How often the event stream polls a running loop. */
	readonly pollMs?: number;
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

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Errors that refuse the run before a loop exists: exit 2, the message on stderr. */
const REFUSALS = [ConfigError, ChangeNotFoundError, WorktreeRefusedError, DatabaseLockedError];
const isRefusal = (error: unknown) => REFUSALS.some((kind) => error instanceof kind);

export async function main(argv: readonly string[], deps: CliDeps = {}): Promise<number> {
	const out = deps.out ?? ((line) => process.stdout.write(`${line}\n`));
	const err = deps.err ?? ((line) => process.stderr.write(`${line}\n`));
	const cwd = deps.cwd ?? process.cwd();
	const env = deps.env ?? process.env;
	const usage = (text?: string) => {
		if (text !== undefined) err(text);
		err(USAGE);
		return 2;
	};
	const [command, ...rest] = argv;
	if (command !== "run" && command !== "resume" && command !== "answer" && command !== "status") return usage();

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
				"max-reworks": { type: "string" },
				"group-script": { type: "string" },
				"escalate-to": { type: "string" },
				provider: { type: "string" },
				model: { type: "string" },
				next: { type: "boolean", default: false },
				"next-group": { type: "boolean", default: false },
				"allow-dirty": { type: "boolean", default: false },
				worktree: { type: "boolean" },
				by: { type: "string" },
				decision: { type: "string" },
				json: { type: "boolean", default: false },
			},
		});
	} catch (error) {
		return usage(message(error));
	}

	let config: LoadedConfig;
	try {
		config = loadConfig(cwd);
	} catch (error) {
		if (error instanceof ConfigError) {
			err(error.message);
			return 2;
		}
		throw error;
	}
	const io: Io = { out, err, emit: jsonLines(err), json: parsed.values.json, pollMs: deps.pollMs ?? 200 };
	try {
		if (command === "run") return await run(parsed.values, parsed.positionals, config, cwd, env, deps, io, usage);
		if (command === "status") {
			const db = resolveDb(parsed.values.db, config, cwd);
			if (db === undefined) return usage("status needs --db <path>, or a db in agentscript.config.json");
			return await showStatus(db, out);
		}
		return await continueLoop(command, parsed.values, parsed.positionals, config, cwd, deps, io, usage);
	} catch (error) {
		if (isRefusal(error)) {
			err(message(error));
			return 2;
		}
		throw error;
	}
}

interface Io {
	readonly out: (line: string) => void;
	readonly err: (line: string) => void;
	readonly emit: EventSink;
	readonly json: boolean | undefined;
	readonly pollMs: number;
}

type Values = Record<string, string | boolean | string[] | undefined>;

async function run(
	values: Values,
	positionals: readonly string[],
	config: LoadedConfig,
	cwd: string,
	env: Readonly<Record<string, string | undefined>>,
	deps: CliDeps,
	io: Io,
	usage: (text?: string) => number,
): Promise<number> {
	const target = parseTarget(positionals, { next: values["next"] === true, nextGroup: values["next-group"] === true });
	if (target.kind === "usage") return usage(target.reason);
	const maxIterations = values["max-iterations"] as string | undefined;
	if (maxIterations !== undefined && !/^[1-9][0-9]*$/.test(maxIterations)) {
		return usage(`--max-iterations must be a positive integer, got "${maxIterations}"`);
	}
	const maxReworks = values["max-reworks"] as string | undefined;
	if (maxReworks !== undefined && !/^[1-9][0-9]*$/.test(maxReworks)) {
		return usage(`--max-reworks must be a positive integer, got "${maxReworks}"`);
	}
	const escalateTo = values["escalate-to"] as string | undefined;
	if (escalateTo !== undefined && !isRecipient(escalateTo)) {
		return usage(`--escalate-to must be principal or agent, got "${escalateTo}"`);
	}
	const worktreeMode = (values["worktree"] as boolean | undefined) ?? config.task.worktree ?? false;
	if (worktreeMode && values["db"] === undefined) {
		io.err("worktree mode needs --db <path>: each worktree run names its own database, and the config's db is not used");
		return 2;
	}
	const settings = resolveRunSettings(
		{
			...(values["db"] !== undefined ? { db: values["db"] as string } : {}),
			...(values["script"] !== undefined ? { script: values["script"] as string } : {}),
			...(values["workspace"] !== undefined ? { workspace: values["workspace"] as string } : {}),
			...(values["check"] !== undefined ? { check: values["check"] as string[] } : {}),
			...(values["allow"] !== undefined ? { allow: values["allow"] as string[] } : {}),
			...(values["group-script"] !== undefined ? { groupScript: values["group-script"] as string } : {}),
			...(maxIterations !== undefined ? { maxIterations: Number(maxIterations) } : {}),
			...(maxReworks !== undefined ? { maxReworks: Number(maxReworks) } : {}),
			...(escalateTo !== undefined ? { escalateTo } : {}),
			...(values["provider"] !== undefined ? { provider: values["provider"] as string } : {}),
			...(values["model"] !== undefined ? { model: values["model"] as string } : {}),
			allowDirty: values["allow-dirty"] === true,
			worktree: worktreeMode,
		},
		env,
		config,
		cwd,
	);
	const db = settings.db;
	if (db === undefined) return usage("run needs --db <path>, or a db in agentscript.config.json");

	const change = resolveChange(target.change, settings.changesDir, cwd);
	const group = target.kind === "group" ? target.group : target.kind === "next-group" ? nextGroup(change.dir) : undefined;
	const task = target.kind === "task" ? target.task : target.kind === "next" ? nextTask(change.dir) : undefined;
	if (group === undefined && task === undefined) {
		io.out(`no unticked task in ${change.id}`);
		return 0;
	}

	// A missing group script refuses the run here, before any model or database is touched.
	const groupScript = group !== undefined ? resolveGroupScript(settings.groupScript.value, settings.groupScript.base) : undefined;

	const models = await (deps.models ?? builtin)();
	if (models.getModel(settings.provider, settings.model) === undefined) {
		io.err(`no model "${settings.model}" on provider "${settings.provider}"`);
		return 2;
	}

	// Warnings found before the loop exists go out after the resume hint, which stays the first stderr line.
	const warnings: string[] = [];
	let workspace = settings.workspace;
	let changeDir = change.dir;
	let delegateContext = settings.delegateContext;
	let worktree: LoopWorktree | undefined;
	if (settings.worktree) {
		const plan = planWorktree({
			cwd,
			changeId: change.id,
			target: group !== undefined ? { kind: "group", group } : { kind: "task", task: task ?? "" },
			...(settings.worktreeDir !== undefined ? { worktreeDir: settings.worktreeDir } : {}),
		});
		checkWorktree(plan, change.dir);
		const dirty = status(plan.repo).length;
		createWorktree(plan);
		worktree = { path: plan.path, branch: plan.branch };
		const setup = runSetup(settings.worktreeSetup, plan.path);
		if (!setup.ok) {
			io.err(`worktree setup failed: "${setup.command}" exited ${setup.code} in ${plan.path}; the worktree is left for inspection`);
			if (setup.output.trim() !== "") io.err(setup.output.trimEnd());
			return 1;
		}
		workspace = rebase(plan, workspace);
		changeDir = rebase(plan, change.dir);
		delegateContext = delegateContext.map((file) => rebase(plan, file));
		if (dirty > 0) {
			warnings.push(`${dirty} uncommitted change${dirty === 1 ? " is" : "s are"} in the main tree and not in the worktree`);
		}
	}
	if (insideGit(workspace)) {
		const entries = status(workspace);
		if (entries.length > 0 && settings.requireCleanTree) {
			io.err(`the working tree has ${entries.length} uncommitted change${entries.length === 1 ? "" : "s"}; commit or stash them, or pass --allow-dirty:`);
			for (const entry of entries.slice(0, DIRTY_LISTED)) io.err(`  ${entry.code} ${entry.path}`);
			if (entries.length > DIRTY_LISTED) io.err(`  … and ${entries.length - DIRTY_LISTED} more`);
			return 2;
		}
	} else {
		warnings.push(`${workspace} is not inside a git repository: the clean-tree guard was skipped, and changed files cannot be listed`);
	}

	mkdirSync(dirname(db.path), { recursive: true });
	const lock = lockDatabase(db.path);
	if (lock.staleFrom !== undefined) warnings.push(`took over a stale lock on ${db.label} left by process ${lock.staleFrom}, which is no longer running`);
	try {
		const options: Omit<TaskLoopOptions, "task"> = {
			change: { dir: changeDir },
			script: { path: settings.script.path },
			workspace,
			budget: { maxIterations: settings.maxIterations },
			checks: settings.checks,
			allow: settings.allow,
			escalateTo: settings.escalateTo,
			model: { provider: settings.provider, modelId: settings.model },
			delegateModel: settings.delegateModel,
			delegateContext,
			...(worktree !== undefined ? { worktree } : {}),
		};
		const registry = createRegistry();
		const extensions = group !== undefined ? groupLoopExtensions(options) : taskLoopExtensions(options);
		for (const extension of extensions) registry.install(extension);
		const harness = await Harness.open(await openNodeSqliteStorage(db.path), { models, registry }, BACKGROUND_CONTEXT);
		try {
			if (group !== undefined && groupScript !== undefined) {
				return await runGroup(harness, groupLoopOptions(options, group, groupScript, settings), io);
			}
			if (task === undefined) return usage();
			let id: LoopId;
			try {
				id = await startTaskLoop(harness, { ...options, task }, BACKGROUND_CONTEXT);
			} catch (error) {
				io.err(message(error));
				return 2;
			}
			// Before any model call, so a crash still leaves you the ID to resume.
			io.err(`loop ${id} — resume with: agentscript-task resume ${id} --db ${db.label}`);
			const loop = Number(id);
			io.emit({ event: "loop-started", loop, change: change.id, task, script: settings.script.label, at: now() });
			for (const warning of warnings) io.emit({ event: "warning", loop, message: warning });
			return await finish(harness, id, { io, db, workspace, tasksPath: join(changeDir, "tasks.md"), earlier: 0, ...(worktree !== undefined ? { worktree } : {}) });
		} finally {
			await harness.close(BACKGROUND_CONTEXT);
		}
	} finally {
		lock.release();
	}
}

/** What `run` was told to work, with the change already checked; or the usage failure. */
type RunTarget =
	| { kind: "task"; change: string; task: string }
	| { kind: "group"; change: string; group: number }
	| { kind: "next"; change: string }
	| { kind: "next-group"; change: string }
	| { kind: "usage"; reason?: string };

/** Exactly one of a task id, a group number, `--next` or `--next-group`, after the change. */
function parseTarget(positionals: readonly string[], flags: { next: boolean; nextGroup: boolean }): RunTarget {
	const [change, positional, ...extra] = positionals;
	if (change === undefined || extra.length > 0) return { kind: "usage" };
	const given = (positional !== undefined ? 1 : 0) + (flags.next ? 1 : 0) + (flags.nextGroup ? 1 : 0);
	if (given !== 1) return { kind: "usage", reason: "give exactly one of a task id, a group number, --next or --next-group" };
	if (flags.next) return { kind: "next", change };
	if (flags.nextGroup) return { kind: "next-group", change };
	if (positional === undefined) return { kind: "usage" };
	if (/^[1-9]\d*$/.test(positional)) return { kind: "group", change, group: Number(positional) };
	return { kind: "task", change, task: positional };
}

/** The options a group run starts with: the task options plus the group, its judge script and the rework budget. */
export function groupLoopOptions(
	options: Omit<TaskLoopOptions, "task">,
	group: number,
	groupScript: ResolvedScript,
	settings: Pick<RunSettings, "maxIterations" | "maxReworks">,
): GroupLoopOptions {
	return {
		...options,
		group,
		groupScript: { path: groupScript.path },
		budget: { maxIterations: settings.maxIterations, maxReworks: settings.maxReworks },
	};
}

/** Start a group loop and wait for it. Output is minimal until the group's own formatting lands. */
async function runGroup(harness: Harness, options: GroupLoopOptions, io: Io): Promise<number> {
	let id;
	try {
		id = await startGroupLoop(harness, options, BACKGROUND_CONTEXT);
	} catch (error) {
		io.err(message(error));
		return 2;
	}
	io.err(`group loop ${id}`);
	harness.resume();
	const outcome = await waitForGroupLoop(harness, id, BACKGROUND_CONTEXT);
	if (io.json === true) io.out(JSON.stringify({ loop: id, ...outcome }, null, 2));
	else io.out(`# group loop ${id} — ${outcome.status}`);
	return outcome.status === "converged" ? 0 : 1;
}

/** `resume` and `answer`: the loop's workspace, checks, allowlist, delegate and worktree come from the database. */
async function continueLoop(
	command: "resume" | "answer",
	values: Values,
	positionals: readonly string[],
	config: LoadedConfig,
	cwd: string,
	deps: CliDeps,
	io: Io,
	usage: (text?: string) => number,
): Promise<number> {
	const db = resolveDb(values["db"] as string | undefined, config, cwd);
	if (db === undefined) return usage(`${command} needs --db <path>, or a db in agentscript.config.json`);
	const target = positionals[0];
	if (target === undefined) return usage();
	let by: Recipient | undefined;
	const decision = values["decision"] as string | undefined;
	if (command === "answer") {
		const given = values["by"] as string | undefined;
		if (!isRecipient(given)) {
			return usage(given === undefined ? "answer needs --by principal|agent" : `--by must be principal or agent, got "${given}"`);
		}
		if (decision === undefined) return usage("answer needs --decision <text>");
		by = given;
	}
	if (!existsSync(db.path)) {
		io.err(`no loop ${target} in ${db.label}`);
		return 2;
	}
	const models = await (deps.models ?? builtin)();
	const warnings: string[] = [];
	const lock: DbLock = lockDatabase(db.path);
	if (lock.staleFrom !== undefined) warnings.push(`took over a stale lock on ${db.label} left by process ${lock.staleFrom}, which is no longer running`);
	try {
		const registry = createRegistry();
		registry.install(TaskLoop);
		const harness = await Harness.open(await openNodeSqliteStorage(db.path), { models, registry }, BACKGROUND_CONTEXT);
		try {
			const id = Number(target) as LoopId;
			const record = Number.isInteger(id) ? await harness.getTask(id, BACKGROUND_CONTEXT) : undefined;
			if (record === undefined || record.kind !== TASK_LOOP) {
				io.err(`no loop ${target} in ${db.label}`);
				return 2;
			}
			const input = record.input as unknown as TaskLoopInput;
			installActions(registry, input);
			const context = {
				io,
				db,
				workspace: input.workspace,
				...(input.tasksPath !== undefined ? { tasksPath: input.tasksPath } : {}),
				...(input.worktree !== undefined ? { worktree: input.worktree } : {}),
			};
			const started = (loop: number) => {
				io.emit({ event: "loop-started", loop, change: changeOf(input), task: input.task, script: scriptOf(input), at: now() });
				for (const warning of warnings) io.emit({ event: "warning", loop, message: warning });
			};
			if (command === "resume") {
				started(Number(id));
				return await finish(harness, id, { ...context, earlier: input.earlier.length });
			}

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
					{ escalation, by: by as Recipient, decision: decision as string, feedback: [] },
					BACKGROUND_CONTEXT,
				);
			} catch (error) {
				io.err(message(error));
				return 2;
			}
			io.err(`loop ${next} — resume with: agentscript-task resume ${next} --db ${db.label}`);
			started(Number(next));
			return await finish(harness, next, { ...context, earlier: settled?.outcome.iterations.length ?? 0 });
		} finally {
			await harness.close(BACKGROUND_CONTEXT);
		}
	} finally {
		lock.release();
	}
}

/** Bind the loop's actions to the workspace, checks, allowlist and delegate it was started with. */
function installActions(registry: Registry, input: TaskLoopInput): void {
	const [, run, step] = taskLoopExtensions({
		workspace: input.workspace,
		checks: input.checks,
		allow: input.allow,
		...(input.delegateModel !== undefined ? { delegateModel: input.delegateModel } : {}),
		...(input.delegateContext !== undefined ? { delegateContext: input.delegateContext } : {}),
	});
	registry.install(run);
	registry.install(step);
}

async function showStatus(db: DbPath, out: (line: string) => void): Promise<number> {
	if (!existsSync(db.path)) {
		out(`no loops in ${db.label}`);
		return 0;
	}
	const storage = await openNodeSqliteStorage(db.path);
	try {
		const loops = await listLoops(storage, BACKGROUND_CONTEXT);
		if (loops.length === 0) out(`no loops in ${db.label}`);
		for (const loop of loops) out(formatLoop(loop));
		return 0;
	} finally {
		await storage.close(BACKGROUND_CONTEXT);
	}
}

interface FinishContext {
	readonly io: Io;
	readonly db: DbPath;
	readonly workspace: string;
	/** The change's tasks.md, left out of `changed`: its tick is `ticked`. */
	readonly tasksPath?: string;
	readonly worktree?: LoopWorktree;
	/** Iterations an earlier run of this loop recorded. */
	readonly earlier: number;
}

/** The database file and what SQLite and the lock put beside it. */
const DB_SUFFIXES = ["", "-wal", "-shm", "-journal", ".lock"];

/** The repository-relative paths `changed` leaves out: the tick and the database's own files. */
function bookkeeping(root: string, context: FinishContext): Set<string> {
	const files = [...(context.tasksPath !== undefined ? [context.tasksPath] : []), ...DB_SUFFIXES.map((suffix) => `${context.db.path}${suffix}`)];
	const paths = new Set<string>();
	for (const file of files) {
		const rel = inRepo(root, file);
		if (rel !== undefined) paths.add(rel);
	}
	return paths;
}

async function finish(harness: Harness, id: LoopId, context: FinishContext): Promise<number> {
	const { io } = context;
	const inGit = insideGit(context.workspace);
	const before = inGit ? snapshot(context.workspace) : undefined;
	const watcher = new LoopWatcher(Number(id), io.emit, context.earlier);
	const stop = watcher.watch(harness, id, BACKGROUND_CONTEXT, io.pollMs);
	harness.resume();
	let result: Awaited<ReturnType<typeof waitForTaskLoopResult>>;
	try {
		result = await waitForTaskLoopResult(harness, id, BACKGROUND_CONTEXT);
	} finally {
		await stop();
	}
	const { outcome, notes } = result;
	watcher.finish(outcome);
	const changed =
		before !== undefined ? changedBetween(before, snapshot(context.workspace), bookkeeping(repoRoot(context.workspace), context)) : [];
	const ended: TaskEvent = {
		event: "loop-ended",
		loop: Number(id),
		status: outcome.status,
		iterations: outcome.iterations.length,
		ticked: outcome.status === "converged" ? outcome.result.ticked : false,
		changed,
	};
	io.emit(ended);

	const out = io.out;
	if (io.json === true) {
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
		if (changed.length > 0) out(`changed (uncommitted): ${changed.join(", ")}`);
		if (context.worktree !== undefined) {
			const { path, branch } = context.worktree;
			out(`worktree: ${path}`);
			out(`branch: ${branch}`);
			out(`review: git -C ${path} diff`);
			out(`remove: git worktree remove ${path}`);
		}
		if (outcome.status === "blocked") {
			out(`agentscript-task answer ${id} --db ${context.db.label} --by ${outcome.escalation.to} --decision "…"`);
		}
	}
	return outcome.status === "converged" ? 0 : 1;
}

// Run only as the entry point: through a bin symlink argv[1] is the link, so compare real paths.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	// An interrupt still releases the database lock: process.exit runs the lock's exit handler.
	process.once("SIGINT", () => process.exit(130));
	process.once("SIGTERM", () => process.exit(143));
	main(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(error: unknown) => {
			process.stderr.write(`${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`);
			process.exit(1);
		},
	);
}
