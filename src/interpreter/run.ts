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
import { type Range, documentRoot, formatPosition, isNode } from "./ast.js";
import {
	type DeclaredVariable,
	type PendingAssignment,
	type VariableValue,
	collectUndeclaredReferences,
	compose,
	outputSchemaFor,
	procedureStatements,
	readDeclarations,
	readSubagents,
	readSystemInstructions,
} from "./compose.js";
import {
	NoReasoningPortError,
	type ReasoningPort,
	type ReasoningRequest,
	type StepOutcome,
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

export async function run(source: string, options: RunOptions = {}): Promise<RunResult> {
	const port = options.port;
	if (port === undefined) throw new NoReasoningPortError();

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

	const variables = new Map<string, VariableValue>();
	for (const [name, declared] of declarations) variables.set(name, declared.initial);
	for (const [name, value] of Object.entries(options.variables ?? {})) {
		if (!declarations.has(name)) {
			throw new UndeclaredOverrideError(name, [...declarations.keys()]);
		}
		variables.set(name, value);
	}

	const subagents = readSubagents(parsed);
	const systemInstructions = readSystemInstructions(parsed);
	const steps: StepReport[] = [];
	let kind: RunResult["kind"] = "completed";

	const entries = resolveEntries(options.entry, subagents);
	if (entries.length === 0) throw new NoEntrySubagentError([...subagents.keys()]);

	for (const name of entries) {
		const block = subagents.get(name);
		if (block === undefined) throw new UnknownSubagentError(name, [...subagents.keys()]);

		const { prompt, pending } = compose(procedureStatements(block), variables);

		// A subagent whose lines are all logic has already done its whole job, here,
		// deterministically. Dispatching an empty prompt would be asking the model
		// nothing and paying for the answer — and it is what makes "evaluating a
		// logic line makes no model turn" true rather than merely intended.
		if (prompt === "" && pending.length === 0) continue;
		// The same cost, one branch over: an empty prompt that still asks for a
		// structured result is not skipped by the line above, and is refused here
		// rather than dispatched.
		if (prompt === "") throw new EmptyPromptError(name, pending.map((p) => p.field));

		// Built fresh every step: the port is told everything, every time.
		const request: ReasoningRequest =
			pending.length > 0
				? { systemInstructions, prompt, outputSchema: outputSchemaFor(pending, declarations) }
				: { systemInstructions, prompt };

		const outcome = normalise(await port.reason(request));
		const settled = pending.length > 0 ? applyStructured(outcome, pending, variables) : outcome;
		steps.push({ subagent: name, request, outcome: settled });

		if (settled.kind !== "answered") {
			kind = settled.kind;
			break;
		}
	}

	const result: RunResult = {
		kind,
		steps,
		variables: Object.fromEntries(variables),
	};
	if (options.persistVariables !== true) return result;
	return { ...result, updatedSource: rewrite(source, declarations, variables) };
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
			category: toFailureCategory(typeof reported === "string" ? reported : undefined),
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
 * Apply the step's structured result, and ONLY the structured result.
 *
 * A step that asked for one and got none is a failure that sets nothing. The
 * model's prose is never read for a value: parsing prose for a state update is
 * how a run that failed becomes a run that quietly set the wrong variable, and
 * these variables gate stages, so the wrong value is the difference between
 * refusing an artifact and waving it through.
 */
function applyStructured(
	outcome: StepOutcome,
	pending: readonly PendingAssignment[],
	variables: Map<string, VariableValue>,
): StepOutcome {
	if (outcome.kind !== "answered") return outcome;

	const structured = outcome.structured;
	if (!isNode(structured)) {
		return failure(
			`the step was asked for a structured result naming ${pending
				.map((p) => p.field)
				.join(", ")} and received none. No variable was set, and the returned text was not ` +
				"read for one.",
		);
	}

	const staged = new Map<string, VariableValue>();
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
