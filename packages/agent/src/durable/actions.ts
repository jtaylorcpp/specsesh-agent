/**
 * Host actions: what an Agent Script `mcpTool://<name>` target resolves to.
 *
 * A host action is a name, a kind (matching the ontology's Action kinds, plus
 * `read`), typed scalar inputs and outputs, a replay policy and an executor. The
 * registry maps names to them. A script's action definitions are checked against
 * it whole, when a run is created, so a script that names a tool the host does
 * not provide, or declares it with other inputs or outputs, never starts.
 */

import { declaredActions, type ActionResult, type VariableValue } from "../interpreter/index.js";
import { isGrantedDelegate } from "./delegate-brand.js";

/** The scalar types an action's inputs and outputs carry, like a script variable's. */
export type ActionParameterType = "string" | "number" | "boolean";

/** What an executor gets besides its inputs. */
export interface ActionContext {
	/** The directory the action is confined to. */
	readonly workspace: string;
	readonly signal?: AbortSignal;
	/**
	 * How many calls of the named action the run has already reported: its `run`
	 * calls and its steps' tool calls. Read from the run's durable state, so a
	 * resumed run counts the same. Absent outside a run: none.
	 */
	readonly priorCalls?: (name: string) => number;
}

export interface HostAction {
	readonly name: string;
	/** `read` changes nothing; the rest are the ontology's Action kinds. */
	readonly kind: "read" | "edit" | "command" | "delegate";
	readonly inputs: Readonly<Record<string, ActionParameterType>>;
	readonly outputs: Readonly<Record<string, ActionParameterType>>;
	/**
	 * pi-durable's replay rule: on recovery an interrupted `safe` call runs again;
	 * an interrupted `unsafe` one is reported and never silently repeated.
	 */
	readonly replay: "safe" | "unsafe";
	execute(inputs: Readonly<Record<string, VariableValue>>, context: ActionContext): Promise<ActionResult>;
}

export type ActionRegistry = ReadonlyMap<string, HostAction>;

const DELEGATE_PREFIX = "delegate/";

/**
 * A registry keyed by name. Two actions with one name are refused, naming it, and
 * so is a `delegate/` name that `delegationActions` did not make.
 */
export function createActionRegistry(actions: readonly HostAction[]): ActionRegistry {
	const registry = new Map<string, HostAction>();
	for (const action of actions) {
		if (action.name.startsWith(DELEGATE_PREFIX) && !isGrantedDelegate(action)) {
			throw new Error(`action ${action.name}: the ${DELEGATE_PREFIX} namespace is reserved for granted delegates (delegationActions)`);
		}
		if (registry.has(action.name)) {
			throw new Error(`two host actions are named "${action.name}"; an action registry holds one per name`);
		}
		registry.set(action.name, action);
	}
	return registry;
}

/** One script action that does not match the registry, with every mismatch found. */
export interface ActionBindingProblem {
	readonly subagent: string;
	readonly action: string;
	readonly mismatches: readonly string[];
}

/** Raised when a run is created whose script actions do not match the host's registry. Nothing has run. */
export class ActionBindingError extends Error {
	readonly problems: readonly ActionBindingProblem[];

	constructor(problems: readonly ActionBindingProblem[]) {
		super(
			"the script's actions do not match what this host provides, so the run was not started:\n" +
				problems
					.map((p) => `  - subagent "${p.subagent}", action ${p.action}: ${p.mismatches.join("; ")}`)
					.join("\n"),
		);
		this.name = "ActionBindingError";
		this.problems = problems;
	}
}

/**
 * Check every action the script defines against the registry: its tool
 * registered, its input and output names exactly the registered ones, and each
 * type equal. Throws `ActionBindingError` naming every mismatch. An
 * unregistered `delegate/<name>` also lists the granted delegates; a grant the
 * script never targets is never a problem.
 */
export function checkBindings(source: string, registry: ActionRegistry): void {
	const problems: ActionBindingProblem[] = [];
	for (const declared of declaredActions(source)) {
		const host = registry.get(declared.tool);
		const mismatches: string[] = [];
		if (host === undefined) {
			mismatches.push(`mcpTool://${declared.tool} is not registered on this host${grantsNote(declared.tool, registry)}`);
		} else {
			mismatches.push(
				...compareParameters("input", declared.inputs, host.inputs),
				...compareParameters("output", declared.outputs, host.outputs),
			);
		}
		if (mismatches.length > 0) problems.push({ subagent: declared.subagent, action: declared.action, mismatches });
	}
	if (problems.length > 0) throw new ActionBindingError(problems);
}

/** For an unregistered `delegate/<name>`: the granted names, or that there are none. Empty for any other tool. */
function grantsNote(tool: string, registry: ActionRegistry): string {
	if (!tool.startsWith(DELEGATE_PREFIX)) return "";
	const granted = [...registry.keys()].filter((name) => name.startsWith(DELEGATE_PREFIX)).map((name) => name.slice(DELEGATE_PREFIX.length));
	return granted.length > 0 ? `; granted delegates: ${granted.join(", ")}` : "; no delegates are granted";
}

function compareParameters(
	what: "input" | "output",
	declared: Readonly<Record<string, string>>,
	registered: Readonly<Record<string, string>>,
): string[] {
	const mismatches: string[] = [];
	for (const [name, type] of Object.entries(declared)) {
		const expected = registered[name];
		if (expected === undefined) mismatches.push(`${what} ${name} is not one the host action has`);
		else if (expected !== type) mismatches.push(`${what} ${name} is declared ${type}, registered ${expected}`);
	}
	for (const name of Object.keys(registered)) {
		if (!(name in declared)) mismatches.push(`${what} ${name} of the host action is not declared`);
	}
	return mismatches;
}
