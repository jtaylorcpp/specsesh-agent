/**
 * `build <change> [<answer>]`: start, continue or answer a change's change loop,
 * addressed by change, never by loop.
 *
 *   newest change loop             build                        build "<answer>"
 *   none, ended exhausted/failed   starts one, after the guards refused, nothing waits
 *   not settled yet                resumed and awaited          refused
 *   blocked                        shown again, exit 1          answered as the escalation's `to`
 *   converged                      built, nothing starts        refused, nothing waits
 *
 * Three halves, so every refusal of the arguments comes before the database opens:
 * `parseBuild` reads the flags (the group run's, plus `--change-check`); `prepareBuild`
 * resolves them as a group run does, touching nothing; `runBuild` works the loop on a
 * harness the caller opened with the change loop installed. None prints, reads stdin or
 * prompts: the result says what to print and the exit code.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Context } from "@earendil-works/chord";
import type { Harness, ModelRef, TaskId } from "@earendil-works/pi-durable";
import type { DelegateGrants } from "../durable/delegation.js";
import type { ChangeOutcome, LoopOutcome, Recipient, ScenarioRef } from "../openspec/index.js";
import { answerChangeEscalation, readChangeResult, startChangeLoop, waitForChangeLoop } from "./change-api.js";
import type { ChangeLoopOptions } from "./change-input.js";
import type { ChangeLoopResult } from "./change-loop.js";
import { changeBuildState } from "./change-state.js";
import { isChangeId } from "./cmd-draft.js";
import { ConfigError, RUN_FLAG_OPTIONS, resolveGroupScript, resolveRunSettings, runFlagsOf, type DbPath, type LoadedConfig, type RunFlags } from "./config.js";
import { EscalationAnswerError } from "./errors.js";
import { changedBetween, insideGit, repoRoot, snapshot, status } from "./git.js";
import { blockedBy } from "./group.js";
import { shownPath } from "./spec-cli.js";
import { inRepo } from "./worktree.js";

type ChangeId = TaskId<LoopOutcome<ChangeOutcome>>;

/** How many dirty paths a refusal lists before saying how many more there are, as `pnpm task` does. */
const DIRTY_LISTED = 20;

/** The database file and what SQLite and the lock put beside it: never a change the build made. */
const DB_SUFFIXES = ["", "-wal", "-shm", "-journal", ".lock"];

/** The command's arguments: the change, the answer, and the group run's flags. */
export interface BuildArgs {
	readonly change: string;
	/** The answer to what the change's build waits for. */
	readonly answer?: string;
	readonly flags: Omit<RunFlags, "worktree">;
	/** `--change-check`, in order; undefined when none was given, so the checks stand in. */
	readonly changeChecks?: readonly string[];
	readonly noDelegates: boolean;
}

/** A malformed command line: the bin prints the message and the usage. */
export interface BuildUsage {
	readonly kind: "usage";
	readonly message: string;
}

export interface BuildRefusal {
	readonly kind: "refused";
	readonly message: string;
	readonly exitCode: 2;
}

export interface BuildPrepareOptions {
	readonly config: LoadedConfig;
	readonly env: Readonly<Record<string, string | undefined>>;
	/** The directory flag paths resolve against. */
	readonly cwd: string;
}

/** Checked arguments, resolved: what the bin opens and what the change loop starts with. */
export interface BuildRequest {
	readonly kind: "request";
	readonly change: string;
	readonly changeDir: string;
	/** `changeDir` as messages name it: relative to the config's directory when under it. */
	readonly changePath: string;
	readonly answer?: string;
	readonly db: DbPath;
	readonly provider: string;
	readonly model: string;
	readonly workspace: string;
	readonly checks: readonly string[];
	readonly allow: readonly string[];
	/** The config's grants, none under `--no-delegates`. */
	readonly delegates: DelegateGrants;
	/** False under `--allow-dirty` or the config's `requireCleanTree: false`. */
	readonly requireCleanTree: boolean;
	/** The change loop's options but its model, which the bin resolves. */
	readonly options: Omit<ChangeLoopOptions, "model">;
}

export interface BuildRunOptions {
	readonly model?: ModelRef;
	/** Called once a loop exists, before any model call, so a crash still leaves its ID. */
	readonly onLoop?: (loop: number) => void;
}

/** A group the build entered: its latest status, its tasks, and the reworks over them. */
export interface BuildGroup {
	readonly group: number;
	readonly status: string;
	readonly tasks: number;
	/** Over its tasks, `runs - 1`: each extra run is the judge reopening a task. */
	readonly reworks: number;
	/** The task it blocked at, when one did. */
	readonly blockedAt?: string;
}

interface Shown {
	readonly change: string;
	readonly loop: number;
	/** True when this call ran the loop; false when it only shows how the last one ended. */
	readonly ran: boolean;
	readonly groups: readonly BuildGroup[];
	/** The change check, when it ran: passed, or the reason holding each failing command and its output. */
	readonly check?: { readonly passed: true } | { readonly passed: false; readonly reason: string };
	readonly unclaimed: readonly ScenarioRef[];
	/** Repository-relative files changed while this call ran the loop; empty when it ran nothing. */
	readonly changed: readonly string[];
	readonly notes: readonly string[];
}

export type BuildResult =
	| BuildRefusal
	| (Shown & { readonly kind: "built"; readonly exitCode: 0 })
	| (Shown & { readonly kind: "waiting"; readonly to: Recipient; readonly question: string; readonly group?: number; readonly task?: string; readonly exitCode: 1 })
	| (Shown & { readonly kind: "failed"; readonly status: "exhausted" | "failed"; readonly reason: string; readonly exitCode: 1 });

const refused = (message: string): BuildRefusal => ({ kind: "refused", message, exitCode: 2 });

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** `<change> [<answer>]` and the group run's flags, plus `--change-check <command>` (repeatable). `--worktree` is refused. */
export function parseBuild(argv: readonly string[]): BuildArgs | BuildUsage | BuildRefusal {
	let parsed;
	try {
		parsed = parseArgs({
			args: [...argv],
			allowPositionals: true,
			options: { ...RUN_FLAG_OPTIONS, "change-check": { type: "string", multiple: true } },
		});
	} catch (error) {
		return { kind: "usage", message: message(error) };
	}
	const { values, positionals } = parsed;
	const [change, answer, ...extra] = positionals;
	if (change === undefined) return { kind: "usage", message: "build needs a change" };
	if (extra.length > 0) return { kind: "usage", message: `build takes a change and at most one answer, got ${positionals.join(" ")}; quote the answer` };
	if (values.worktree === true) return refused("build has no --worktree yet; run it in a clean checkout");
	const flags = runFlagsOf(values);
	if (typeof flags === "string") return { kind: "usage", message: flags };
	return {
		change,
		...(answer !== undefined ? { answer } : {}),
		flags,
		...(values["change-check"] !== undefined ? { changeChecks: values["change-check"] } : {}),
		noDelegates: values["no-delegates"] === true,
	};
}

/** Resolve the flags as a group run does and check the change. Opens nothing and writes nothing. */
export function prepareBuild(args: BuildArgs, options: BuildPrepareOptions): BuildRequest | BuildRefusal {
	const { change } = args;
	const { config, env, cwd } = options;
	let settings;
	let groupScript;
	try {
		// A build runs in place: the config's worktree mode is for `pnpm task`.
		settings = resolveRunSettings({ ...args.flags, worktree: false }, env, config, cwd);
		groupScript = resolveGroupScript(settings.groupScript.value, settings.groupScript.base);
	} catch (error) {
		if (error instanceof ConfigError) return refused(error.message);
		throw error;
	}
	const changesDir = resolve(settings.changesDir);
	const changeDir = resolve(changesDir, change);
	if (!isChangeId(change) || resolve(changeDir, "..") !== changesDir) {
		return refused(`"${change}" is not a change id: give the directory name under ${shownPath(config.dir, changesDir)}/`);
	}
	const changePath = shownPath(config.dir, changeDir);
	if (settings.db === undefined) return refused("build needs --db <path>, or a db in agentscript.config.json");
	const delegates: DelegateGrants = args.noDelegates ? {} : config.delegates;
	return {
		kind: "request",
		change,
		changeDir,
		changePath,
		...(args.answer !== undefined ? { answer: args.answer } : {}),
		db: settings.db,
		provider: settings.provider,
		model: settings.model,
		workspace: settings.workspace,
		checks: settings.checks,
		allow: settings.allow,
		delegates,
		requireCleanTree: settings.requireCleanTree,
		options: {
			change: { dir: changeDir },
			script: { path: settings.script.path },
			groupScript: { path: groupScript.path },
			workspace: settings.workspace,
			budget: { maxIterations: settings.maxIterations, maxReworks: settings.maxReworks },
			checks: settings.checks,
			changeChecks: args.changeChecks ?? settings.checks,
			allow: settings.allow,
			escalateTo: settings.escalateTo,
			// Nothing granted stores nothing, so the loop records no `delegates`.
			...(Object.keys(delegates).length > 0 ? { delegates } : {}),
		},
	};
}

/** Work the change's build on `harness` (the change loop installed, not yet resumed): what the table at the top says, then the result. */
export async function runBuild(harness: Harness, request: BuildRequest, options: BuildRunOptions, context: Context): Promise<BuildResult> {
	const { change, answer } = request;
	if (!existsSync(request.changeDir)) return refused(`the change ${change} does not exist in ${request.changePath}`);
	const state = await changeBuildState(harness, change, context);
	const nothingWaits = () => refused(`nothing of ${change} waits for an answer; run build ${change} without one`);

	switch (state.kind) {
		case "built":
			if (answer !== undefined) return nothingWaits();
			return shown(harness, request, state.loop, false, [], context);
		case "waiting": {
			if (answer === undefined) return shown(harness, request, state.loop, false, [], context);
			const { group: _group, task: _task, ...escalation } = state.escalation;
			let id: ChangeId;
			try {
				id = await answerChangeEscalation(
					harness,
					state.loop as unknown as ChangeId,
					{ escalation, by: escalation.to, decision: answer, feedback: [] },
					context,
				);
			} catch (error) {
				if (error instanceof EscalationAnswerError) return refused(error.message);
				throw error;
			}
			options.onLoop?.(Number(id));
			return settle(harness, request, Number(id), context);
		}
		case "ready": {
			if (state.running === true) {
				if (answer !== undefined) return refused(`change loop ${state.loop} of ${change} is still running; run build ${change} without an answer to finish it`);
				options.onLoop?.(state.loop!);
				return settle(harness, request, state.loop!, context);
			}
			if (answer !== undefined) return nothingWaits();
			const dirty = dirtyRefusal(request);
			if (dirty !== undefined) return dirty;
			let id: ChangeId;
			try {
				id = await startChangeLoop(harness, { ...request.options, ...(options.model !== undefined ? { model: options.model } : {}) }, context);
			} catch (error) {
				return refused(message(error));
			}
			options.onLoop?.(Number(id));
			return settle(harness, request, Number(id), context);
		}
	}
}

/** The refusal of a dirty tree, worded and listed as `pnpm task` words it; none when clean, allowed, or outside git. */
function dirtyRefusal(request: BuildRequest): BuildRefusal | undefined {
	if (!request.requireCleanTree || !insideGit(request.workspace)) return undefined;
	const entries = status(request.workspace);
	if (entries.length === 0) return undefined;
	const lines = [`the working tree has ${entries.length} uncommitted change${entries.length === 1 ? "" : "s"}; commit or stash them, or pass --allow-dirty:`];
	for (const entry of entries.slice(0, DIRTY_LISTED)) lines.push(`  ${entry.code} ${entry.path}`);
	if (entries.length > DIRTY_LISTED) lines.push(`  … and ${entries.length - DIRTY_LISTED} more`);
	return refused(lines.join("\n"));
}

/** Run change loop `loop` to its end, then show it with the files it changed. */
async function settle(harness: Harness, request: BuildRequest, loop: number, context: Context): Promise<BuildResult> {
	const track = changeTracker(request);
	harness.resume();
	try {
		await waitForChangeLoop(harness, loop as unknown as ChangeId, context);
	} catch (error) {
		// The task itself failed or was aborted: there is no outcome to show.
		return { kind: "failed", change: request.change, loop, ran: true, groups: [], unclaimed: [], changed: track(), notes: [], status: "failed", reason: message(error), exitCode: 1 };
	}
	return shown(harness, request, loop, true, track(), context);
}

/** How change loop `loop` ended, as the result to print. */
async function shown(harness: Harness, request: BuildRequest, loop: number, ran: boolean, changed: readonly string[], context: Context): Promise<BuildResult> {
	const { change } = request;
	const record = await harness.getTask(loop as unknown as TaskId<ChangeLoopResult>, context);
	if (record?.state.status !== "terminal" || record.state.outcome.status !== "completed") {
		return { kind: "failed", change, loop, ran, groups: [], unclaimed: [], changed, notes: [], status: "failed", reason: `change loop ${loop} did not complete`, exitCode: 1 };
	}
	const { outcome, notes } = readChangeResult(record.state.outcome.result, loop);
	const last = outcome.iterations.at(-1);
	const base: Shown = {
		change,
		loop,
		ran,
		groups: (outcome.result?.groups ?? []).map((entry) => {
			const tasks = entry.outcome.result?.tasks ?? [];
			const blockedAt = blockedBy(entry.outcome);
			return {
				group: entry.group,
				status: entry.outcome.status,
				tasks: tasks.length,
				reworks: tasks.reduce((sum, task) => sum + Math.max(0, task.runs - 1), 0),
				...(blockedAt !== null ? { blockedAt } : {}),
			};
		}),
		...(last !== undefined ? { check: last.verdict.met ? { passed: true as const } : { passed: false as const, reason: last.verdict.unmet.map((u) => u.reason).join("\n") } } : {}),
		unclaimed: outcome.result?.unclaimed ?? [],
		changed,
		notes,
	};
	switch (outcome.status) {
		case "converged":
			return { ...base, kind: "built", exitCode: 0 };
		case "blocked": {
			// The group and task it waits at, as `changeBuildState` reads them.
			const state = await changeBuildState(harness, change, context);
			const at: { group?: number; task?: string } = state.kind === "waiting" && state.loop === loop ? state.escalation : {};
			return {
				...base,
				kind: "waiting",
				to: outcome.escalation.to,
				question: outcome.escalation.question,
				...(at.group !== undefined ? { group: at.group } : {}),
				...(at.task !== undefined ? { task: at.task } : {}),
				exitCode: 1,
			};
		}
		default:
			return { ...base, kind: "failed", status: outcome.status, reason: notes.at(-1) ?? outcome.status, exitCode: 1 };
	}
}

/** Snapshot the tree now; the returned function lists what changed since, less tasks.md (its ticks) and the database. Nothing outside git. */
function changeTracker(request: BuildRequest): () => string[] {
	if (!insideGit(request.workspace)) return () => [];
	const root = repoRoot(request.workspace);
	const skip = new Set<string>();
	for (const file of [join(request.changeDir, "tasks.md"), ...DB_SUFFIXES.map((suffix) => `${request.db.path}${suffix}`)]) {
		const rel = inRepo(root, file);
		if (rel !== undefined) skip.add(rel);
	}
	const before = snapshot(request.workspace);
	return () => changedBetween(before, snapshot(request.workspace), skip);
}
