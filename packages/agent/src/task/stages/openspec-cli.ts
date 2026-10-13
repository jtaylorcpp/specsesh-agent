/**
 * The `openspec` CLI as a gate sees it: `validate --strict --json` as issues,
 * `show --json --deltas-only` as deltas. Each runs through `StageContext.run`
 * (no shell, in the workspace) with `OPENSPEC_TELEMETRY=0`. A command that
 * cannot run, or prints no JSON of the expected shape, is one `ERROR` naming it.
 */

import type { StageContext, StageIssue } from "../spec-stage.js";

type Run = StageContext["run"];

/** One requirement-level delta, as `openspec show --json --deltas-only` (1.14.1) prints it. */
export type Delta = {
	spec: string;
	operation: "ADDED" | "MODIFIED" | "REMOVED" | "RENAMED";
	requirement: { name: string; text: string; scenarios: unknown[] };
};

type Json = { ok: true; json: unknown; output: string } | { ok: false; issue: StageIssue };

/** `run` takes argv only and has no env option, so `env` sets telemetry off: still no shell. */
const TELEMETRY_OFF = ["env", "OPENSPEC_TELEMETRY=0"] as const;
const OUTPUT_LIMIT = 400;
const OPERATIONS: readonly string[] = ["ADDED", "MODIFIED", "REMOVED", "RENAMED"];
const LEVELS: readonly string[] = ["ERROR", "WARNING", "INFO"];

const failed = (subcommand: string, output: string): StageIssue => ({
	level: "ERROR",
	path: ".",
	message: `\`openspec ${subcommand}\` failed: ${output.slice(0, OUTPUT_LIMIT)}`,
});

/** The JSON document in `output`: all of it, or, when stderr surrounds it, from a line-start `{` to a line-start `}`. */
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
 * Run `openspec <args>` and parse what it prints. A non-zero exit is not a failure in
 * itself: `validate` exits 1 on issues and still prints its JSON.
 */
export async function runJson(run: Run, args: readonly string[]): Promise<Json> {
	const subcommand = args[0] ?? "";
	let output: string;
	try {
		output = (await run([...TELEMETRY_OFF, "openspec", ...args])).output;
	} catch (error) {
		return { ok: false, issue: failed(subcommand, error instanceof Error ? error.message : String(error)) };
	}
	if (output.trim() === "") return { ok: false, issue: failed(subcommand, "no output") };
	try {
		return { ok: true, json: parse(output), output };
	} catch {
		return { ok: false, issue: failed(subcommand, output) };
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Every issue of `openspec validate <id> --strict --json`, at its own level and path. */
export async function openspecValidate(run: Run, id: string): Promise<StageIssue[]> {
	const ran = await runJson(run, ["validate", id, "--strict", "--json"]);
	if (!ran.ok) return [ran.issue];
	const shape = () => [failed("validate", ran.output)];
	if (!isRecord(ran.json) || !Array.isArray(ran.json["items"])) return shape();
	const issues: StageIssue[] = [];
	for (const item of ran.json["items"]) {
		if (!isRecord(item) || !Array.isArray(item["issues"])) return shape();
		for (const issue of item["issues"]) {
			if (!isRecord(issue)) return shape();
			const { level, path, message } = issue;
			if (typeof level !== "string" || !LEVELS.includes(level) || typeof path !== "string" || typeof message !== "string") return shape();
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
export async function openspecDeltas(run: Run, id: string): Promise<{ deltas: Delta[]; issues: StageIssue[] }> {
	const ran = await runJson(run, ["show", id, "--json", "--deltas-only"]);
	if (!ran.ok) return { deltas: [], issues: [ran.issue] };
	const shape = () => ({ deltas: [], issues: [failed("show", ran.output)] });
	if (!isRecord(ran.json) || !Array.isArray(ran.json["deltas"])) return shape();
	const deltas: Delta[] = [];
	for (const entry of ran.json["deltas"]) {
		if (!isRecord(entry) || typeof entry["spec"] !== "string" || typeof entry["operation"] !== "string") return shape();
		const operation = entry["operation"];
		if (!OPERATIONS.includes(operation)) return shape();
		const requirement = operation === "RENAMED" ? renamed(entry["rename"]) : requirementOf(entry["requirement"]);
		if (requirement === undefined) return shape();
		deltas.push({ spec: entry["spec"], operation: operation as Delta["operation"], requirement });
	}
	return { deltas, issues: [] };
}

function requirementOf(value: unknown): Delta["requirement"] | undefined {
	if (!isRecord(value)) return undefined;
	const { name, text, scenarios } = value;
	if (typeof name !== "string" || typeof text !== "string" || !Array.isArray(scenarios)) return undefined;
	return { name, text, scenarios };
}

function renamed(value: unknown): Delta["requirement"] | undefined {
	if (!isRecord(value) || typeof value["to"] !== "string") return undefined;
	return { name: value["to"], text: "", scenarios: [] };
}
