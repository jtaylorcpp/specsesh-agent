// Typed values for the ontology tests, taken from this repository where one exists.
// Each is declared against its static type, so the compiler checks it as well as the schema.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	Capability,
	Change,
	ChangeOutcome,
	CheckEvidence,
	Evidence,
	Finding,
	GroupOutcome,
	Iteration,
	LoopOutcome,
	Proposal,
	Requirement,
	Scenario,
	ScenarioRef,
	Task,
	TaskOutcome,
	TestEvidence,
	ValidationReport,
} from "../../src/openspec/index.js";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
export const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** `durable/run-task`'s step-number scenario, as the spec writes it. */
export const STEP_SCENARIO: Scenario = {
	name: "The first and second model steps are numbered 0 and 1",
	clauses: [
		{ keyword: "WHEN", text: "the pipeline run dispatches `classify` and then `respond`" },
		{ keyword: "THEN", text: "their checkpoints SHALL carry `step: 0` and `step: 1`" },
	],
};

export const STEP_REQUIREMENT: Requirement = {
	name: "The step number is the index of the step being run",
	text: "A checkpoint's `step` SHALL be the zero-based index of the step being run, equal to `state.steps.length` at the moment `next` produced the request. It MUST stay the same through that step's `dispatch` and `await` phases.",
	scenarios: [STEP_SCENARIO],
};

export const STEP_REF: ScenarioRef = {
	capability: ["durable", "run-task"],
	requirement: STEP_REQUIREMENT.name,
	scenario: STEP_SCENARIO.name,
};

export const RUN_TASK: Capability = {
	path: ["durable", "run-task"],
	purpose: "A run as a crash-safe pi-durable task.",
	requirements: [STEP_REQUIREMENT],
};

/** A requirement with three scenarios, for the requirement-target and requirement-named rules. */
export const THREE: Requirement = {
	name: "Three scenarios",
	text: "The thing SHALL hold three ways.",
	scenarios: ["one", "two", "three"].map((name) => ({
		name,
		clauses: [
			{ keyword: "WHEN", text: `case ${name}` },
			{ keyword: "THEN", text: "it holds" },
		],
	})),
};
export const THREE_CAP: Capability = { path: ["demo", "three"], purpose: "Three.", requirements: [THREE] };
export const threeRef = (scenario: string): ScenarioRef => ({ capability: ["demo", "three"], requirement: THREE.name, scenario });

export const pass = (ref: ScenarioRef): TestEvidence => ({
	kind: "test",
	file: "__tests__/demo.test.ts",
	name: `Scenario: ${ref.scenario}`,
	scenario: ref,
	status: "pass",
});
export const fail = (ref: ScenarioRef): TestEvidence => ({ ...pass(ref), status: "fail" });
export const skip = (ref: ScenarioRef): TestEvidence => ({ ...pass(ref), status: "skip" });

export const GREEN_CHECK: CheckEvidence = { kind: "check", command: "pnpm check", exitCode: 0, output: "" };
export const GREEN_SUITE: CheckEvidence = { kind: "check", command: "pnpm test", exitCode: 0, output: "all passed" };

export const finding = (kind: Finding["kind"], target?: Finding["target"], evidence: Evidence[] = [GREEN_CHECK]): Finding => ({
	kind,
	...(target === undefined ? {} : { target }),
	evidence,
	message: `${kind} found`,
});

export const VALID: ValidationReport = { valid: true, issues: [] };
export const INVALID: ValidationReport = {
	valid: false,
	issues: [{ level: "ERROR", path: "specs/x/spec.md", message: "Requirement must have at least one scenario" }],
};

/** This change's own proposal, as `proposal.md` states its capabilities. */
export const OWN_PROPOSAL: Proposal = {
	why: "OpenSpec treats executing a change as a flat checklist.",
	whatChanges: ["New capability openspec/model", "New capability openspec/process"],
	capabilities: {
		new: [
			["openspec", "model"],
			["openspec", "process"],
			["openspec", "loops"],
			["openspec", "evidence"],
		],
		modified: [],
	},
	outOfScope: ["Parsers that read a real change into these types"],
	impact: ["A new entry, @specsesh/agent/openspec"],
};

export const task = (id: string, links: Task["links"] = [], done = false): Task => ({
	id,
	text: `task ${id}`,
	done,
	files: [],
	links,
});

/** A change adding `THREE` to `demo/three`, with the given task list. */
export const demoChange = (tasks?: Change["tasks"]): Change => ({
	id: "add-demo",
	schema: "spec-driven",
	proposal: { ...OWN_PROPOSAL, capabilities: { new: [["demo", "three"]], modified: [] } },
	deltas: [{ op: "ADDED", capability: ["demo", "three"], requirement: THREE }],
	...(tasks === undefined ? {} : { tasks }),
	state: "executing",
});

export const metIteration = (n: number, evidence: Evidence[] = []): Iteration => ({
	n,
	plan: `attempt ${n}`,
	actions: [],
	evidence,
	verdict: { met: true, satisfied: [], unmet: [] },
	feedback: [],
});

/** An iteration whose verdict leaves `STEP_REF` unmet, with feedback of `action` from a finding of `kind`. */
export const unmetIteration = (
	n: number,
	action: Iteration["feedback"][number]["action"] = "retry",
	kind: Finding["kind"] = "code-defect",
): Iteration => ({
	n,
	plan: `attempt ${n}`,
	actions: [{ kind: "command", summary: "run the tests", refs: ["pnpm test"] }],
	evidence: [fail(STEP_REF)],
	verdict: { met: false, satisfied: [], unmet: [{ target: STEP_REF, reason: "the test fails" }] },
	feedback: [{ from: finding(kind, STEP_REF, [fail(STEP_REF)]), action }],
});

export const taskConverged = (id: string, iterations = 1): LoopOutcome<TaskOutcome> => ({
	status: "converged",
	iterations: Array.from({ length: iterations }, (_, i) => (i === iterations - 1 ? metIteration(i + 1) : unmetIteration(i + 1))),
	result: { task: id, ticked: true },
});

export const GROUP_OUTCOME: GroupOutcome = { group: 2, tasks: [{ task: "2.4", outcome: taskConverged("2.4"), runs: 1 }] };

export const CHANGE_OUTCOME: ChangeOutcome = {
	groups: [{ group: 2, outcome: { status: "converged", iterations: [metIteration(1)], result: GROUP_OUTCOME }, runs: 1 }],
	unclaimed: [],
};
