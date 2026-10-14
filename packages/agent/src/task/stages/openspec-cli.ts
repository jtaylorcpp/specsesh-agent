/**
 * The `openspec` CLI as a gate sees it: `validate --strict --json` as issues,
 * `show --json --deltas-only` as deltas. Each runs the workspace's resolved openspec
 * through `runOpenspec` (no shell, in the workspace, `OPENSPEC_TELEMETRY=0`). A command
 * that cannot run, or prints no JSON of the expected shape, is one `ERROR` naming the
 * command and ending with the openspec it ran, `(openspec 1.14.1 at <path>)`, or
 * `(openspec not found)`. No minimum version is enforced here: the CLI checks it up front.
 */

import { describeOpenspec, type OpenspecBin, resolveOpenspec, runOpenspec } from "../openspec-bin.js";
import type { StageIssue } from "../spec-stage.js";

/** One requirement-level delta, as `openspec show --json --deltas-only` (1.14.1) prints it. */
export type Delta = {
	spec: string;
	operation: "ADDED" | "MODIFIED" | "REMOVED" | "RENAMED";
	requirement: { name: string; text: string; scenarios: unknown[] };
};

/** `unusable(what)` is the `ERROR` for parsed JSON that lacks `what`. */
type Json = { ok: true; json: unknown; unusable: (what: string) => StageIssue } | { ok: false; issue: StageIssue };

const OUTPUT_LIMIT = 400;
const OPERATIONS: readonly string[] = ["ADDED", "MODIFIED", "REMOVED", "RENAMED"];
const LEVELS: readonly string[] = ["ERROR", "WARNING", "INFO"];

const error = (message: string): StageIssue => ({ level: "ERROR", path: ".", message });

/** The JSON document in `output`: all of it, or, when other text surrounds it, from a line-start `{` to a line-start `}`. */
function parse(output: string): unknown {
	try {
		return JSON.parse(output);
	} catch (error) {
		const start = output.search(/^\{/m);
		const end = output.lastIndexOf("\n}");
		if (start === -1 || end < start) throw error;
		return JSON.parse(output.slice(start, end + 2));
	}
}

/**
 * Run `openspec <args>` in `workspace` and parse its stdout. `bin` is the openspec to run
 * (null: none found); when absent, the workspace's is resolved. A non-zero exit is not a
 * failure in itself: `validate` exits 1 on issues and still prints its JSON.
 */
export async function runJson(workspace: string, args: readonly string[], bin?: OpenspecBin | null): Promise<Json> {
	const resolved = bin === undefined ? await resolveOpenspec(workspace) : bin;
	const command = `\`openspec ${args.join(" ")}\``;
	const ran = `(${describeOpenspec(resolved)})`;
	if (resolved === null) return { ok: false, issue: error(`${command} could not run ${ran}`) };
	const result = await runOpenspec(resolved, args, { cwd: workspace });
	if (result.code === null) {
		const detail = result.stderr.trim().slice(0, OUTPUT_LIMIT);
		return { ok: false, issue: error(`${command} could not run${detail === "" ? "" : `: ${detail}`} ${ran}`) };
	}
	try {
		return { ok: true, json: parse(result.stdout), unusable: (what) => error(`${command} printed JSON without ${what} ${ran}`) };
	} catch {
		return { ok: false, issue: error(`${command} printed no parseable JSON ${ran}`) };
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Every issue of `openspec validate <id> --strict --json`, at its own level and path. */
export async function openspecValidate(workspace: string, id: string, bin?: OpenspecBin | null): Promise<StageIssue[]> {
	const ran = await runJson(workspace, ["validate", id, "--strict", "--json"], bin);
	if (!ran.ok) return [ran.issue];
	if (!isRecord(ran.json) || !Array.isArray(ran.json["items"])) return [ran.unusable("an items array")];
	const issues: StageIssue[] = [];
	for (const item of ran.json["items"]) {
		if (!isRecord(item) || !Array.isArray(item["issues"])) return [ran.unusable("an issues array in each item")];
		for (const issue of item["issues"]) {
			const { level, path, message } = isRecord(issue) ? issue : ({} as Record<string, unknown>);
			if (typeof level !== "string" || !LEVELS.includes(level) || typeof path !== "string" || typeof message !== "string") {
				return [ran.unusable("a level, path and message in each issue")];
			}
			issues.push({ level: level as StageIssue["level"], path, message });
		}
	}
	return issues;
}

/**
 * The deltas of `openspec show <id> --json --deltas-only`, one per requirement. A RENAMED
 * delta has no requirement, only `rename: { from, to }`: it reads as the new name, no text
 * and no scenarios.
 */
export async function openspecDeltas(workspace: string, id: string, bin?: OpenspecBin | null): Promise<{ deltas: Delta[]; issues: StageIssue[] }> {
	const ran = await runJson(workspace, ["show", id, "--json", "--deltas-only"], bin);
	if (!ran.ok) return { deltas: [], issues: [ran.issue] };
	const shape = (what: string) => ({ deltas: [], issues: [ran.unusable(what)] });
	if (!isRecord(ran.json) || !Array.isArray(ran.json["deltas"])) return shape("a deltas array");
	const deltas: Delta[] = [];
	for (const entry of ran.json["deltas"]) {
		if (!isRecord(entry) || typeof entry["spec"] !== "string" || typeof entry["operation"] !== "string") return shape("a spec and operation in each delta");
		const operation = entry["operation"];
		if (!OPERATIONS.includes(operation)) return shape(`a known operation (${OPERATIONS.join(", ")}) in each delta`);
		const requirement = operation === "RENAMED" ? renamed(entry["rename"]) : requirementOf(entry["requirement"]);
		if (typeof requirement === "string") return shape(requirement);
		deltas.push({ spec: entry["spec"], operation: operation as Delta["operation"], requirement });
	}
	return { deltas, issues: [] };
}

/** The delta's requirement, or what it lacks. */
function requirementOf(value: unknown): Delta["requirement"] | string {
	if (!isRecord(value) || typeof value["name"] !== "string") return "requirement names";
	const { name, text, scenarios } = value;
	if (typeof text !== "string" || !Array.isArray(scenarios)) return "requirement text and scenarios";
	return { name, text, scenarios };
}

function renamed(value: unknown): Delta["requirement"] | string {
	if (!isRecord(value) || typeof value["to"] !== "string") return "a rename target in each RENAMED delta";
	return { name: value["to"], text: "", scenarios: [] };
}
