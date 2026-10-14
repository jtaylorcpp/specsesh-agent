/**
 * `close <change>`: fold a finished change into `openspec/specs/` and move it under
 * `openspec/changes/archive/`, addressed by change, never by loop.
 *
 *   guard   every task in tasks.md ticked                        else refused, listing the unticked
 *           newest change loop of the change, if any, converged  else refused, naming its state
 *           openspec validate <change> --strict                  else refused, the first issue
 *   trial   openspec/ copied to a temporary directory, then there
 *           openspec archive <change> --yes, openspec validate --specs --strict
 *                                                                else refused, openspec/ untouched
 *   fold    openspec archive <change> --yes, in the repository
 *
 * A change built task by task with `pnpm task` has no change loop, so the ticked tasks
 * are the evidence every route leaves; a change loop, when there is one, must have
 * converged. Every `openspec` call runs with `OPENSPEC_TELEMETRY=0`, as the build's guard
 * runs them. Two halves, as `approve`: `prepareClose` checks the change id, touching
 * nothing; `runClose` reads the database and folds. Neither prints, reads stdin, prompts
 * or commits: the result says what to print and the exit code.
 */

import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import type { Context } from "@earendil-works/chord";
import type { Harness } from "@earendil-works/pi-durable";
import { guardRun, readChangeResult } from "./change-api.js";
import { newestChangeLoop } from "./change-state.js";
import { isChangeId } from "./cmd-draft.js";
import { shownPath } from "./spec-cli.js";
import { openspecValidate } from "./stages/openspec-cli.js";
import { taskLines } from "./tasks-md.js";

/** How much of a failed `openspec` call's output a refusal quotes. */
const OUTPUT_LIMIT = 2000;

/** The command's arguments, as the bin parsed them. */
export interface CloseArgs {
	readonly change: string;
}

export interface ClosePrepareOptions {
	/** The repo root, where `openspec/` lives and `openspec` runs. */
	readonly workspace: string;
	/** The directory holding the change directories: the config's `changesDir`, resolved. */
	readonly changesDir: string;
}

export interface CloseRequest {
	readonly kind: "request";
	readonly change: string;
	readonly workspace: string;
	readonly changesDir: string;
	readonly changeDir: string;
	/** `changeDir` as messages name it: relative to the workspace when under it. */
	readonly changePath: string;
}

export interface CloseRefusal {
	readonly kind: "refused";
	readonly message: string;
	readonly exitCode: 2;
}

/** A capability the change folded into. */
export interface ClosedCapability {
	/** `<area>/<name>`, as under `openspec/specs/`. */
	readonly capability: string;
	/** True when `openspec/specs/<capability>/spec.md` did not exist before the fold. */
	readonly created: boolean;
	/** The requirements its delta adds, modifies, removes or renames. */
	readonly requirements: number;
}

export type CloseResult =
	| CloseRefusal
	| {
			readonly kind: "closed";
			readonly change: string;
			/** In path order. */
			readonly capabilities: readonly ClosedCapability[];
			/** The archived change directory, as messages name it, ending in `/`. */
			readonly archive: string;
			readonly exitCode: 0;
	  };

const refused = (message: string): CloseRefusal => ({ kind: "refused", message, exitCode: 2 });

/** Check the change id. Opens nothing, so a refusal leaves everything as it was. */
export function prepareClose(args: CloseArgs, options: ClosePrepareOptions): CloseRequest | CloseRefusal {
	const { change } = args;
	const workspace = resolve(options.workspace);
	const changesDir = resolve(options.changesDir);
	const changeDir = resolve(changesDir, change);
	if (!isChangeId(change) || dirname(changeDir) !== changesDir) {
		return refused(`"${change}" is not a change id: give the directory name under ${shownPath(workspace, changesDir)}/`);
	}
	return { kind: "request", change, workspace, changesDir, changeDir, changePath: shownPath(workspace, changeDir) };
}

/**
 * Close the change: the guard, the trial fold, then the fold. `harness` is the database the
 * change's build runs in, read only; undefined when there is none, so no change loop is asked for.
 */
export async function runClose(harness: Pick<Harness, "commit"> | undefined, request: CloseRequest, context: Context): Promise<CloseResult> {
	const { change, workspace, changeDir, changePath } = request;
	if (!existsSync(changeDir)) return refused(`the change ${change} does not exist in ${changePath}`);

	const tasksPath = join(changeDir, "tasks.md");
	if (!existsSync(tasksPath)) return refused(`${changePath} has no tasks.md; a change closes when every task is ticked`);
	const unticked = taskLines(readFileSync(tasksPath, "utf8")).filter((line) => !line.done);
	if (unticked.length > 0) return refused(`${change} has unticked tasks: ${unticked.map((line) => line.id).join(", ")}`);

	if (harness !== undefined) {
		const loopRefusal = await changeLoopRefusal(harness, change, context);
		if (loopRefusal !== undefined) return refused(loopRefusal);
	}

	const run = guardRun(workspace);
	const issue = (await openspecValidate(run, change)).find((i) => i.level === "ERROR" || i.level === "WARNING");
	if (issue !== undefined) return refused(`change ${change} is not valid: ${issue.path}: ${issue.message}`);

	const trial = await trialFold(change, workspace);
	if (!trial.ok) {
		return refused(`folded into a copy of openspec/, openspec ${trial.step} failed (exit ${trial.exitCode}):\n${tail(trial.output)}\nopenspec/ is unchanged`);
	}

	// Read before the fold moves the change and creates its new specs.
	const capabilities = capabilitiesOf(request);
	const archiveDir = join(request.changesDir, "archive");
	const archivedBefore = new Set(archived(archiveDir, change));

	const fold = await run(["env", "OPENSPEC_TELEMETRY=0", "openspec", "archive", change, "--yes"]);
	if (fold.exitCode !== 0) return refused(`openspec archive ${change} --yes failed (exit ${fold.exitCode}):\n${tail(fold.output)}`);
	const moved = archived(archiveDir, change).filter((name) => !archivedBefore.has(name));
	const last = moved.at(-1);
	if (last === undefined) {
		return refused(`openspec archive ${change} --yes exited 0 but moved nothing under ${shownPath(workspace, archiveDir)}/; check openspec/ with git status`);
	}
	return { kind: "closed", change, capabilities, archive: `${shownPath(workspace, join(archiveDir, last))}/`, exitCode: 0 };
}

/** Why the change's newest change loop forbids closing; none when it converged or there is none. */
async function changeLoopRefusal(harness: Pick<Harness, "commit">, change: string, context: Context): Promise<string | undefined> {
	const record = await newestChangeLoop(harness, change, context);
	if (record === undefined) return undefined;
	const loop = Number(record.id);
	if (record.state.status !== "terminal") return `change loop ${loop} of ${change} is still running; finish it with pnpm change build ${change}`;
	const ended = record.state.outcome;
	if (ended.status !== "completed") return `change loop ${loop} of ${change} ended ${ended.status}, not converged; build it again with pnpm change build ${change}`;
	const { outcome } = readChangeResult(ended.result, loop);
	switch (outcome.status) {
		case "converged":
			return undefined;
		case "blocked":
			return `the build of ${change} is waiting for an answer (change loop ${loop}):\n${outcome.escalation.question}\nanswer: pnpm change build ${change} "<answer>"`;
		default:
			return `change loop ${loop} of ${change} ended ${outcome.status}, not converged; build it again with pnpm change build ${change}`;
	}
}

/**
 * The trial fold: passed with both steps' output, or the failing step (`openspec`'s arguments),
 * its exit code and its output.
 */
export type TrialFoldResult =
	| { readonly ok: true; readonly output: string }
	| { readonly ok: false; readonly step: string; readonly exitCode: number; readonly output: string };

/**
 * Fold `change` into a temporary copy of `<root>/openspec` and validate the specs there:
 * `openspec archive <change> --yes`, then `openspec validate --specs --strict`, each with
 * `OPENSPEC_TELEMETRY=0`; the first non-zero exit fails it. Prints nothing, leaves `<root>`
 * untouched and always removes the copy.
 */
export async function trialFold(change: string, root: string): Promise<TrialFoldResult> {
	const trial = mkdtempSync(join(tmpdir(), "close-"));
	try {
		cpSync(join(root, "openspec"), join(trial, "openspec"), { recursive: true });
		const run = guardRun(trial);
		let output = "";
		for (const args of [["archive", change, "--yes"], ["validate", "--specs", "--strict"]]) {
			const ran = await run(["env", "OPENSPEC_TELEMETRY=0", "openspec", ...args]);
			if (ran.exitCode !== 0) return { ok: false, step: args.join(" "), exitCode: ran.exitCode, output: ran.output };
			output += ran.output;
		}
		return { ok: true, output };
	} finally {
		rmSync(trial, { recursive: true, force: true });
	}
}

/** Every capability the change has a delta for, in path order, as it stands before the fold. */
function capabilitiesOf(request: CloseRequest): ClosedCapability[] {
	const specs = join(request.changeDir, "specs");
	if (!existsSync(specs)) return [];
	const deltas = readdirSync(specs, { recursive: true, encoding: "utf8" })
		.filter((path) => path === "spec.md" || path.endsWith(`${sep}spec.md`))
		.map((path) => dirname(path))
		.filter((dir) => dir !== ".")
		.sort();
	return deltas.map((dir) => {
		const capability = dir.split(sep).join("/");
		const delta = readFileSync(join(specs, dir, "spec.md"), "utf8");
		return {
			capability,
			created: !existsSync(join(request.workspace, "openspec", "specs", dir, "spec.md")),
			requirements: delta.match(/^### Requirement:/gm)?.length ?? 0,
		};
	});
}

/** The archived directories of `change`, `<date>-<change>`, in name (so date) order. */
function archived(archiveDir: string, change: string): string[] {
	if (!existsSync(archiveDir)) return [];
	const name = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${change.replace(/[.]/g, "\\.")}$`);
	return readdirSync(archiveDir).filter((entry) => name.test(entry)).sort();
}

const tail = (output: string) => (output.length > OUTPUT_LIMIT ? `…${output.slice(-OUTPUT_LIMIT)}` : output).trimEnd();
