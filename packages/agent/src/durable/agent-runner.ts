/**
 * The `agent` runner: a granted delegate that is one of our own agents. Each
 * call runs the grant's script as a durable child `agentscript.run`, on the
 * harness model the grant names, in the caller's workspace, binding only the
 * grant's tools and taking at most `maxSteps` model steps.
 *
 *   delegate/<name>  { instructions } → { ok, summary, files_changed }  delegate  safe (durable)
 *
 * The delegate contract: the script declares `instructions` (string), seeded
 * with the call's, and `ok` (boolean) and `summary` (string), read back when
 * the child completes. Runtime-neutral: no `node:` import.
 */

import type { ModelRef } from "@earendil-works/pi-durable";
import { analyze } from "../authoring/index.js";
import { readDeclarations, readSubagents } from "../interpreter/compose.js";
import { declaredActions, start, type ActionResult, type RunResult } from "../interpreter/index.js";
import type { Action, Evidence } from "../openspec/index.js";
import type { ActionRegistry, DurableHostAction, HostAction } from "./actions.js";
import { brandDelegate } from "./delegate-brand.js";
import { DelegateGrantError, type DelegateTerms, type GrantKey } from "./delegation.js";
import { actionRecord, diffSnapshots } from "./workspace.js";

/** What an agent grant holds besides `runner`, `maxCalls` and `timeoutMs`. */
export interface AgentGrant {
	readonly runner: "agent";
	/** A key of the harness's models. */
	readonly model: string;
	/** Agent Script source keeping the delegate contract. */
	readonly script: string;
	/** The actions the child may bind. Defaults to `read_file`, `list_files`, `search_files`. */
	readonly tools?: readonly string[];
	/** Model steps per call. Defaults to 20. */
	readonly maxSteps?: number;
	readonly maxCalls?: number;
}

/** What building an agent delegate needs from the harness. */
export interface AgentRunnerContext {
	/** The harness's models, by name. */
	readonly models: Readonly<Record<string, ModelRef>>;
	/** The registry without agent delegates: the tools a grant may name. */
	readonly actions: ActionRegistry;
}

/** A runner that delegates by running an Agent Script as a durable child. */
export interface AgentRunner {
	readonly kind: "agent";
	/** The grant keys it accepts besides `runner`, `maxCalls` and `timeoutMs`. */
	readonly grantKeys: Readonly<Record<string, GrantKey>>;
	/** Check the terms against the harness and build `delegate/<name>`. Throws `DelegateGrantError`. */
	action(terms: DelegateTerms, context: AgentRunnerContext): DurableHostAction;
}

const DEFAULT_TOOLS: readonly string[] = Object.freeze(["read_file", "list_files", "search_files"]);
const DEFAULT_MAX_STEPS = 20;
const DELEGATE_PREFIX = "delegate/";

/** Seeded with the call's `instructions`. */
const SEEDED = { instructions: "string" } as const;
/** Read back when the child completes. */
const READ_BACK = { ok: "boolean", summary: "string" } as const;

const isString = (value: unknown): string | undefined =>
	typeof value === "string" ? undefined : `must be a string, not ${JSON.stringify(value)}`;

const GRANT_KEYS: Readonly<Record<string, GrantKey>> = {
	model: { check: isString },
	script: { check: isString },
	tools: {
		check: (value) =>
			Array.isArray(value) && value.every((item) => typeof item === "string")
				? undefined
				: `must be an array of strings, not ${JSON.stringify(value)}`,
		default: DEFAULT_TOOLS,
	},
	maxSteps: {
		check: (value) => (Number.isInteger(value) && (value as number) > 0 ? undefined : `must be a positive integer, not ${JSON.stringify(value)}`),
		default: DEFAULT_MAX_STEPS,
	},
};

const AGENT = Symbol("agentRunner");

/** Whether `agentRunner` built this action: the binding check refuses one under `reasoning.actions`. */
export function isAgentDelegate(action: HostAction): boolean {
	return Object.hasOwn(action, AGENT);
}

/** One line per missing or mistyped delegate-contract variable; empty when the script keeps it. */
export function delegateContractProblems(source: string): string[] {
	const declarations = readDeclarations(analyze(source).parsed);
	const problems: string[] = [];
	for (const [name, type] of Object.entries({ ...SEEDED, ...READ_BACK })) {
		const declared = declarations.get(name);
		if (declared === undefined) problems.push(`${name} is not declared; declare it as ${type}`);
		else if (declared.type !== type) problems.push(`${name} is declared ${declared.type}; the contract needs ${type}`);
	}
	return problems;
}

function firstLine(text: string): string {
	const line = text.trim().split("\n")[0] ?? "";
	return line.length > 200 ? `${line.slice(0, 197)}...` : line;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** The child's own failure: the run's last failed or cut-short step, or the task's error. */
function failureOf(outcome: Parameters<DurableHostAction["durable"]["finish"]>[1]): string | undefined {
	if (outcome.status !== "completed") {
		return outcome.status === "failed" ? outcome.error.message : `the child run ended ${outcome.status}`;
	}
	const result: RunResult = outcome.result;
	if (result.kind === "completed") return undefined;
	const last = result.steps.at(-1)?.outcome;
	if (last?.kind === "failed") return last.message;
	if (last?.kind === "cut-short") return `the child run was cut short after ${last.turns} turns`;
	return `the child run ended ${result.kind}`;
}

/** Check the grant against the harness. Returns the child's entry: every subagent, in source order. */
function check(terms: DelegateTerms, { models, actions }: AgentRunnerContext): string[] {
	const { name } = terms;
	for (const key of ["model", "script"] as const) {
		if (typeof terms[key] !== "string") throw new DelegateGrantError(name, key, "is required");
	}
	const model = terms["model"] as string;
	if (!Object.hasOwn(models, model)) {
		throw new DelegateGrantError(name, "model", `"${model}" is not one of the harness's models (${Object.keys(models).join(", ")})`);
	}
	const tools = terms["tools"] as readonly string[];
	for (const tool of tools) {
		if (tool.startsWith(DELEGATE_PREFIX)) throw new DelegateGrantError(name, "tools", `cannot include ${tool}: a delegate cannot delegate`);
		if (!actions.has(tool)) throw new DelegateGrantError(name, "tools", `${tool} is not registered on this host`);
	}
	const script = terms["script"] as string;
	let problems: string[];
	let entry: string[];
	try {
		problems = delegateContractProblems(script);
		entry = [...readSubagents(analyze(script).parsed).keys()];
		if (problems.length === 0) start(script, { entry });
	} catch (error) {
		throw new DelegateGrantError(name, "script", messageOf(error));
	}
	if (problems.length > 0) {
		throw new DelegateGrantError(name, "script", `breaks the delegate contract: ${problems.join("; ")}`);
	}
	const outside = declaredActions(script)
		.filter((declared) => !tools.includes(declared.tool))
		.map((declared) => `${declared.tool} (subagent "${declared.subagent}", action ${declared.action})`);
	if (outside.length > 0) {
		throw new DelegateGrantError(name, "script", `uses ${outside.join(", ")}, which ${outside.length === 1 ? "is" : "are"} not in its tools (${tools.join(", ")})`);
	}
	return entry;
}

/** The `agent` runner. A grant's terms come from `validateGrants`; `action` checks them against the harness. */
export function agentRunner(): AgentRunner {
	return {
		kind: "agent",
		grantKeys: GRANT_KEYS,
		action(terms, context) {
			const entry = check(terms, context);
			const { models } = context;
			const name = `${DELEGATE_PREFIX}${terms.name}`;
			const script = terms["script"] as string;
			const model = models[terms["model"] as string] as ModelRef;
			const scope = [...(terms["tools"] as readonly string[])];
			const maxSteps = terms["maxSteps"] as number;
			const action: DurableHostAction = {
				name,
				kind: "delegate",
				inputs: { instructions: "string" },
				outputs: { ok: "boolean", summary: "string", files_changed: "number" },
				replay: "safe",
				durable: {
					async start(inputs, ctx) {
						// Counted from the run's own reports, before a child is created.
						if ((ctx.priorCalls?.(name) ?? 0) >= terms.maxCalls) {
							return { ok: false, message: `delegate ${terms.name} reached its limit of ${terms.maxCalls} calls in this run` };
						}
						return {
							source: script,
							options: { entry, variables: { instructions: String(inputs["instructions"]) } },
							model,
							scope,
							maxSteps,
						};
					},
					async finish(_inputs, outcome, ctx): Promise<ActionResult> {
						const failure = failureOf(outcome);
						const variables = outcome.status === "completed" ? outcome.result.variables : {};
						const ok = failure === undefined && variables["ok"] === true;
						const summary = failure ?? String(variables["summary"] ?? "");
						const files = ctx.before !== undefined && ctx.after !== undefined ? diffSnapshots(ctx.before, ctx.after) : undefined;
						const recorded: Action = {
							kind: "delegate",
							summary: firstLine(summary) || `${name} answered no summary`,
							refs: [name, `run:${String(ctx.child)}`],
						};
						const evidence: Evidence[] = files !== undefined ? [{ kind: "diff", files }] : [];
						const record = actionRecord(recorded, evidence);
						if (!ok) return { ok: false, message: summary || `${name} answered ok false`, record };
						return { ok: true, outputs: { ok, summary, files_changed: files?.length ?? -1 }, record };
					},
				},
			};
			Object.defineProperty(action, AGENT, { value: true });
			return brandDelegate(action);
		},
	};
}
