/**
 * A change's `approvals.json`: the principal's approval of each spec stage,
 * with a sha256 of every file the stage owned when it was approved.
 *
 * Each entry is the ontology's `Approval` plus `stage`, `at` and `files`, and
 * the file is checked against its schema on every read, so a hand-edited entry
 * with `by: "agent"` refuses whatever reads it. Hashes, not git: the check works
 * in a dirty tree and outside a repository.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Approval, check, explain } from "../openspec/index.js";
import { closed } from "../openspec/schema.js";
import { ApprovalsFileError } from "./errors.js";
import type { SpecStage } from "./spec-stage.js";
import { SPEC_STAGES } from "./spec-stages.js";

export const APPROVALS_FILE = "approvals.json";

/**
 * The ontology's `Approval` plus `stage`, `at` and `files`. Only `src/openspec` imports
 * TypeBox, so the added fields are written as the plain JSON Schema a TypeBox schema is.
 */
export const ApprovalEntry = closed({
	...Approval.properties,
	stage: { type: "string", minLength: 1 },
	at: { type: "string", format: "date-time" },
	files: { type: "object", additionalProperties: { type: "string", pattern: "^[0-9a-f]{64}$" } },
});
export type ApprovalEntry = Approval & { stage: string; at: string; files: Record<string, string> };

export const ApprovalsFile = closed({ approvals: { type: "array", items: ApprovalEntry } });
export interface ApprovalsFile {
	approvals: ApprovalEntry[];
}

/** A stage as far as approvals need it: its name, its files, and the stages it follows. */
export type ApprovalStage = Pick<SpecStage, "name" | "owns" | "after">;

export interface StaleApproval {
	/** The stage in `after` that is unapproved or whose files changed. */
	readonly stage: string;
	/** The changed or missing file, relative to the change directory; absent when the stage has no entry. */
	readonly file?: string;
	readonly message: string;
}

/** A recorded file of an approved stage that no longer matches; `path` is relative to the change directory. */
export interface StaleFile {
	readonly stage: string;
	readonly path: string;
	readonly state: "changed" | "missing";
}

/** The change's approvals; none when `approvals.json` does not exist. Throws `ApprovalsFileError` when it is not valid. */
export function readApprovals(changeDir: string): ApprovalsFile {
	const path = join(changeDir, APPROVALS_FILE);
	if (!existsSync(path)) return { approvals: [] };
	return parseApprovals(readFileSync(path, "utf8"));
}

/** `approvals.json`'s text as an `ApprovalsFile`; throws `ApprovalsFileError` when it is not valid. */
function parseApprovals(text: string): ApprovalsFile {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		throw new ApprovalsFileError(`${APPROVALS_FILE} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!check(ApprovalsFile, value)) throw new ApprovalsFileError(`${APPROVALS_FILE} is not valid: ${explain(ApprovalsFile, value)[0]}`);
	return value as ApprovalsFile;
}

/**
 * The sha256 of every file the stage owns, by POSIX path relative to `changeDir`, in path order:
 * each owned file, and every file under an owned entry ending in "/". Missing ones are left out.
 * Raw bytes are hashed, so a binary file under an owned directory is compared exactly; only
 * `tasks.md` reads its ticks as unticked (`normaliseForHash`).
 */
export function hashOwnedFiles(stage: Pick<SpecStage, "owns">, changeDir: string): Record<string, string> {
	const found: Record<string, string> = {};
	const walk = (relative: string) => {
		const absolute = join(changeDir, relative);
		let stat;
		try {
			stat = statSync(absolute);
		} catch {
			return;
		}
		if (stat.isDirectory()) {
			for (const entry of readdirSync(absolute)) walk(relative === "" ? entry : `${relative}/${entry}`);
		} else if (stat.isFile()) found[relative] = sha256(changeDir, relative);
	};
	for (const entry of stage.owns) walk(entry.endsWith("/") ? entry.slice(0, -1) : entry);
	return Object.fromEntries(Object.entries(found).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Records the principal's approval of `stage`: hashes its owned files, replaces the stage's
 * earlier entry (in place, or appended), then drops the entry of every stage in `stages` that
 * follows it through `after`, directly or through others. The same inputs write the same bytes.
 */
export function recordApproval(
	changeDir: string,
	stage: ApprovalStage,
	approval: { principal: string; notes: string; at: string },
	stages: readonly ApprovalStage[],
): ApprovalEntry {
	const { approvals } = readApprovals(changeDir);
	const entry: ApprovalEntry = {
		stage: stage.name,
		approved: true,
		by: "principal",
		principal: approval.principal,
		notes: approval.notes,
		at: approval.at,
		files: hashOwnedFiles(stage, changeDir),
	};
	const at = approvals.findIndex((existing) => existing.stage === stage.name);
	const replaced = at === -1 ? [...approvals, entry] : approvals.map((existing, i) => (i === at ? entry : existing));
	const dropped = dependants(stage.name, stages);
	writeApprovals(changeDir, { approvals: replaced.filter((existing) => existing === entry || !dropped.has(existing.stage)) });
	return entry;
}

const SPEC_DELTA = /^specs\/(?:[^/]+\/)+spec\.md$/;

/**
 * Records an applied amendment: sets the sha256 of `delta` (a `specs/**\/spec.md` relative to
 * `changeDir`) in the specs approval to `amendment.sha256`, and that approval's `principal` and
 * `notes` to the amendment's. Every other byte of `approvals.json` stays as it was, `at` included.
 * Throws, writing nothing, when the delta is not a spec delta, the specs stage has no approval or
 * no entry for it, the file is not valid, or it is not as `recordApproval` writes it (so another
 * entry's bytes could change); a failed write throws too.
 */
export function recordSpecAmendment(
	changeDir: string,
	delta: string,
	amendment: { sha256: string; principal: string; notes: string },
): ApprovalEntry {
	if (!SPEC_DELTA.test(delta) || delta.split("/").includes("..")) {
		throw new ApprovalsFileError(`amendment delta "${delta}" is not specs/**/spec.md`);
	}
	const path = join(changeDir, APPROVALS_FILE);
	const text = existsSync(path) ? readFileSync(path, "utf8") : undefined;
	const file = text === undefined ? { approvals: [] } : parseApprovals(text);
	const entry = file.approvals.find((existing) => existing.stage === "specs");
	if (entry === undefined) throw new ApprovalsFileError(`the specs stage has no approval in ${APPROVALS_FILE}; ${delta} cannot be recorded`);
	if (!Object.hasOwn(entry.files, delta)) throw new ApprovalsFileError(`the specs approval in ${APPROVALS_FILE} has no entry for ${delta}`);
	if (serialise(file) !== text) throw new ApprovalsFileError(`${APPROVALS_FILE} is not as approve writes it; approve the specs stage again`);
	entry.files[delta] = amendment.sha256;
	entry.principal = amendment.principal;
	entry.notes = amendment.notes;
	writeApprovals(changeDir, file);
	return entry;
}

/** Checks `file` against the schema, then replaces `approvals.json` with it through a temporary file. */
function writeApprovals(changeDir: string, file: ApprovalsFile): void {
	if (!check(ApprovalsFile, file)) throw new ApprovalsFileError(`${APPROVALS_FILE} would not be valid: ${explain(ApprovalsFile, file)[0]}`);
	const path = join(changeDir, APPROVALS_FILE);
	const tmp = `${path}.${process.pid}.tmp`;
	try {
		writeFileSync(tmp, serialise(file));
		renameSync(tmp, path);
	} catch (error) {
		rmSync(tmp, { force: true });
		throw error;
	}
}

const serialise = (file: ApprovalsFile) => `${JSON.stringify(file, null, 2)}\n`;

/**
 * Why `stage` may not start yet: one item per stage in its `after` with no approval, and one per
 * recorded file of an approved stage that changed or is gone. Empty when it may start.
 * Throws `ApprovalsFileError` when `approvals.json` is not valid.
 */
export function staleApprovals(stage: ApprovalStage, changeDir: string): StaleApproval[] {
	const { approvals } = readApprovals(changeDir);
	const change = basename(changeDir);
	const stale: StaleApproval[] = [];
	for (const name of stage.after ?? []) {
		if (!approvals.some((existing) => existing.stage === name)) {
			stale.push({ stage: name, message: `the ${name} stage of ${change} is not approved; run it and approve it first` });
			continue;
		}
		for (const { path } of staleFilesOfStage(changeDir, approvals, name)) {
			stale.push({ stage: name, file: path, message: `${path} changed since the ${name} stage was approved; review it again` });
		}
	}
	return stale;
}

/**
 * Every recorded file of the stage's approval that no longer matches, in path order: `missing`
 * when no file is there any more, `changed` when its sha256 differs. Empty when the stage has no
 * entry. The one staleness rule: `staleApprovals`, and through it the draft, use it too.
 */
export function staleFilesOfStage(changeDir: string, approvals: readonly ApprovalEntry[], stage: string): StaleFile[] {
	const entry = approvals.find((existing) => existing.stage === stage);
	if (entry === undefined) return [];
	const stale: StaleFile[] = [];
	for (const [path, hash] of Object.entries(entry.files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
		const absolute = join(changeDir, path);
		if (!existsSync(absolute) || !statSync(absolute).isFile()) stale.push({ stage, path, state: "missing" });
		else if (sha256(changeDir, path) !== hash) stale.push({ stage, path, state: "changed" });
	}
	return stale;
}

/**
 * The stale files of every approved stage, stage by stage in `stages` order (default
 * `SPEC_STAGES`), each stage's in path order; a stage with no approval is skipped. Reads
 * `approvals.json` unless `approvals` is given, and writes nothing. Throws `ApprovalsFileError`
 * when it is not valid.
 */
export function listStaleApprovedFiles(
	changeDir: string,
	approvals: ApprovalsFile = readApprovals(changeDir),
	stages: readonly Pick<ApprovalStage, "name">[] = SPEC_STAGES,
): StaleFile[] {
	return stages.flatMap(({ name }) => staleFilesOfStage(changeDir, approvals.approvals, name));
}

/** Every stage that follows `name` through `after`, directly or through others. */
function dependants(name: string, stages: readonly ApprovalStage[]): Set<string> {
	const found = new Set<string>();
	const queue = [name];
	for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
		for (const stage of stages) {
			if (stage.after?.includes(next) && !found.has(stage.name)) {
				found.add(stage.name);
				queue.push(stage.name);
			}
		}
	}
	return found;
}

/** The sha256 of a file, by its path relative to `changeDir`, as `normaliseForHash` reads it. */
function sha256(changeDir: string, relative: string): string {
	return createHash("sha256").update(normaliseForHash(relative, readFileSync(join(changeDir, relative)))).digest("hex");
}

const TICKED = /^([ \t]*)- \[x\]/gm;

/**
 * The bytes a file is hashed as: `tasks.md` with each line's `- [x]` read as `- [ ]`, so ticking a
 * task is not a change to an approved file; every other file as it is. An unticked `tasks.md`
 * hashes as before, so approvals recorded earlier stay valid.
 */
function normaliseForHash(relative: string, bytes: Buffer): Buffer {
	if (relative !== "tasks.md") return bytes;
	return Buffer.from(bytes.toString("utf8").replace(TICKED, "$1- [ ]"), "utf8");
}
