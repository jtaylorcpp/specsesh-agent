/**
 * Delegation as a capability the user grants: one `delegate/<name>` host action
 * per grant, run by the grant's runner through the workspace it was given, on
 * the grant's terms alone. The script supplies only `instructions`; inside a
 * run that carries one, the run's delegate preamble goes before them.
 *
 *   delegate/<name>  { instructions } → { ok, summary, files_changed }  delegate  unsafe
 *
 * Every grant is checked before any action is built: `runner`, `maxCalls` and
 * `timeoutMs` here, every other key by the runner that declares it. No `node:`
 * import, and no runner: those live in `./node`.
 */

import type { Action, CheckEvidence, Evidence } from "../openspec/index.js";
import type { HostAction } from "./actions.js";
import type { AgentRunner } from "./agent-runner.js";
import { brandDelegate } from "./delegate-brand.js";
import { SPAWN_FAILED_EXIT_CODE, actionRecord, diffSnapshots, type ExecResult, type Workspace } from "./workspace.js";

/** What the user grants under a name: a runner, and the terms it runs on. */
export interface DelegateGrant {
	/** A key of the `runners` the grant is built with. */
	readonly runner: string;
	/** Calls per run. Defaults to 5. */
	readonly maxCalls?: number;
	/** Per call before the process is killed. Defaults to 15 minutes. */
	readonly timeoutMs?: number;
	/** The keys the runner declares in its `grantKeys`. */
	readonly [key: string]: unknown;
}

export type DelegateGrants = Readonly<Record<string, DelegateGrant>>;

/** A grant with every default filled in, and its name. */
export type DelegateTerms = {
	readonly name: string;
	readonly runner: string;
	readonly maxCalls: number;
	readonly timeoutMs: number;
} & Readonly<Record<string, unknown>>;

/** One grant key a runner accepts: `check` answers what is wrong with a value, or `undefined`. */
export interface GrantKey {
	check(value: unknown): string | undefined;
	readonly default?: unknown;
}

/** A runner that delegates by running one process in the workspace. */
export interface ProcessRunner {
	readonly kind: "process";
	/** Names the runner in messages, e.g. `Claude Code timed out after …`. */
	readonly label: string;
	/** The grant keys it accepts besides `runner`, `maxCalls` and `timeoutMs`. */
	readonly grantKeys: Readonly<Record<string, GrantKey>>;
	/** Builds the process from the terms alone; `instructions` reaches it only on `stdin`. */
	prepare(call: { readonly instructions: string; readonly terms: DelegateTerms; readonly workspace: Workspace }):
		| { readonly argv: readonly string[]; readonly stdin: string; readonly env: Readonly<Record<string, string>> }
		| { readonly error: string };
	read(exited: Extract<ExecResult, { kind: "exited" }>): { readonly ok: boolean; readonly summary: string };
}

export type Runners = Readonly<Record<string, ProcessRunner | AgentRunner>>;

/** A grant `delegationActions` refuses. Nothing was built. */
export class DelegateGrantError extends Error {
	readonly grant: string;
	readonly key: string;

	constructor(grant: string, key: string, problem: string) {
		super(`delegate grant "${grant}": ${key} ${problem}`);
		this.name = "DelegateGrantError";
		this.grant = grant;
		this.key = key;
	}
}

const NAME = /^[a-z][a-z0-9_]*$/;
const DEFAULT_MAX_CALLS = 5;
const DEFAULT_TIMEOUT_MS = 900_000;
const COMMON_KEYS = new Set(["runner", "maxCalls", "timeoutMs"]);

function positiveInteger(value: unknown): string | undefined {
	return Number.isInteger(value) && (value as number) > 0 ? undefined : `must be a positive integer, not ${JSON.stringify(value)}`;
}

/** Every grant's terms, in grant order. Throws `DelegateGrantError` at the first invalid one. */
export function validateGrants(grants: DelegateGrants, runners: Runners): DelegateTerms[] {
	return Object.entries(grants).map(([name, grant]) => validateGrant(name, grant, runners));
}

function validateGrant(name: string, grant: unknown, runners: Runners): DelegateTerms {
	if (!NAME.test(name)) throw new DelegateGrantError(name, "name", `must match ${NAME.source}`);
	const fields: Readonly<Record<string, unknown>> = typeof grant === "object" && grant !== null ? (grant as Record<string, unknown>) : {};
	const runnerName = fields["runner"];
	if (typeof runnerName !== "string") throw new DelegateGrantError(name, "runner", `must be a string, not ${JSON.stringify(runnerName)}`);
	const runner = Object.hasOwn(runners, runnerName) ? runners[runnerName] : undefined;
	if (runner === undefined) {
		const known = Object.keys(runners);
		throw new DelegateGrantError(
			name,
			"runner",
			`"${runnerName}" is not a known runner (${known.length > 0 ? `known: ${known.join(", ")}` : "no runners are given"})`,
		);
	}
	const terms: Record<string, unknown> = { name, runner: runnerName };
	for (const [key, fallback] of [["maxCalls", DEFAULT_MAX_CALLS], ["timeoutMs", DEFAULT_TIMEOUT_MS]] as const) {
		const value = fields[key];
		if (value === undefined) terms[key] = fallback;
		else {
			const problem = positiveInteger(value);
			if (problem !== undefined) throw new DelegateGrantError(name, key, problem);
			terms[key] = value;
		}
	}
	for (const [key, value] of Object.entries(fields)) {
		if (COMMON_KEYS.has(key) || value === undefined) continue;
		const declared = Object.hasOwn(runner.grantKeys, key) ? runner.grantKeys[key] : undefined;
		if (declared === undefined) {
			const accepted = [...COMMON_KEYS, ...Object.keys(runner.grantKeys).filter((k) => !COMMON_KEYS.has(k))];
			throw new DelegateGrantError(name, key, `is not a key the ${runnerName} runner accepts (accepted: ${accepted.join(", ")})`);
		}
		const problem = declared.check(value);
		if (problem !== undefined) throw new DelegateGrantError(name, key, problem);
		terms[key] = value;
	}
	for (const [key, declared] of Object.entries(runner.grantKeys)) {
		if (!(key in terms) && declared.default !== undefined) terms[key] = declared.default;
	}
	return terms as DelegateTerms;
}

/** The block appended to the delegate's stdin, so it knows the terms it runs on. */
function renderTerms(terms: DelegateTerms): string {
	const allow = Array.isArray(terms["allow"]) ? (terms["allow"] as unknown[]).map(String) : [];
	return [
		"Your terms for this delegation (set by the user; you cannot change them):",
		allow.length > 0 ? `- Shell: only commands whose first word is one of: ${allow.join(", ")}.` : "- Shell: none.",
		"- One command per Bash call. Chained or prefixed commands (cd … &&, ;, |) are denied; use the tool's own flags, e.g. pnpm -C <dir> or pnpm --filter <pkg>.",
		`- Time limit: ${terms.timeoutMs / 1000} seconds.`,
	].join("\n");
}

function firstLine(text: string): string {
	const line = text.trim().split("\n")[0] ?? "";
	return line.length > 200 ? `${line.slice(0, 197)}...` : line;
}

export interface DelegationOptions {
	/** The workspace every delegate runs and diffs in, and no other. */
	readonly workspace: Workspace;
	/** The runners grants name, by name. */
	readonly runners?: Runners;
}

/**
 * One `delegate/<name>` per process grant. Throws `DelegateGrantError`, building
 * nothing, if any grant is invalid. Agent grants are validated here but built by
 * their runner's `action`, against the harness's models and registry.
 */
export function delegationActions(grants: DelegateGrants = {}, options: DelegationOptions): HostAction[] {
	const { workspace } = options;
	const runners = options.runners ?? {};
	return validateGrants(grants, runners).flatMap((terms) => {
		const runner = runners[terms.runner];
		if (runner?.kind !== "process") return [];
		const name = `delegate/${terms.name}`;
		return [brandDelegate<HostAction>({
			name,
			kind: "delegate",
			inputs: { instructions: "string" },
			outputs: { ok: "boolean", summary: "string", files_changed: "number" },
			replay: "unsafe",
			async execute(inputs, context) {
				// Counted from the run's own reports, before anything starts.
				if ((context.priorCalls?.(name) ?? 0) >= terms.maxCalls) {
					return {
						ok: true,
						outputs: { ok: false, summary: `delegate ${terms.name} reached its limit of ${terms.maxCalls} calls in this run`, files_changed: -1 },
					};
				}
				if (workspace.exec === undefined) return { ok: false, message: "this workspace cannot run processes" };
				const instructions = String(inputs["instructions"]);
				// The run's preamble goes first, into the text that reaches stdin only; never into the terms.
				const preamble = context.delegatePreamble;
				const prepared = runner.prepare({
					instructions: preamble !== undefined ? `${preamble}\n\n${instructions}` : instructions,
					terms,
					workspace,
				});
				if ("error" in prepared) return { ok: false, message: prepared.error };
				const recorded: Action = { kind: "delegate", summary: firstLine(instructions), refs: [name] };
				const command = prepared.argv.join(" ");
				const before = await workspace.snapshot?.();
				const ran = await workspace.exec(prepared.argv, {
					stdin: `${prepared.stdin}\n\n${renderTerms(terms)}`,
					env: prepared.env,
					timeoutMs: terms.timeoutMs,
					...(context.signal !== undefined ? { signal: context.signal } : {}),
				});
				if (ran.kind === "timed-out") {
					return {
						ok: false,
						message: `${runner.label} timed out after ${terms.timeoutMs}ms`,
						record: actionRecord(recorded, [
							{ kind: "check", command, exitCode: -1, output: `${ran.stdout}${ran.stderr}\n(timed out after ${terms.timeoutMs}ms)` },
						]),
					};
				}
				if (ran.kind === "spawn-error") {
					return {
						ok: false,
						message: `${runner.label} could not start: ${ran.message}`,
						record: actionRecord(recorded, [
							{ kind: "check", command, exitCode: SPAWN_FAILED_EXIT_CODE, output: `(could not start: ${ran.message})` },
						]),
					};
				}
				const after = await workspace.snapshot?.();
				const { ok, summary } = runner.read(ran);
				const files = before !== undefined && after !== undefined ? diffSnapshots(before, after) : undefined;
				const check: CheckEvidence = { kind: "check", command, exitCode: ran.code, output: ran.stdout + ran.stderr };
				const evidence: Evidence[] = files !== undefined ? [{ kind: "diff", files }, check] : [check];
				return {
					ok: true,
					outputs: { ok, summary, files_changed: files?.length ?? -1 },
					record: actionRecord(recorded, evidence),
				};
			},
		})];
	});
}
