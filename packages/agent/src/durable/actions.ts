/**
 * Host actions: what an Agent Script `mcpTool://<name>` target resolves to.
 *
 * A host action is a name, a kind (matching the ontology's Action kinds, plus
 * `read`), typed scalar inputs and outputs, a replay policy and an executor. The
 * registry maps names to them. A script's action definitions are checked against
 * it whole, when a run is created, so a script that names a tool the host does
 * not provide, or declares it with other inputs or outputs, never starts.
 */

import type { TaskId, TaskOutcome } from "@earendil-works/pi-durable";
import { declaredActions, type ActionResult, type RunResult, type VariableValue } from "../interpreter/index.js";
import { isGrantedDelegate } from "./delegate-brand.js";
import type { RunInput } from "./extension.js";
import { actionRecord, type Workspace, type WorkspaceSnapshot } from "./workspace.js";

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

interface HostActionBase {
	readonly name: string;
	/** One line on what it does, for `specsesh agent actions`. */
	readonly description?: string;
	/** `read` changes nothing; the rest are the ontology's Action kinds. */
	readonly kind: "read" | "edit" | "command" | "delegate";
	readonly inputs: Readonly<Record<string, ActionParameterType>>;
	readonly outputs: Readonly<Record<string, ActionParameterType>>;
}

/** A host action that runs once, within the `act` phase or a step's tool call. */
export interface ExecutedHostAction extends HostActionBase {
	/**
	 * pi-durable's replay rule: on recovery an interrupted `safe` call runs again;
	 * an interrupted `unsafe` one is reported and never silently repeated.
	 */
	readonly replay: "safe" | "unsafe";
	execute(inputs: Readonly<Record<string, VariableValue>>, context: ActionContext): Promise<ActionResult>;
	readonly durable?: never;
}

/** What `finish` gets besides its inputs: the child's id and the workspace around it. */
export interface DurableFinishContext extends ActionContext {
	readonly child: TaskId<RunResult>;
	/** The workspace as the child was created; absent when the host cannot snapshot. */
	readonly before?: WorkspaceSnapshot;
	/** The workspace once the child settled; absent when the host cannot snapshot. */
	readonly after?: WorkspaceSnapshot;
}

/**
 * A host action that runs as a child `agentscript.run` task. `start` returns the
 * child's input, or a failed result and no child is created; `finish` maps the
 * settled child to the call's result. Its replay is always `safe`: a resumed call
 * waits for the child it stored, or creates it if none was stored.
 */
export interface DurableHostAction extends HostActionBase {
	readonly replay: "safe";
	readonly durable: {
		start(
			inputs: Readonly<Record<string, VariableValue>>,
			context: ActionContext,
		): Promise<RunInput | Extract<ActionResult, { ok: false }>>;
		finish(
			inputs: Readonly<Record<string, VariableValue>>,
			outcome: TaskOutcome<RunResult>,
			context: DurableFinishContext,
		): Promise<ActionResult>;
	};
	readonly execute?: never;
}

/** An executor or a durable pair, never both. */
export type HostAction = ExecutedHostAction | DurableHostAction;

export function isDurable(action: HostAction): action is DurableHostAction {
	return action.durable !== undefined;
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
 * script never targets is never a problem. With `scope`, a tool outside it is
 * refused before the registry is consulted; without it, every registered tool
 * is in scope. A durable action offered under `reasoning.actions` is refused:
 * it runs only as a `run` call. A tool in `optional` that is not registered is
 * no problem: the run hides it from model steps and answers its calls refused.
 */
export function checkBindings(
	source: string,
	registry: ActionRegistry,
	scope?: readonly string[],
	optional?: ReadonlySet<string>,
): void {
	const problems: ActionBindingProblem[] = [];
	for (const declared of declaredActions(source)) {
		const host = registry.get(declared.tool);
		const mismatches: string[] = [];
		if (scope !== undefined && !scope.includes(declared.tool)) {
			mismatches.push(`mcpTool://${declared.tool} is outside this run's scope (${scope.join(", ") || "empty"})`);
		} else if (host === undefined && optional?.has(declared.tool) === true) {
			continue;
		} else if (host === undefined) {
			mismatches.push(`mcpTool://${declared.tool} is not registered on this host${grantsNote(declared.tool, registry)}`);
		} else if (declared.offered && isDurable(host)) {
			mismatches.push(`${declared.tool} runs as a child task and cannot be offered under reasoning.actions: call it with run`);
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

export const NO_REMOVE = "this workspace cannot delete files";

/** What a call of an ungranted `delete_file` answers. */
export const DELETE_NOT_GRANTED = 'delete_file is not granted: set "deleteFiles": true under "task" in agentscript.config.json';

/** The targets a task script may name without the harness binding them, each with what a call answers. */
export const OPTIONAL_TARGETS: Readonly<Record<string, string>> = { delete_file: DELETE_NOT_GRANTED };

/**
 * `delete_file`, over `workspace.remove`. Never in `workspaceActions` or
 * `builtinActions`: a host grants it by adding this to its registry. A second
 * delete of one path is refused, so on recovery it is never run again.
 *
 *   delete_file { path } → { ok }    edit  unsafe
 */
export function deleteActions(workspace: Workspace): ExecutedHostAction[] {
	const deleteFileAction: ExecutedHostAction = {
		name: "delete_file",
		description: "delete one file in the workspace; granted only by the host",
		kind: "edit",
		inputs: { path: "string" },
		outputs: { ok: "boolean" },
		replay: "unsafe",
		async execute(inputs) {
			if (workspace.remove === undefined) return { ok: false, message: NO_REMOVE };
			const path = String(inputs["path"]);
			try {
				await workspace.remove(path);
			} catch (error) {
				// Every rejection is a refusal the agent hears, never a throw out of the loop.
				return { ok: false, message: `${error instanceof Error ? error.message : String(error)}; nothing was deleted` };
			}
			return {
				ok: true,
				outputs: { ok: true },
				record: actionRecord({ kind: "edit", summary: `delete_file ${path}`, refs: [path] }, [
					{ kind: "diff", files: [{ path, change: "deleted" }] },
				]),
			};
		},
	};

	return [deleteFileAction];
}
