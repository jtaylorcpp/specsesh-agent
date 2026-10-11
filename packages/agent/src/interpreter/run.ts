/**
 * The runner: state, steps, outcomes.
 *
 * A run is a sequence of reasoning steps over ONE piece of state the interpreter
 * holds. The port is stateless by contract — every step carries its own system
 * instructions and its own composed prompt in full, and nothing is assumed to
 * have been retained from the step before. Variable state is what a `set` means
 * in this language, so it belongs to the interpreter; pushing it into the
 * boundary would make the smallest and most replaceable part of the design the
 * one holding the run together.
 *
 * Everything that can refuse, refuses BEFORE the first dispatch: the missing
 * port, the unsupported construct, the undeclared variable. A run that gets as
 * far as a model call has already been checked whole.
 *
 * This file writes no files and imports nothing that could. A run therefore
 * cannot edit the author's script as a side effect; `persistVariables` returns
 * the rewritten TEXT and leaves what to do with it to the caller.
 */

import { analyze } from "../authoring/document.js";
import { type Node, type Range, documentRoot, formatPosition, isNode } from "./ast.js";
import { actionReference, readActionDefinitions, runClauses, toolName } from "./actions.js";
import {
	type DeclaredVariable,
	type PendingAssignment,
	type ToolAssignment,
	type VariableValue,
	collectUndeclaredReferences,
	compose,
	composeToolOffers,
	evaluateRunInputs,
	outputAssignments,
	outputSchemaFor,
	procedureStatements,
	readDeclarations,
	readSubagents,
	readSystemInstructions,
	statementAt,
} from "./compose.js";
import {
	NoReasoningPortError,
	type ReasoningPort,
	type ReasoningRequest,
	type StepOutcome,
	isFailureCategory,
	toFailureCategory,
} from "./port.js";
import { UnsupportedConstructError, scanDocument } from "./scan.js";
import { BOOLEAN_LITERALS } from "./subset.js";

export interface RunOptions {
	/**
	 * The injected boundary. Optional in the TYPE and required in FACT, because a
	 * caller who forgets it must get `NoReasoningPortError` rather than a
	 * compile-time nudge that a JavaScript consumer never sees.
	 */
	readonly port?: ReasoningPort;
	/**
	 * Which subagent, or subagents in order, to run. Defaults to the FIRST the
	 * document declares — so a document with an unsupported construct in a later
	 * subagent is one the run would never enter, and is still refused up front.
	 */
	readonly entry?: string | readonly string[];
	/** Starting values overriding the authored ones. Every name must be declared. */
	readonly variables?: Readonly<Record<string, VariableValue>>;
	/**
	 * Ask for the document text rewritten with the run's final values. Off by
	 * default: running an agent does not silently edit the author's script.
	 */
	readonly persistVariables?: boolean;
	/**
	 * Runs each action call a `run` statement makes, in the host's workspace. Required
	 * when an entry subagent runs an action, and refused up front when missing. A
	 * throw becomes a failed result carrying its message.
	 */
	readonly actionHost?: (call: ActionCall) => Promise<ActionResult> | ActionResult;
}

/** One action call a `run` statement makes, with its inputs evaluated where the walk reached it. */
export interface ActionCall {
	readonly subagent: string;
	/** The action's name in the subagent's `actions:` block. */
	readonly action: string;
	/** The host tool its `mcpTool://` target names. */
	readonly tool: string;
	readonly inputs: Readonly<Record<string, VariableValue>>;
	/** The `run` statement's pre-order position in the procedure; the walk resumes after it. */
	readonly index: number;
}

/**
 * What the host answers for one call. `record` is opaque JSON the host attaches
 * (an ontology Action and its evidence), kept as given.
 */
export type ActionResult =
	| { readonly ok: true; readonly outputs: Readonly<Record<string, VariableValue>>; readonly record?: unknown }
	| { readonly ok: false; readonly message: string; readonly record?: unknown };

/** One action call and how it ended. Never a step: it never reached a model. */
export interface ActionReport {
	readonly subagent: string;
	readonly call: ActionCall;
	readonly result: ActionResult;
}

/** What one step asked for and what came back. */
export interface StepReport {
	readonly subagent: string;
	readonly request: ReasoningRequest;
	readonly outcome: StepOutcome;
}

export interface RunResult {
	/** How the run ended, taken from its last step. Answered runs are `completed`. */
	readonly kind: "completed" | "cut-short" | "failed";
	readonly steps: readonly StepReport[];
	/** Every action call the run made, in order. */
	readonly actions: readonly ActionReport[];
	readonly variables: Readonly<Record<string, VariableValue>>;
	/** Present only when `persistVariables` was asked for. */
	readonly updatedSource?: string;
}

/** Raised when `entry` names a subagent the document does not declare. */
export class UnknownSubagentError extends Error {
	constructor(name: string, declared: readonly string[]) {
		super(
			`the document declares no subagent named "${name}". Declared: ` +
				(declared.length > 0 ? declared.join(", ") : "(none)"),
		);
		this.name = "UnknownSubagentError";
	}
}

/**
 * Raised when the document could not be parsed far enough to have a root.
 *
 * Explicit because the alternative is a run that dispatches nothing, reports
 * `completed` and looks exactly like a document with no work in it.
 */
export class UnreadableDocumentError extends Error {
	constructor() {
		super(
			"the document could not be parsed into anything runnable. Nothing was dispatched. " +
				"Analyse it through the authoring surface to see what the parser objected to.",
		);
		this.name = "UnreadableDocumentError";
	}
}

/**
 * Raised when the document carries error-severity diagnostics.
 *
 * The parser is error-TOLERANT by design — it recovers and hands back a tree —
 * so a document with an unterminated string still parses into something the
 * subset scan finds nothing wrong with. What the scan cannot see is what the
 * recovery swallowed: `set @variables.stage = "unterminated` ran to
 * `completed` with `stage` holding a value nobody wrote, because the recovery
 * ate the rest of the line and the runner never read the diagnostics it had
 * already computed.
 *
 * Errors only. A warning or a hint (an unused variable, a deprecation) is not a
 * reason to refuse to run a document.
 */
export class UnparsedDocumentError extends Error {
	readonly diagnostics: readonly DocumentDiagnostic[];

	constructor(diagnostics: readonly DocumentDiagnostic[]) {
		super(
			`the document has ${diagnostics.length} error(s) and was not run. Nothing was dispatched:\n` +
				diagnostics.map((d) => `  - ${describeDiagnostic(d)}`).join("\n") +
				"\nThe parser recovers from these rather than throwing, so running anyway would " +
				"execute whatever the recovery invented in their place.",
		);
		this.name = "UnparsedDocumentError";
		this.diagnostics = diagnostics;
	}
}

/** The parts of an upstream diagnostic this runtime reads. */
interface DocumentDiagnostic {
	readonly message: string;
	readonly severity?: number;
	readonly range?: Range;
}

/** LSP severity 1. The authoring surface's diagnostics carry the LSP scale. */
const ERROR_SEVERITY = 1;

function describeDiagnostic(diagnostic: DocumentDiagnostic): string {
	const range = diagnostic.range;
	const at = range === undefined ? "at an unreported position" : `at ${formatPosition(range)}`;
	return `${diagnostic.message} ${at}`;
}

/**
 * Raised when a run would dispatch nothing at all.
 *
 * `UnreadableDocumentError` exists because a run that dispatches nothing,
 * reports `completed` and looks exactly like a document with no work in it is
 * unacceptable. A document with no subagent — or an `entry: []` — is that same
 * failure one branch over.
 */
export class NoEntrySubagentError extends Error {
	constructor(declared: readonly string[]) {
		super(
			"the run would enter no subagent, so nothing would be dispatched and the result would " +
				`be indistinguishable from a document with no work in it. Declared: ${
					declared.length > 0 ? declared.join(", ") : "(none)"
				}.`,
		);
		this.name = "NoEntrySubagentError";
	}
}

/**
 * Raised when a step would ask the model nothing and expect an answer back.
 *
 * A subagent whose prompt lines all sit behind conditions that did not hold,
 * but which still carries `set @variables.x = @outputs.y`, composes to an empty
 * prompt WITH a schema. Dispatching it asks the model literally nothing and
 * pays for the answer — the exact cost the empty-prompt skip exists to avoid,
 * and the schema is what stops that skip from catching it.
 */
export class EmptyPromptError extends Error {
	constructor(subagent: string, fields: readonly string[]) {
		super(
			`subagent "${subagent}" composed an empty prompt but asks the step for ` +
				`${fields.join(", ")}. Nothing was dispatched: a step with no prompt and a required ` +
				"structured result asks the model nothing and bills for the answer. Either the prompt " +
				"lines are behind a condition that did not hold, or the subagent is all logic and the " +
				"`set` from @outputs does not belong in it.",
		);
		this.name = "EmptyPromptError";
	}
}

/** Raised when a caller seeds a name the document never declared. */
export class UndeclaredOverrideError extends Error {
	constructor(name: string, declared: readonly string[]) {
		super(
			`the run was given a starting value for "${name}", which the document does not declare. ` +
				`Declared: ${declared.length > 0 ? declared.join(", ") : "(none)"}. It is not created ` +
				"on the caller's say-so: the document is where a variable comes into existence.",
		);
		this.name = "UndeclaredOverrideError";
	}
}

/** Raised by `run()` when an entry subagent runs an action and no `actionHost` was given. */
export class NoActionHostError extends Error {
	constructor(subagents: readonly string[]) {
		super(
			`subagent(s) ${subagents.join(", ")} run actions, and run() was given no actionHost to run ` +
				"them. Nothing was dispatched. This package executes no action itself: the host does.",
		);
		this.name = "NoActionHostError";
	}
}

/**
 * The run's state between steps, as plain JSON.
 *
 * This is what lets a run outlive a process: a durable host saves it after every
 * `next` and `apply`, and a restarted host carries on from it. Everything the
 * runner knows between steps is in here and nowhere else.
 */
export interface RunState {
	readonly version: 1;
	/** Fingerprint of the source the state was started on; `next`/`apply` refuse any other. */
	readonly sourceHash: string;
	/** The subagents to run, in order, resolved at `start`. */
	readonly entries: readonly string[];
	/** Index into `entries` of the subagent to compose next. */
	readonly cursor: number;
	readonly variables: Readonly<Record<string, VariableValue>>;
	readonly steps: readonly StepReport[];
	/** Every action call folded in so far, in order. */
	readonly actions: readonly ActionReport[];
	/** Set once a step ends cut short or failed, or an action call fails; the run is then over. */
	readonly stopped?: "cut-short" | "failed";
	/**
	 * A step composed but not answered, or an action call not yet run. Composition
	 * may already have run logic lines, so the variables they produced travel with
	 * it and are only committed by `apply` or `applyAction`.
	 */
	readonly awaiting?: AwaitingStep | AwaitingAction;
	/**
	 * Set by `applyAction` after a call succeeds: the subagent at `cursor` is part
	 * way through its walk, and `next` resumes it after the `run` at `index`.
	 */
	readonly resume?: ResumePoint;
}

/** Where a deterministic subagent's walk continues after a finished call. */
export interface ResumePoint {
	readonly subagent: string;
	readonly index: number;
	/** Variables before the subagent began; a later failed call rolls back to these. */
	readonly before: Readonly<Record<string, VariableValue>>;
}

/** An action call produced by `next` and not yet answered by the host. */
export interface AwaitingAction {
	readonly subagent: string;
	readonly call: ActionCall;
	/** Variables when the walk reached the `run`; outputs are applied on top of these. */
	readonly variables: Readonly<Record<string, VariableValue>>;
	/** Variables before this subagent began. A failed call rolls back to these. */
	readonly before: Readonly<Record<string, VariableValue>>;
}

export interface AwaitingStep {
	readonly subagent: string;
	readonly request: ReasoningRequest;
	readonly pending: readonly PendingAssignment[];
	/** Variables after this step's own logic lines ran; committed only if it answers. */
	readonly variables: Readonly<Record<string, VariableValue>>;
	/**
	 * Variables before this step's own logic lines, but after any logic-only
	 * subagents `next` ran on the way here. Those finished; a failure rolls back
	 * to this, not to the state `next` started from.
	 */
	readonly before: Readonly<Record<string, VariableValue>>;
	/** `set`s under reasoning-action entries, waiting on the last call to their tool. */
	readonly toolAssignments?: readonly ToolAssignment[];
}

/** What `next` decided: a request to answer, an action call to run, or the run's result. */
export type NextStep =
	| { readonly type: "request"; readonly request: ReasoningRequest; readonly state: RunState }
	| { readonly type: "action"; readonly call: ActionCall; readonly state: RunState }
	| { readonly type: "done"; readonly result: RunResult };

export interface StartOptions {
	readonly entry?: string | readonly string[];
	readonly variables?: Readonly<Record<string, VariableValue>>;
}

/** Raised when a state is used with a different source than it was started on. */
export class SourceMismatchError extends Error {
	constructor() {
		super(
			"this run state was started on a different document. A state is only valid with the " +
				"exact source it was started on; a changed script means a new run.",
		);
		this.name = "SourceMismatchError";
	}
}

/** Raised when `apply` is called with no step awaiting an answer, or `next` while one is. */
export class RunStateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RunStateError";
	}
}

/** Everything read from the source, re-derived on every call so the state stays small. */
interface Program {
	readonly declarations: ReadonlyMap<string, DeclaredVariable>;
	readonly subagents: ReturnType<typeof readSubagents>;
	readonly systemInstructions: string;
}

/**
 * Parse and check the whole document. Every refusal happens here, before
 * anything is dispatched: lint errors, an unreadable tree, an unsupported
 * construct, an undeclared reference.
 */
function load(source: string): Program {
	// ONE analysis, and both halves of it are read. Taking `.parsed` and dropping
	// `.diagnostics` is what let a document with a hard syntax error execute: the
	// scan walks the RECOVERED tree, so everything the recovery swallowed is
	// invisible to it, and the runner was the only place in the package holding
	// the answer.
	const analysis = analyze(source);
	const errors = (analysis.diagnostics as readonly DocumentDiagnostic[]).filter(
		(d) => d.severity === ERROR_SEVERITY,
	);
	if (errors.length > 0) throw new UnparsedDocumentError(errors);

	const parsed = analysis.parsed;
	if (documentRoot(parsed) === undefined) throw new UnreadableDocumentError();

	// Whole-document, before anything dispatches. See scan.ts on why up front.
	const unsupported = scanDocument(parsed);
	if (unsupported.length > 0) throw new UnsupportedConstructError(unsupported);

	const declarations = readDeclarations(parsed);
	const undeclared = collectUndeclaredReferences(parsed, new Set(declarations.keys()));
	if (undeclared[0] !== undefined) throw undeclared[0];

	return { declarations, subagents: readSubagents(parsed), systemInstructions: readSystemInstructions(parsed) };
}

function loadFor(source: string, state: RunState): Program {
	if (state.version !== 1 || state.sourceHash !== hashSource(source)) throw new SourceMismatchError();
	return load(source);
}

/** Validate the document and the caller's choices, and return the run's first state. */
export function start(source: string, options: StartOptions = {}): RunState {
	const { declarations, subagents } = load(source);

	const variables: Record<string, VariableValue> = {};
	for (const [name, declared] of declarations) variables[name] = declared.initial;
	for (const [name, value] of Object.entries(options.variables ?? {})) {
		if (!declarations.has(name)) {
			throw new UndeclaredOverrideError(name, [...declarations.keys()]);
		}
		variables[name] = value;
	}

	const entries = resolveEntries(options.entry, subagents);
	if (entries.length === 0) throw new NoEntrySubagentError([...subagents.keys()]);
	// Checked whole, up front, like everything else that can refuse.
	for (const name of entries) {
		if (!subagents.has(name)) throw new UnknownSubagentError(name, [...subagents.keys()]);
	}

	return { version: 1, sourceHash: hashSource(source), entries, cursor: 0, variables, steps: [], actions: [] };
}

/**
 * Compose the next request, or finish.
 *
 * Pure: the same state always yields the same request, so a host that crashed
 * after `next` and before `apply` can call it again and dispatch the same step.
 * A subagent made only of logic lines runs here, deterministically, and the run
 * moves on without asking the model anything.
 */
export function next(source: string, state: RunState, options: { persistVariables?: boolean } = {}): NextStep {
	const program = loadFor(source, state);
	if (state.awaiting !== undefined) {
		if (isAwaitingAction(state.awaiting)) return { type: "action", call: state.awaiting.call, state };
		return { type: "request", request: state.awaiting.request, state };
	}

	const variables = new Map(Object.entries(state.variables));
	let cursor = state.cursor;
	let resume = state.resume;
	let actions = state.actions ?? [];
	let stopped = state.stopped;
	while (stopped === undefined && cursor < state.entries.length) {
		const name = state.entries[cursor] as string;
		const block = program.subagents.get(name);
		if (block === undefined) throw new UnknownSubagentError(name, [...program.subagents.keys()]);

		const resuming = resume !== undefined && resume.subagent === name ? resume : undefined;
		resume = undefined;
		const before = resuming?.before ?? Object.fromEntries(variables);
		const statements = procedureStatements(block);
		const { prompt, pending, run: reached } = compose(statements, variables, resuming?.index);

		// The program acts here, not the model: stop at the call, with its inputs
		// evaluated against the variables as the walk left them.
		if (reached !== undefined) {
			const definition = actionDefinition(block, reached.node);
			const { inputs, problem } = evaluateRunInputs(reached.node, definition, variables);
			const call: ActionCall = {
				subagent: name,
				action: definition.name,
				tool: toolName(definition) ?? definition.name,
				inputs,
				index: reached.index,
			};
			if (problem !== undefined) {
				// Never sent to the host: a wrongly typed input is the script's fault.
				const message =
					`input "${problem.input}" of ${definition.name} is declared ${problem.declared} and was ` +
					`given a ${problem.actual}. The call was not made.`;
				actions = [...actions, { subagent: name, call, result: { ok: false, message } }];
				variables.clear();
				for (const [key, value] of Object.entries(before)) variables.set(key, value);
				stopped = "failed";
				break;
			}
			const awaiting: AwaitingAction = { subagent: name, call, variables: Object.fromEntries(variables), before };
			const { resume: _resume, ...rest } = state;
			return { type: "action", call, state: { ...rest, cursor, awaiting } };
		}

		// A subagent whose lines are all logic has already done its whole job, here,
		// deterministically. Dispatching an empty prompt would be asking the model
		// nothing and paying for the answer — and it is what makes "evaluating a
		// logic line makes no model turn" true rather than merely intended.
		if (prompt === "" && pending.length === 0) {
			cursor += 1;
			continue;
		}
		// The same cost, one branch over: an empty prompt that still asks for a
		// structured result is not skipped by the line above, and is refused here
		// rather than dispatched.
		if (prompt === "") throw new EmptyPromptError(name, pending.map((p) => p.field));

		// Built fresh every step: the port is told everything, every time.
		const { systemInstructions } = program;
		const { offers, assignments } = composeToolOffers(block, variables);
		const request: ReasoningRequest = {
			systemInstructions,
			prompt,
			...(pending.length > 0 ? { outputSchema: outputSchemaFor(pending, program.declarations) } : {}),
			...(offers.length > 0 ? { tools: offers } : {}),
		};
		const awaiting: AwaitingStep = {
			subagent: name,
			request,
			pending,
			variables: Object.fromEntries(variables),
			before,
			...(assignments.length > 0 ? { toolAssignments: assignments } : {}),
		};
		const { resume: _resume, ...rest } = state;
		return { type: "request", request, state: { ...rest, cursor, awaiting } };
	}

	const finalVariables = Object.fromEntries(variables);
	const result: RunResult = {
		kind: stopped ?? "completed",
		steps: state.steps,
		actions,
		variables: finalVariables,
	};
	if (options.persistVariables !== true) return { type: "done", result };
	return {
		type: "done",
		result: { ...result, updatedSource: rewrite(source, program.declarations, new Map(Object.entries(finalVariables))) },
	};
}

/** Fold the answer to the awaiting step into the state. */
export function apply(source: string, state: RunState, reported: StepOutcome): RunState {
	loadFor(source, state);
	const awaiting = state.awaiting;
	if (awaiting === undefined) throw new RunStateError("apply was called with no step awaiting an answer");
	if (isAwaitingAction(awaiting)) {
		throw new RunStateError("apply was called while an action call is awaiting; use applyAction");
	}

	const variables = new Map(Object.entries(awaiting.variables));
	const outcome = normalise(reported);
	const settled = settle(outcome, awaiting, variables);
	const steps = [...state.steps, { subagent: awaiting.subagent, request: awaiting.request, outcome: settled }];

	const { awaiting: _done, ...rest } = state;
	if (settled.kind !== "answered") {
		// The step's own logic-line effects are not committed: it did not finish.
		// Logic-only subagents that ran before it did finish, and are kept.
		return { ...rest, steps, stopped: settled.kind, variables: awaiting.before };
	}
	return { ...rest, steps, cursor: state.cursor + 1, variables: Object.fromEntries(variables) };
}

/**
 * Fold one action call's result into the state.
 *
 * A success stages the call's outputs into the `set`s beneath its `run` and
 * applies them together; the walk resumes after the `run` on the next `next`. A
 * failure, or outputs that do not supply every field the `set`s read, stops the
 * run and rolls back to the variables before the subagent began.
 */
export function applyAction(source: string, state: RunState, reported: ActionResult): RunState {
	const program = loadFor(source, state);
	const awaiting = state.awaiting;
	if (awaiting === undefined || !isAwaitingAction(awaiting)) {
		throw new RunStateError("applyAction was called with no action awaiting");
	}
	const { call } = awaiting;
	const block = program.subagents.get(awaiting.subagent);
	if (block === undefined) throw new UnknownSubagentError(awaiting.subagent, [...program.subagents.keys()]);
	const run = statementAt(procedureStatements(block), call.index);
	const assignments = run === undefined ? [] : outputAssignments(runClauses(run));

	let result = normaliseActionResult(reported);
	const staged = new Map<string, VariableValue>();
	if (result.ok) {
		const outputs = result.outputs as Readonly<Record<string, unknown>>;
		for (const assignment of assignments) {
			const value = outputs[assignment.field];
			if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
				result = {
					ok: false,
					message:
						`${call.action} answered with no usable output "${assignment.field}" for ` +
						`@variables.${assignment.variable}. No variable was set from it.`,
					...("record" in result ? { record: result.record } : {}),
				};
				break;
			}
			staged.set(assignment.variable, value);
		}
	}

	const actions = [...(state.actions ?? []), { subagent: awaiting.subagent, call, result }];
	const { awaiting: _done, resume: _resume, ...rest } = state;
	if (!result.ok) {
		return { ...rest, actions, stopped: "failed", variables: awaiting.before };
	}
	// Staged first, applied together, like a structured result.
	const variables = { ...awaiting.variables, ...Object.fromEntries(staged) };
	return {
		...rest,
		actions,
		variables,
		resume: { subagent: awaiting.subagent, index: call.index, before: awaiting.before },
	};
}

export async function run(source: string, options: RunOptions = {}): Promise<RunResult> {
	const port = options.port;
	if (port === undefined) throw new NoReasoningPortError();

	let state = start(source, {
		...(options.entry !== undefined ? { entry: options.entry } : {}),
		...(options.variables !== undefined ? { variables: options.variables } : {}),
	});
	const host = options.actionHost;
	if (host === undefined) {
		const acting = actingSubagents(source, state.entries);
		if (acting.length > 0) throw new NoActionHostError(acting);
	}
	for (;;) {
		const step = next(source, state, { persistVariables: options.persistVariables === true });
		if (step.type === "done") return step.result;
		if (step.type === "action") {
			state = applyAction(source, step.state, await callHost(host, step.call));
			continue;
		}
		state = apply(source, step.state, await port.reason(step.request));
	}
}

async function callHost(
	host: RunOptions["actionHost"],
	call: ActionCall,
): Promise<ActionResult> {
	if (host === undefined) return { ok: false, message: "no actionHost was given to run()" };
	try {
		return await host(call);
	} catch (error) {
		return { ok: false, message: error instanceof Error ? error.message : String(error) };
	}
}

/** An action a script defines, as a host checks it against what it provides. */
export interface DeclaredAction {
	readonly subagent: string;
	readonly action: string;
	/** The tool its `mcpTool://` target names. */
	readonly tool: string;
	/** Each declared input's type as written (`string`, `number`, `boolean`). */
	readonly inputs: Readonly<Record<string, string>>;
	readonly outputs: Readonly<Record<string, string>>;
}

/**
 * Every action the document defines, in source order, after the whole-document
 * checks `start` makes (so every target is already `mcpTool://<name>`).
 */
export function declaredActions(source: string): readonly DeclaredAction[] {
	const { subagents } = load(source);
	const declared: DeclaredAction[] = [];
	for (const [subagent, block] of subagents) {
		for (const definition of readActionDefinitions(block)) {
			const types = (parameters: typeof definition.inputs) =>
				Object.fromEntries(parameters.map((p) => [p.name, p.type ?? "(unknown)"]));
			declared.push({
				subagent,
				action: definition.name,
				tool: toolName(definition) ?? definition.name,
				inputs: types(definition.inputs),
				outputs: types(definition.outputs),
			});
		}
	}
	return declared;
}

/** The entry subagents whose procedure holds a `run` statement. */
function actingSubagents(source: string, entries: readonly string[]): readonly string[] {
	const { subagents } = load(source);
	const holdsRun = (list: readonly unknown[]): boolean =>
		list.some(
			(statement) =>
				isNode(statement) &&
				(statement.__kind === "RunStatement" ||
					holdsRun(Array.isArray(statement["body"]) ? statement["body"] : []) ||
					holdsRun(Array.isArray(statement["orelse"]) ? statement["orelse"] : [])),
		);
	return [...new Set(entries)].filter((name) => {
		const block = subagents.get(name);
		return block !== undefined && holdsRun(procedureStatements(block));
	});
}

function isAwaitingAction(awaiting: AwaitingStep | AwaitingAction): awaiting is AwaitingAction {
	return "call" in awaiting;
}

/** The action a `run` names. The scan has already refused one this subagent does not define. */
function actionDefinition(block: Node, run: Node) {
	const name = actionReference(run["target"]);
	const definition = readActionDefinitions(block).find((d) => d.name === name);
	if (definition === undefined) throw new Error(`run names @actions.${String(name)}, which the scan should have refused`);
	return definition;
}

/** Re-derive an action result from whatever the host answered, like `normalise` does for a port. */
function normaliseActionResult(result: ActionResult): ActionResult {
	if (result === null || typeof result !== "object") {
		return { ok: false, message: `the host answered ${result === null ? "null" : typeof result} rather than a result` };
	}
	if (result.ok === true) {
		const outputs = (result as { outputs?: unknown }).outputs;
		if (isNode(outputs)) return result;
		return { ok: false, message: "the host answered ok with no outputs object", ...("record" in result ? { record: result.record } : {}) };
	}
	if (result.ok === false) {
		const message = (result as { message?: unknown }).message;
		return typeof message === "string" ? result : { ...result, message: "the host reported a failure with no message" };
	}
	return { ok: false, message: `the host answered a result whose ok is ${JSON.stringify((result as { ok?: unknown }).ok)}` };
}

/**
 * FNV-1a over the source, as 8 hex digits. Not cryptographic: it only has to
 * notice that a saved state is being resumed against an edited script. Plain JS
 * so the core still imports nothing outside itself and runs on Workers.
 */
export function hashSource(source: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < source.length; i += 1) {
		hash ^= source.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return `${source.length.toString(16)}-${hash.toString(16).padStart(8, "0")}`;
}

function resolveEntries(
	entry: string | readonly string[] | undefined,
	subagents: ReadonlyMap<string, unknown>,
): readonly string[] {
	if (typeof entry === "string") return [entry];
	if (Array.isArray(entry)) return entry;
	const first = [...subagents.keys()][0];
	return first === undefined ? [] : [first];
}

/**
 * Re-derive the outcome from whatever the implementation reported.
 *
 * The port is typed, but an implementation is a foreign object at run time and
 * TypeScript is not there when it answers. That argument applies to `kind` at
 * least as strongly as to `category` — `kind` IS the discriminant, and a
 * `RunResult.kind` of `"exploded"` falls through every arm of a caller's switch
 * while being typed as one of three strings. So this is TOTAL: anything that is
 * not one of the three named outcomes settles as a failure that says so, and a
 * port that answers `null` becomes a failure rather than a TypeError thrown out
 * of the runner.
 *
 * A category outside the set becomes `unrecognised` with its message intact and
 * no category at all becomes `unknown` — neither is folded into a named one,
 * because "probably a rate limit" is how a billing failure gets retried forever.
 */
function normalise(outcome: StepOutcome): StepOutcome {
	if (outcome === null || typeof outcome !== "object") {
		return failure(
			`the port returned ${outcome === null ? "null" : typeof outcome} rather than an outcome. ` +
				"The step is a failure: there is nothing here to call answered.",
		);
	}
	const kind = (outcome as { kind?: unknown }).kind;
	if (kind === "answered" || kind === "cut-short") return outcome;
	if (kind === "failed") {
		const reported = (outcome as { category?: unknown }).category;
		// `message` is read the same defensive way as `category` and `kind`: the
		// port is typed and the object answering it is not.
		const message = (outcome as { message?: unknown }).message;
		return {
			kind: "failed",
			// The port is typed to report OUR category, so one we recognise is kept as-is.
			// Only a foreign string is normalised; see `isFailureCategory`.
			category:
				typeof reported === "string" && isFailureCategory(reported)
					? reported
					: toFailureCategory(typeof reported === "string" ? reported : undefined),
			message: typeof message === "string" ? message : "the port reported a failure with no message",
		};
	}
	return failure(
		`the port reported an outcome kind this runtime does not know: ${JSON.stringify(kind)}. ` +
			"A step ends answered, cut short, or failed; anything else is a failure, not a fourth " +
			"state a caller can be expected to branch on.",
	);
}

/**
 * Apply the step's structured result and its tool calls' outputs, and nothing else.
 *
 * A step that asked for a structured result and got none is a failure that sets
 * nothing. The model's prose is never read for a value: parsing prose for a state
 * update is how a run that failed becomes a run that quietly set the wrong
 * variable, and these variables gate stages, so the wrong value is the
 * difference between refusing an artifact and waving it through. A tool call's
 * `outputs` are the host's results; its arguments are never read for a value.
 */
function settle(outcome: StepOutcome, awaiting: AwaitingStep, variables: Map<string, VariableValue>): StepOutcome {
	if (outcome.kind !== "answered") return outcome;
	const pending = awaiting.pending;
	const staged = new Map<string, VariableValue>();

	const offered = new Set((awaiting.request.tools ?? []).map((tool) => tool.name));
	const calls = outcome.toolCalls ?? [];
	if (!Array.isArray(calls)) return failure("the port reported toolCalls that are not a list. No variable was set.");
	for (const call of calls) {
		const name = isNode(call) ? call["name"] : undefined;
		if (typeof name !== "string" || !offered.has(name)) {
			return failure(
				`the step reported a call to ${JSON.stringify(name)}, which it was not offered ` +
					`(offered: ${[...offered].join(", ") || "none"}). No variable was set.`,
			);
		}
	}

	if (pending.length > 0) {
		const structured = outcome.structured;
		if (!isNode(structured)) {
			return failure(
				`the step was asked for a structured result naming ${pending
					.map((p) => p.field)
					.join(", ")} and received none. No variable was set, and the returned text was not ` +
					"read for one.",
			);
		}
		for (const assignment of pending) {
			const value = structured[assignment.field];
			if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
				return failure(
					`the structured result carries no usable "${assignment.field}" for ` +
						`@variables.${assignment.variable}. No variable was set.`,
				);
			}
			staged.set(assignment.variable, value);
		}
	}

	for (const assignment of awaiting.toolAssignments ?? []) {
		// The last SUCCESSFUL call wins. A tool never called, or only refused or
		// interrupted, sets nothing and is no failure: the model saw the error.
		const last = calls.filter((call) => call.name === assignment.tool && call.ok === true).at(-1);
		if (last === undefined) continue;
		const value = isNode(last.outputs) ? last.outputs[assignment.field] : undefined;
		if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
			return failure(
				`the last successful call to ${assignment.tool} has no usable output "${assignment.field}" for ` +
					`@variables.${assignment.variable}. No variable was set.`,
			);
		}
		staged.set(assignment.variable, value);
	}
	// Staged first, applied together: a result missing its third field must not
	// leave the first two written and the run half-updated.
	for (const [name, value] of staged) variables.set(name, value);
	return outcome;
}

function failure(message: string): StepOutcome {
	// Nothing was reported, because nothing failed at the model layer — the
	// contract did. `toFailureCategory` is what decides that means `unknown`.
	return { kind: "failed", category: toFailureCategory(undefined), message };
}

/**
 * Rewrite each declared variable's authored value in place.
 *
 * Splices the source at the value's own span and touches nothing else, so
 * comments, spacing and every construct the runtime does not implement survive
 * byte-for-byte. Applied back-to-front so an earlier edit cannot move a later
 * span out from under itself.
 */
function rewrite(
	source: string,
	declarations: ReadonlyMap<string, DeclaredVariable>,
	variables: ReadonlyMap<string, VariableValue>,
): string {
	const offsets = lineOffsets(source);
	const edits = [...declarations.values()]
		.map((declared) => ({ declared, value: variables.get(declared.name) }))
		.filter((edit) => edit.value !== undefined && edit.value !== edit.declared.initial)
		.map((edit) => ({
			start: offsetOf(offsets, edit.declared.valueRange, "start"),
			end: offsetOf(offsets, edit.declared.valueRange, "end"),
			text: literal(edit.value as VariableValue),
		}))
		.sort((a, b) => b.start - a.start);

	let out = source;
	for (const edit of edits) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
	return out;
}

/**
 * One value, spelled the way the DIALECT spells it.
 *
 * `String(true)` gives JavaScript's `true`, which Agent Script reports as an
 * error ("Did you mean 'True' (capitalized)?"). Persistence splices this
 * straight into the author's source, so emitting it would take a document that
 * lints clean and hand back one that does not — an agent silently rewriting the
 * author's script into a broken one.
 */
function literal(value: VariableValue): string {
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "boolean") return BOOLEAN_LITERALS[value ? "true" : "false"];
	return String(value);
}

function lineOffsets(source: string): readonly number[] {
	const offsets = [0];
	for (let i = 0; i < source.length; i += 1) {
		if (source[i] === "\n") offsets.push(i + 1);
	}
	return offsets;
}

function offsetOf(offsets: readonly number[], range: Range, end: "start" | "end"): number {
	const position = range[end];
	return (offsets[position.line] ?? 0) + position.character;
}
