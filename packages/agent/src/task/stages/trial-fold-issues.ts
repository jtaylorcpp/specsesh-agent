/**
 * The trial fold as the specs gate reads it: `trialFold`'s report on the folded
 * specs, each issue placed at the change's delta for that spec when there is one,
 * else at the spec in `openspec/specs/`. A fold that cannot run is one `ERROR`.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { trialFold } from "../cmd-close.js";
import { describeOpenspec, type OpenspecBin, resolveOpenspec } from "../openspec-bin.js";
import type { StageIssue } from "../spec-stage.js";

/** A gate issue whose `path` may be absent: a fold that cannot run is about no file. */
export type TrialFoldStageIssue = Omit<StageIssue, "path"> & { readonly path?: string };

const COMMAND = "openspec validate --specs --strict";

/** The spec ids, e.g. `spec/judge`, with a `spec.md` under `<workspace>/openspec/changes/<change>/specs/`; empty when there is none. */
async function deltaSpecs(workspace: string, change: string): Promise<Set<string>> {
	const root = join(workspace, "openspec", "changes", change, "specs");
	let entries: string[];
	try {
		entries = await readdir(root, { recursive: true });
	} catch {
		return new Set();
	}
	const ids = entries.map((entry) => entry.split(/[\\/]/)).filter((parts) => parts.length > 1 && parts.at(-1) === "spec.md");
	return new Set(ids.map((parts) => parts.slice(0, -1).join("/")));
}

/**
 * Fold `change` once with `bin` (null: none found; absent: `<workspace>`'s) and report each
 * `ERROR` or `WARNING` as `trial fold: <spec>: <message>`, at `specs/<spec>/spec.md` when the
 * change has a delta for the spec, else at `openspec/specs/<spec>/spec.md`. A `failure` is one
 * `ERROR` with no path, ending with the openspec that ran, e.g. `(openspec 1.14.1 at <path>)`.
 */
export async function trialFoldIssues(workspace: string, change: string, bin?: OpenspecBin | null): Promise<TrialFoldStageIssue[]> {
	const resolved = bin === undefined ? await resolveOpenspec(workspace) : bin;
	const fold = await trialFold(workspace, change, resolved);
	if (fold.failure !== undefined) return [{ level: "ERROR", message: `${COMMAND} could not run: ${fold.failure} (${describeOpenspec(resolved)})` }];
	const deltas = await deltaSpecs(workspace, change);
	return fold.issues
		.filter((issue) => issue.level === "ERROR" || issue.level === "WARNING")
		.map((issue) => ({
			level: issue.level,
			path: deltas.has(issue.spec) ? `specs/${issue.spec}/spec.md` : `openspec/specs/${issue.spec}/spec.md`,
			message: `trial fold: ${issue.spec}: ${issue.message}`,
		}));
}
