/**
 * `build <change> [<answer>|--amend]`: start, continue or answer a change's change loop,
 * addressed by change, never by loop.
 *
 *   newest change loop             build                        build "<answer>"
 *   none, ended exhausted/failed   starts one, after the guards refused, nothing waits
 *   not settled yet                resumed and awaited          refused
 *   blocked                        shown again, exit 1          answered as the escalation's `to`
 *   converged                      built, nothing starts        refused, nothing waits
 *
 * `--amend` is refused (exit 2, nothing written) unless the loop is blocked on an escalation
 * carrying an `Amendment` whose delta is a `specs/**\/spec.md`. Then `applyAmendment` writes,
 * validates and trial-folds it: a failure is restored and answers nothing (`amend-failed`,
 * exit 2). A pass records the delta's new sha256 in the specs approval, by the principal with
 * the note `amendment-applied`, then answers the loop `amendment-applied`, as a text answer
 * would. A failed recording leaves the delta written, answers nothing and exits 2.
 *
 * Starting a loop, answering one and `--amend` are refused (exit 2) while a file of an approved
 * stage differs from its recorded sha256, after the argument refusals and before the dirty-tree
 * check. Showing a question, a built change or resuming a running loop checks nothing.
 *
 * Three halves, so every refusal of the arguments comes before the database opens:
 * `parseBuild` reads the flags (the group run's, plus `--change-check`); `prepareBuild`
 * resolves them as a group run does, touching nothing; `runBuild` works the loop on a
 * harness the caller opened with the change loop installed. None prints, reads stdin or
 * prompts: the result says what to print and the exit code.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Context } from "@earendil-works/chord";
import type { Harness, ModelRef, TaskId } from "@earendil-works/pi-durable";
import type { DelegateGrants } from "../durable/delegation.js";
import { AMENDMENT_APPLIED, type Amendment, type ChangeOutcome, type LoopOutcome, type Recipient, type ScenarioRef } from "../openspec/index.js";
import { amendmentTarget, applyAmendment } from "./amend.js";
import { answerChangeEscalation, readChangeResult, startChangeLoop, waitForChangeLoop } from "./change-api.js";
import type { ChangeLoopOptions } from "./change-input.js";
import type { ChangeLoopResult } from "./change-loop.js";
import { changeBuildState, type ChangeBuildState } from "./change-state.js";
import { isChangeId } from "./cmd-draft.js";
import { ConfigError, RUN_FLAG_OPTIONS, resolveGroupScript, resolveRunSettings, runFlagsOf, type DbPath, type LoadedConfig, type RunFlags } from "./config.js";
import { formatStaleApprovalRefusal } from "./change-output.js";
import { ApprovalsFileError, EscalationAnswerError } from "./errors.js";
import { changedBetween, insideGit, repoRoot, snapshot, status } from "./git.js";
import { blockedBy } from "./group.js";
import { listStaleApprovedFiles, recordSpecAmendment } from "./spec-approvals.js";
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
	/** `--amend`: apply the waiting escalation's amendment, then answer `amendment-applied`. Never with `answer`. */
	readonly amend?: boolean;
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
	readonly amend: boolean;
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
	/** Who records an applied amendment: `git config user.name`, else `$USER`. Without one, `--amend` is refused. */
	readonly principal?: string;
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
	/** Set when `--amend` applied an amendment that passed validation and answered the loop before this run. */
	readonly amended?: Amended;
}

/** What `--amend` wrote and who it answered, as the output names them. */
export interface Amended {
	/** `<changePath>/<delta>`. */
	readonly path: string;
	/** Relative to the change directory, as `approvals.json` records it. */
	readonly delta: string;
	/** Who the specs approval now names for it. */
	readonly principal: string;
	/** `task <id>` or `group <n> judge`. */
	readonly asker: string;
}

/** `--amend` whose validation failed: the file is back as it was and no loop was answered. */
export interface AmendFailed {
	readonly kind: "amend-failed";
	readonly change: string;
	/** `<changePath>/<delta>`, written then restored. */
	readonly path: string;
	/** The validation's output, then the trial fold's when it ran. */
	readonly output: string;
	readonly exitCode: 2;
}

/** The amendment a blocked build's escalation carries, with who asked and the file it would replace as it is on disk. */
export interface ShownAmendment {
	/** The task loop that escalated, or the group judge. */
	readonly asker: { readonly kind: "task"; readonly id: string } | { readonly kind: "judge"; readonly group: number };
	/** Relative to the change directory. */
	readonly delta: string;
	/** `<changePath>/<delta>`, as the diff headers name it. */
	readonly path: string;
	/** The file's text, or `null` when it does not exist or `delta` is not a target `--amend` would write. */
	readonly onDisk: string | null;
	readonly text: string;
}

export type BuildResult =
	| BuildRefusal
	| AmendFailed
	| (Shown & { readonly kind: "built"; readonly exitCode: 0 })
	| (Shown & {
			readonly kind: "waiting";
			readonly to: Recipient;
			readonly question: string;
			readonly group?: number;
			readonly task?: string;
			readonly amendment?: ShownAmendment;
			readonly exitCode: 1;
	  })
	| (Shown & { readonly kind: "failed"; readonly status: "exhausted" | "failed"; readonly reason: string; readonly exitCode: 1 });

const refused = (message: string): BuildRefusal => ({ kind: "refused", message, exitCode: 2 });

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * `<change> [<answer>|--amend]` and the group run's flags, plus `--change-check <command>`
 * (repeatable). `--worktree`, and `--amend` with an answer, are refused.
 */
export function parseBuild(argv: readonly string[]): BuildArgs | BuildUsage | BuildRefusal {
	let parsed;
	try {
		parsed = parseArgs({
			args: [...argv],
			allowPositionals: true,
			options: { ...RUN_FLAG_OPTIONS, "change-check": { type: "string", multiple: true }, amend: { type: "boolean" } },
		});
	} catch (error) {
		return { kind: "usage", message: message(error) };
	}
	const { values, positionals } = parsed;
	const [change, answer, ...extra] = positionals;
	if (change === undefined) return { kind: "usage", message: "build needs a change" };
	if (extra.length > 0) return { kind: "usage", message: `build takes a change and at most one answer, got ${positionals.join(" ")}; quote the answer` };
	const amend = values.amend === true;
	if (amend && answer !== undefined) return refused('--amend takes no answer: use either --amend or "<answer>"');
	if (values.worktree === true) return refused("build has no --worktree yet; run it in a clean checkout");
	const flags = runFlagsOf(values);
	if (typeof flags === "string") return { kind: "usage", message: flags };
	return {
		change,
		...(answer !== undefined ? { answer } : {}),
		...(amend ? { amend } : {}),
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
		amend: args.amend === true,
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
	if (request.amend) {
		if (state.kind !== "waiting" || state.escalation.amendment === undefined) return refused(`${change} is not waiting on an amendment`);
		return amend(harness, request, { loop: state.loop, escalation: state.escalation, amendment: state.escalation.amendment }, options, context);
	}

	switch (state.kind) {
		case "built":
			if (answer !== undefined) return nothingWaits();
			return shown(harness, request, state.loop, false, [], context);
		case "waiting": {
			if (answer === undefined) return shown(harness, request, state.loop, false, [], context);
			const stale = staleRefusal(request);
			if (stale !== undefined) return stale;
			return answered(harness, request, state, answer, undefined, options, context);
		}
		case "ready": {
			if (state.running === true) {
				if (answer !== undefined) return refused(`change loop ${state.loop} of ${change} is still running; run build ${change} without an answer to finish it`);
				options.onLoop?.(state.loop!);
				return settle(harness, request, state.loop!, context);
			}
			if (answer !== undefined) return nothingWaits();
			// Before the dirty tree: an uncommitted hand edit gets the stale refusal, which --allow-dirty cannot pass.
			const stale = staleRefusal(request);
			if (stale !== undefined) return stale;
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

type Waiting = Extract<ChangeBuildState, { kind: "waiting" }>;

/** The loop that asked, as the output names it: `task <id>` or `group <n> judge`. */
function askerOf(at: { group?: number; task?: string }): string | undefined {
	return at.task !== undefined ? `task ${at.task}` : at.group !== undefined ? `group ${at.group} judge` : undefined;
}

/**
 * `--amend`: check the delta, write it, validate and trial-fold. A failure leaves the file as it
 * was and answers nothing. A pass records the written bytes' sha256 in the specs approval, then
 * answers the waiting loop `amendment-applied`, as a text answer would; a failed recording
 * answers nothing and leaves the delta written, so the next `--amend` is refused as stale.
 */
async function amend(
	harness: Harness,
	request: BuildRequest,
	waiting: Pick<Waiting, "loop" | "escalation"> & { readonly amendment: Amendment },
	options: BuildRunOptions,
	context: Context,
): Promise<BuildResult> {
	const { amendment } = waiting;
	const target = amendmentTarget(dirname(request.changeDir), request.change, amendment.delta);
	if (!target.ok) return refused(target.message);
	// `amendment-applied` is the principal's alone: refuse here, before the write, not after it.
	if (waiting.escalation.to !== "principal") {
		return refused(`the escalation of ${request.change} goes to the ${waiting.escalation.to}: only the principal applies an amendment`);
	}
	// On the files as they are before the write, the delta included: a hand edit is never written over.
	const stale = staleRefusal(request);
	if (stale !== undefined) return stale;
	// Known before the write, so a delta that could never be recorded is not written.
	const principal = options.principal?.trim() ?? "";
	if (principal === "") return refused("--amend needs a principal: set git config user.name or $USER");
	const path = `${request.changePath}/${amendment.delta}`;
	const applied = await applyAmendment({ target: target.path, text: amendment.text, change: request.change, root: request.workspace });
	if (!applied.passed) return { kind: "amend-failed", change: request.change, path, output: applied.output, exitCode: 2 };
	// The key `approvals.json` holds: the delta as `amendmentTarget` normalised it.
	const delta = posix.normalize(amendment.delta);
	try {
		// `applyAmendment` wrote `text` as UTF-8, so these are the bytes on disk.
		const sha256 = createHash("sha256").update(amendment.text, "utf8").digest("hex");
		recordSpecAmendment(request.changeDir, delta, { sha256, principal, notes: AMENDMENT_APPLIED });
	} catch (error) {
		return refused(`${request.change}: could not record approval for ${delta}: ${message(error)}`);
	}
	const asker = askerOf(waiting.escalation) ?? `change loop ${waiting.loop}`;
	return answered(harness, request, waiting, AMENDMENT_APPLIED, { path, delta, principal, asker }, options, context);
}

/** Answer the waiting change loop with `decision`, then run the new run to its end. */
async function answered(
	harness: Harness,
	request: BuildRequest,
	waiting: Pick<Waiting, "loop" | "escalation">,
	decision: string,
	amended: Amended | undefined,
	options: BuildRunOptions,
	context: Context,
): Promise<BuildResult> {
	const { group: _group, task: _task, ...escalation } = waiting.escalation;
	let id: ChangeId;
	try {
		id = await answerChangeEscalation(harness, waiting.loop as unknown as ChangeId, { escalation, by: escalation.to, decision, feedback: [] }, context);
	} catch (error) {
		if (error instanceof EscalationAnswerError) return refused(error.message);
		throw error;
	}
	options.onLoop?.(Number(id));
	const result = await settle(harness, request, Number(id), context);
	return amended !== undefined && result.kind !== "refused" && result.kind !== "amend-failed" ? { ...result, amended } : result;
}

/** The refusal of approved files that changed since their approval, the rule `draft` redrafts by; none when every file matches. */
function staleRefusal(request: BuildRequest): BuildRefusal | undefined {
	let files;
	try {
		files = listStaleApprovedFiles(request.changeDir);
	} catch (error) {
		if (error instanceof ApprovalsFileError) return refused(`${request.changePath}/${error.message}`);
		throw error;
	}
	return files.length > 0 ? refused(formatStaleApprovalRefusal(request.change, files).join("\n")) : undefined;
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
			const amendment = shownAmendment(request, outcome.escalation.amendment, at);
			return {
				...base,
				kind: "waiting",
				to: outcome.escalation.to,
				question: outcome.escalation.question,
				...(at.group !== undefined ? { group: at.group } : {}),
				...(at.task !== undefined ? { task: at.task } : {}),
				...(amendment !== undefined ? { amendment } : {}),
				exitCode: 1,
			};
		}
		default:
			return { ...base, kind: "failed", status: outcome.status, reason: notes.at(-1) ?? outcome.status, exitCode: 1 };
	}
}

/**
 * The escalation's amendment as the output shows it, read against the file on disk now: what
 * `--amend` would write over. A `delta` `--amend` would refuse is not read, so it diffs from nothing.
 */
function shownAmendment(request: BuildRequest, amendment: Amendment | undefined, at: { group?: number; task?: string }): ShownAmendment | undefined {
	if (amendment === undefined) return undefined;
	const asker: ShownAmendment["asker"] | undefined =
		at.task !== undefined ? { kind: "task", id: at.task } : at.group !== undefined ? { kind: "judge", group: at.group } : undefined;
	if (asker === undefined) return undefined;
	const target = amendmentTarget(dirname(request.changeDir), request.change, amendment.delta);
	return {
		asker,
		delta: amendment.delta,
		path: `${request.changePath}/${amendment.delta}`,
		onDisk: target.ok ? textOnDisk(target.path) : null,
		text: amendment.text,
	};
}

/** The file's text, or `null` when it does not exist. */
function textOnDisk(path: string): string | null {
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
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
