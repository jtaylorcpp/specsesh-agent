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
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Approval, check, explain } from "../openspec/index.js";
import { closed } from "../openspec/schema.js";
import { ApprovalsFileError } from "./errors.js";
import type { SpecStage } from "./spec-stage.js";

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

/** The change's approvals; none when `approvals.json` does not exist. Throws `ApprovalsFileError` when it is not valid. */
export function readApprovals(changeDir: string): ApprovalsFile {
	const path = join(changeDir, APPROVALS_FILE);
	if (!existsSync(path)) return { approvals: [] };
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new ApprovalsFileError(`${APPROVALS_FILE} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!check(ApprovalsFile, value)) throw new ApprovalsFileError(`${APPROVALS_FILE} is not valid: ${explain(ApprovalsFile, value)[0]}`);
	return value as ApprovalsFile;
}

/**
 * The sha256 of every file the stage owns, by POSIX path relative to `changeDir`, in path order:
 * each owned file, and every file under an owned entry ending in "/". Missing ones are left out.
 * Raw bytes are hashed, so a binary file under an owned directory is compared exactly.
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
		} else if (stat.isFile()) found[relative] = sha256(absolute);
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
	const file: ApprovalsFile = { approvals: replaced.filter((existing) => existing === entry || !dropped.has(existing.stage)) };
	if (!check(ApprovalsFile, file)) throw new ApprovalsFileError(`${APPROVALS_FILE} would not be valid: ${explain(ApprovalsFile, file)[0]}`);
	const path = join(changeDir, APPROVALS_FILE);
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`);
	renameSync(tmp, path);
	return entry;
}

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
		const entry = approvals.find((existing) => existing.stage === name);
		if (entry === undefined) {
			stale.push({ stage: name, message: `the ${name} stage of ${change} is not approved; run it and approve it first` });
			continue;
		}
		for (const [file, hash] of Object.entries(entry.files)) {
			const absolute = join(changeDir, file);
			if (existsSync(absolute) && statSync(absolute).isFile() && sha256(absolute) === hash) continue;
			stale.push({ stage: name, file, message: `${file} changed since the ${name} stage was approved; review it again` });
		}
	}
	return stale;
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

function sha256(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}
