/**
 * An escalation's `Amendment { delta, text }`, applied by the principal: where it may be
 * written, how it reads as a diff, and the write that holds only if openspec accepts it.
 *
 *   target    openspec/changes/<change>/<delta>, delta a specs/**\/spec.md   else refused
 *   save      the file's bytes in memory, or that it does not exist
 *   write     text, creating the parent directories
 *   validate  openspec validate --all --strict                          else restore
 *   trial     close's trial fold                                        else restore
 *
 * A check passes on exit 0 with no `[ERROR]`, no `[WARNING]` and no `✗` item in its output.
 * The restore writes back the saved bytes, or deletes the file (and any directory the write
 * created) when there were none. Nothing here prints or answers a loop: the caller does both.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve, sep, win32 } from "node:path";
import { guardRun } from "./change-api.js";
import { formatTrialFold, trialFold } from "./cmd-close.js";

/** Lines of unchanged context around each hunk of `unifiedDiff`. */
const CONTEXT = 3;

export type AmendmentTarget = { readonly ok: true; readonly path: string } | { readonly ok: false; readonly message: string };

/**
 * Where `delta` is written: `<changesDir>/<change>/<delta>`, normalised. Refused when `delta` is
 * absolute, has a `..` segment, or is not a `spec.md` at least one directory under `specs/`.
 */
export function amendmentTarget(changesDir: string, change: string, delta: string): AmendmentTarget {
	const refused: AmendmentTarget = { ok: false, message: `amendment delta "${delta}" is not specs/**/spec.md` };
	if (posix.isAbsolute(delta) || win32.isAbsolute(delta)) return refused;
	if (delta.split(/[\\/]/).includes("..")) return refused;
	const normalised = posix.normalize(delta);
	const segments = normalised.split("/");
	if (segments.length < 3 || segments[0] !== "specs" || segments.at(-1) !== "spec.md") return refused;
	const path = join(changesDir, change, normalised);
	if (!resolve(path).startsWith(resolve(changesDir, change, "specs") + sep)) return refused;
	return { ok: true, path };
}

/**
 * A unified diff from `before` (`null`: the file does not exist) to `after`, headed
 * `--- <displayPath> (on disk)` and `+++ <displayPath> (amended)`, or `""` when the lines are
 * the same. Compares lines, so a change to the final newline alone shows no hunk.
 */
export function unifiedDiff(displayPath: string, before: string | null, after: string): string {
	const ops = lineDiff(lines(before ?? ""), lines(after));
	const changed = ops.flatMap((op, i) => (op.kind === " " ? [] : [i]));
	if (changed.length === 0) return "";
	const out = [`--- ${displayPath} (on disk)`, `+++ ${displayPath} (amended)`];
	let first = 0;
	while (first < changed.length) {
		let last = first;
		while (last + 1 < changed.length && changed[last + 1]! - changed[last]! <= 2 * CONTEXT) last++;
		const from = Math.max(0, changed[first]! - CONTEXT);
		const to = Math.min(ops.length, changed[last]! + CONTEXT + 1);
		const hunk = ops.slice(from, to);
		const oldCount = hunk.filter((op) => op.kind !== "+").length;
		const newCount = hunk.filter((op) => op.kind !== "-").length;
		const start = (line: number, count: number) => (count === 0 ? line : line + 1);
		out.push(`@@ -${start(ops[from]!.oldLine, oldCount)},${oldCount} +${start(ops[from]!.newLine, newCount)},${newCount} @@`);
		for (const op of hunk) out.push(`${op.kind}${op.text}`);
		first = last + 1;
	}
	return `${out.join("\n")}\n`;
}

type Op = { readonly kind: " " | "-" | "+"; readonly text: string; readonly oldLine: number; readonly newLine: number };

const lines = (text: string): string[] => (text === "" ? [] : text.replace(/\n$/, "").split("\n"));

/** The longest-common-subsequence edit script, deletions before insertions; each op holds the lines before it. */
function lineDiff(a: readonly string[], b: readonly string[]): Op[] {
	const width = b.length + 1;
	const common = new Uint32Array((a.length + 1) * width);
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			common[i * width + j] = a[i] === b[j] ? common[(i + 1) * width + j + 1]! + 1 : Math.max(common[(i + 1) * width + j]!, common[i * width + j + 1]!);
		}
	}
	const ops: Op[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length || j < b.length) {
		if (i < a.length && j < b.length && a[i] === b[j]) ops.push({ kind: " ", text: a[i]!, oldLine: i++, newLine: j++ });
		else if (j === b.length || (i < a.length && common[(i + 1) * width + j]! >= common[i * width + j + 1]!)) ops.push({ kind: "-", text: a[i]!, oldLine: i++, newLine: j });
		else ops.push({ kind: "+", text: b[j]!, oldLine: i, newLine: j++ });
	}
	return ops;
}

/** What one check ran: its exit code and its output, stdout then stderr. */
export interface CheckOutcome {
	readonly exitCode: number;
	readonly output: string;
}

export type AmendmentCheck = () => Promise<CheckOutcome>;

export interface ApplyAmendmentOptions {
	/** The file to write, as `amendmentTarget` resolved it. */
	readonly target: string;
	/** The whole new file. */
	readonly text: string;
	/** The change id, for the default trial fold. */
	readonly change: string;
	/** The repo root, where `openspec/` lives and `openspec` runs, for the default checks. */
	readonly root: string;
	/** Default: `openspec validate --all --strict` in `root`, with `OPENSPEC_TELEMETRY=0`. */
	readonly validate?: AmendmentCheck;
	/** Default: close's `trialFold(root, change)`. Runs only when `validate` passed. */
	readonly trialFold?: AmendmentCheck;
}

/** Passed with the checks' output, or failed with it and the path put back as it was. */
export type AmendmentResult =
	| { readonly passed: true; readonly output: string }
	| { readonly passed: false; readonly output: string; readonly restored: string };

/** Exit 0, and no error, warning or failed item in the output. */
export const checkPassed = (check: CheckOutcome): boolean =>
	check.exitCode === 0 && !/\[(ERROR|WARNING)\]/.test(check.output) && !/^\s*✗/m.test(check.output);

/**
 * Write `text` to `target`, then validate and trial-fold. On a failed check, or a thrown error
 * (rethrown afterwards), `target` gets back the exact bytes saved before the write, or is deleted
 * with any directory the write created. Answers no loop.
 */
export async function applyAmendment(options: ApplyAmendmentOptions): Promise<AmendmentResult> {
	const { target, text, change, root } = options;
	const validate = options.validate ?? (() => guardRun(root)(["env", "OPENSPEC_TELEMETRY=0", "openspec", "validate", "--all", "--strict"]));
	const fold = options.trialFold ?? (async () => {
		// A reported warning fails an amendment even on exit 0.
		const trial = await trialFold(root, change);
		const clean = trial.ok && trial.issues.length === 0;
		return { exitCode: clean ? 0 : trial.exit || 1, output: clean ? "" : formatTrialFold({ ...trial, ok: false }) };
	});

	const saved = savedBytes(target);
	let created: string | undefined;
	let output = "";
	let passed = false;
	try {
		created = mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, text);
		const validated = await validate();
		output += validated.output;
		if (checkPassed(validated)) {
			const folded = await fold();
			output += folded.output;
			passed = checkPassed(folded);
		}
	} finally {
		if (!passed) restore(target, saved, created);
	}
	return passed ? { passed: true, output } : { passed: false, output, restored: target };
}

/** The file's bytes, or `null` when it does not exist; any other read error is thrown before the write. */
function savedBytes(path: string): Buffer | null {
	try {
		return readFileSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

function restore(path: string, saved: Buffer | null, created: string | undefined): void {
	if (saved !== null) {
		writeFileSync(path, saved);
		return;
	}
	rmSync(path, { force: true });
	if (created !== undefined) rmSync(created, { recursive: true, force: true });
}
