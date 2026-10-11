/**
 * The process (`openspec/process`): the lifecycle of a change as eight typed
 * steps, and the state machine a change moves through.
 *
 * A step returns a `StepResult`; it never throws. `invokeStep` is that
 * discipline at the boundary: the input is checked against the step's input
 * schema before the step's body sees it.
 */

import Type, { type Static, type TSchema, type TUnsafe } from "typebox";
import { Finding, ValidationReport } from "./evidence.js";
import { ChangeOutcome, LoopOutcome } from "./loops.js";
import {
	Capability,
	CapabilityPath,
	Change,
	ChangeState,
	Delta,
	Design,
	Proposal,
	TaskList,
	formatRef,
} from "./model.js";
import { Name, check, closed, explain, literals, sameValue } from "./schema.js";

// ── Steps ───────────────────────────────────────────────────────────────────

export const StepName = literals("propose", "specify", "design", "plan", "validate", "approve", "execute", "archive");
export type StepName = Static<typeof StepName>;

export const StepActor = Type.Union([Type.Literal("principal"), Type.Literal("agent"), Type.Literal("tool"), Type.Literal("loop")]);
export type StepActor = Static<typeof StepActor>;

/**
 * A step as it crosses a boundary: its name, its actor, and the names of its
 * input and output types. `In` and `Out` are the static types those names
 * denote; the schemas themselves are in `STEP_SCHEMAS`.
 */
export const Step = closed({ name: StepName, actor: StepActor, input: Name(), output: Name() });
export type Step<_In = unknown, _Out = unknown> = Static<typeof Step>;

export const StepFailure = closed({
	step: Name(),
	kind: Type.Union([Type.Literal("invalid-input"), Type.Literal("refused"), Type.Literal("blocked"), Type.Literal("error")]),
	message: Type.String(),
	findings: Type.Array(Finding),
});
export type StepFailure = Static<typeof StepFailure>;

export const StepResult = <Out extends TSchema>(out: Out) =>
	Type.Union([closed({ ok: Type.Literal(true), value: out }), closed({ ok: Type.Literal(false), failure: StepFailure })]);
export type StepResult<Out> = Static<ReturnType<typeof StepResult<TUnsafe<Out>>>>;

/** Every existing capability path with its purpose. */
export const CapabilityIndex = Type.Array(closed({ path: CapabilityPath, purpose: Type.String() }));
export type CapabilityIndex = Static<typeof CapabilityIndex>;

export const Intent = closed({ words: Type.String(), existing: CapabilityIndex });
export type Intent = Static<typeof Intent>;

export const SpecifyInput = closed({ proposal: Proposal, base: Type.Array(Capability) });
export type SpecifyInput = Static<typeof SpecifyInput>;

export const DesignInput = closed({ proposal: Proposal, deltas: Type.Array(Delta) });
export type DesignInput = Static<typeof DesignInput>;

export const PlanInput = closed({ proposal: Proposal, deltas: Type.Array(Delta), design: Design });
export type PlanInput = Static<typeof PlanInput>;

/** Only the principal approves: `by` admits nothing else. */
export const Approval = closed({ approved: Type.Boolean(), by: Type.Literal("principal"), principal: Name(), notes: Type.String() });
export type Approval = Static<typeof Approval>;

export const ApproveInput = closed({ change: Change, report: ValidationReport });
export type ApproveInput = Static<typeof ApproveInput>;

export const ArchiveInput = closed({ change: Change, outcome: LoopOutcome(ChangeOutcome) });
export type ArchiveInput = Static<typeof ArchiveInput>;

const Count = () => Type.Integer({ minimum: 0 });

export const ArchiveResult = closed({
	archivedAs: Name(),
	totals: closed({ added: Count(), modified: Count(), removed: Count(), renamed: Count() }),
	specsUpdated: Type.Array(CapabilityPath),
});
export type ArchiveResult = Static<typeof ArchiveResult>;

/** The eight steps in lifecycle order. */
export const STEPS = [
	{ name: "propose", actor: "agent", input: "Intent", output: "Proposal" },
	{ name: "specify", actor: "agent", input: "SpecifyInput", output: "Delta[]" },
	{ name: "design", actor: "agent", input: "DesignInput", output: "Design" },
	{ name: "plan", actor: "agent", input: "PlanInput", output: "TaskList" },
	{ name: "validate", actor: "tool", input: "Change", output: "ValidationReport" },
	{ name: "approve", actor: "principal", input: "ApproveInput", output: "Approval" },
	{ name: "execute", actor: "loop", input: "Change", output: "LoopOutcome<ChangeOutcome>" },
	{ name: "archive", actor: "tool", input: "ArchiveInput", output: "ArchiveResult" },
] as const satisfies readonly Step[];

/** Each step's input and output schema. */
export const STEP_SCHEMAS = {
	propose: { input: Intent, output: Proposal },
	specify: { input: SpecifyInput, output: Type.Array(Delta) },
	design: { input: DesignInput, output: Design },
	plan: { input: PlanInput, output: TaskList },
	validate: { input: Change, output: ValidationReport },
	approve: { input: ApproveInput, output: Approval },
	execute: { input: Change, output: LoopOutcome(ChangeOutcome) },
	archive: { input: ArchiveInput, output: ArchiveResult },
} as const satisfies Record<StepName, { input: TSchema; output: TSchema }>;

type StepIO = typeof STEP_SCHEMAS;
type StepIn<N extends StepName> = Static<StepIO[N]["input"]>;
type StepOut<N extends StepName> = Static<StepIO[N]["output"]>;

const failure = (step: string, kind: StepFailure["kind"], message: string, findings: Finding[] = []) =>
	({ ok: false, failure: { step, kind, message, findings } }) as const;

/**
 * Runs a step's body behind its input schema. An input that fails the schema
 * returns `invalid-input`; a body that throws returns `error`. Never throws.
 */
export function invokeStep<N extends StepName>(
	name: N,
	input: unknown,
	body: (input: StepIn<N>) => StepResult<StepOut<N>>,
): StepResult<StepOut<N>> {
	const schema = STEP_SCHEMAS[name].input;
	if (!check(schema, input)) return failure(name, "invalid-input", explain(schema, input).join("; "));
	try {
		return body(input as StepIn<N>);
	} catch (error) {
		return failure(name, "error", error instanceof Error ? error.message : String(error));
	}
}

/** `propose`: every modified path must be an existing capability, not a near-duplicate of one. */
export function proposalIssues(intent: Intent, proposal: Proposal): string[] {
	return proposal.capabilities.modified
		.filter((path) => !intent.existing.some((entry) => sameValue(entry.path, path)))
		.map((path) => `${formatRef(path)} is modified but is not an existing capability`);
}

/**
 * `specify`: each capability the proposal names gets at least one delta, and a
 * `MODIFIED` or `REMOVED` delta names a requirement present in the base.
 */
export function specifyIssues(input: SpecifyInput, deltas: readonly Delta[]): string[] {
	const issues: string[] = [];
	const named = [...input.proposal.capabilities.new, ...input.proposal.capabilities.modified];
	for (const path of named) {
		if (!deltas.some((delta) => sameValue(delta.capability, path))) issues.push(`${formatRef(path)} has no delta`);
	}
	for (const delta of deltas) {
		if (delta.op !== "MODIFIED" && delta.op !== "REMOVED") continue;
		const name = delta.op === "MODIFIED" ? delta.requirement.name : delta.name;
		const base = input.base.find((capability) => sameValue(capability.path, delta.capability));
		if (!base?.requirements.some((requirement) => requirement.name === name)) {
			issues.push(`${delta.op} "${name}" is not a requirement of ${formatRef(delta.capability)}`);
		}
	}
	return issues;
}

/** Strict validation: valid only when no issue is an `ERROR` or a `WARNING`. */
export const strictlyValid = (issues: ValidationReport["issues"]): boolean =>
	issues.every((issue) => issue.level === "INFO");

/** `execute`: a successful outcome's groups, when present, cover every task group of the change. */
export function coversEveryGroup(change: Change, outcome: LoopOutcome<ChangeOutcome>): boolean {
	if (outcome.result === undefined) return true;
	const covered = new Set(outcome.result.groups.map((entry) => entry.group));
	return (change.tasks?.groups ?? []).every((group) => covered.has(group.number));
}

/**
 * `archive`'s guard: the change loop converged, and the step's own fresh strict
 * validation (`report`, run as the step begins) is valid. Anything else is
 * `refused`.
 */
export function archiveGuard(input: ArchiveInput, report: ValidationReport): StepResult<ArchiveInput> {
	if (input.outcome.status !== "converged") {
		return failure("archive", "refused", `the change loop ended ${input.outcome.status}, not converged`);
	}
	if (!report.valid) return failure("archive", "refused", "the change does not validate strictly");
	return { ok: true, value: input };
}

// ── The change state machine ────────────────────────────────────────────────

/** The first `Proposal` creates the change, in `drafting`, with no deltas yet. */
export const newChange = (id: string, schema: string, proposal: Proposal): Change => ({
	id,
	schema,
	proposal,
	deltas: [],
	state: "drafting",
});

/** What moves a change: each step's result, or abandonment. */
export const ChangeEvent = Type.Union([
	closed({ on: Type.Literal("specify"), deltas: Type.Array(Delta) }),
	closed({ on: Type.Literal("design"), design: Design }),
	closed({ on: Type.Literal("plan"), tasks: TaskList }),
	closed({ on: Type.Literal("validate"), report: ValidationReport }),
	closed({ on: Type.Literal("approve"), approval: Approval }),
	closed({ on: Type.Literal("execute") }),
	closed({ on: Type.Literal("converge"), outcome: LoopOutcome(ChangeOutcome) }),
	closed({ on: Type.Literal("amend"), finding: Finding }),
	/** `reportedAt` and `convergedAt` are ISO 8601 times; the report must come after convergence. */
	closed({ on: Type.Literal("archive"), report: ValidationReport, reportedAt: Name(), convergedAt: Name() }),
	closed({ on: Type.Literal("abandon") }),
]);
export type ChangeEvent = Static<typeof ChangeEvent>;

export const TransitionResult = Type.Union([
	closed({ ok: Type.Literal(true), state: ChangeState }),
	closed({ ok: Type.Literal(false), reason: Type.String() }),
]);
export type TransitionResult = Static<typeof TransitionResult>;

/** The state each event leads to, from the one state it may leave. `abandon` and `validate` are handled apart. */
const FORWARD: Partial<Record<ChangeEvent["on"], readonly [ChangeState, ChangeState]>> = {
	specify: ["drafting", "specified"],
	design: ["specified", "designed"],
	plan: ["designed", "planned"],
	approve: ["validated", "approved"],
	execute: ["approved", "executing"],
	converge: ["executing", "converged"],
	amend: ["executing", "amended"],
	archive: ["converged", "archived"],
};

/** Why the event's own condition fails, or `undefined` when it holds. */
function guardFails(event: ChangeEvent): string | undefined {
	switch (event.on) {
		case "validate":
			return event.report.valid ? undefined : "the validation report is not valid";
		case "approve":
			if (!check(Approval, event.approval)) return "the approval is not the principal's";
			return event.approval.approved ? undefined : "the principal did not approve";
		case "converge":
			return event.outcome.status === "converged" ? undefined : `the change loop ended ${event.outcome.status}`;
		case "amend":
			return event.finding.kind === "spec-defect" ? undefined : `a ${event.finding.kind} finding does not amend the spec`;
		case "archive": {
			if (!event.report.valid) return "the validation report is not valid";
			const reported = Date.parse(event.reportedAt);
			const converged = Date.parse(event.convergedAt);
			if (Number.isNaN(reported) || Number.isNaN(converged)) return "the report or convergence time is not a time";
			return reported > converged ? undefined : "the valid report predates convergence";
		}
		default:
			return undefined;
	}
}

/**
 * The state `event` moves a change in `state` to, or why it may not. Only the
 * transitions `openspec/process` defines are allowed: the forward path,
 * `executing → amended → validated`, and `abandoned` from any state but the
 * two terminal ones. Nothing leads into `drafting`.
 */
export function transition(state: ChangeState, event: ChangeEvent): TransitionResult {
	if (state === "archived" || state === "abandoned") return { ok: false, reason: `${state} is terminal` };
	if (event.on === "abandon") return { ok: true, state: "abandoned" };
	const edge =
		event.on === "validate"
			? state === "planned" || state === "amended"
				? ([state, "validated"] as const)
				: undefined
			: FORWARD[event.on];
	if (edge === undefined || edge[0] !== state) return { ok: false, reason: `${event.on} does not apply to a change in ${state}` };
	const reason = guardFails(event);
	return reason === undefined ? { ok: true, state: edge[1] } : { ok: false, reason };
}
