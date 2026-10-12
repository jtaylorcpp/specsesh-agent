import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { IsSchema, type TSchema } from "typebox";
import Value from "typebox/value";
import { describe, expect, it } from "vitest";
import * as openspec from "../../src/openspec/index.js";
import { TaskGroup, check, explain, toJSONSchema } from "../../src/openspec/index.js";
import {
	CHANGE_OUTCOME,
	GREEN_CHECK,
	GROUP_OUTCOME,
	OWN_PROPOSAL,
	ROOT,
	RUN_TASK,
	STEP_REF,
	STEP_REQUIREMENT,
	STEP_SCENARIO,
	VALID,
	demoChange,
	finding,
	metIteration,
	pass,
	read,
	task,
	taskConverged,
	unmetIteration,
} from "./fixtures.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "openspec");

/** The generic types: their schema is a function from the parameters' schemas to a schema. */
const GENERIC: Record<string, (...args: TSchema[]) => TSchema> = {
	Loop: (goal, out) => openspec.Loop(goal!, out!),
	LoopInput: (goal) => openspec.LoopInput(goal!),
	LoopOutcome: (out) => openspec.LoopOutcome(out!),
	StepResult: (out) => openspec.StepResult(out!),
};

/** Every type the four capabilities define, by the name the specs give it. */
const SPEC_TYPES = {
	"openspec/model": [
		"Root", "Capability", "CapabilityPath", "Requirement", "Scenario", "Clause", "Change", "Proposal", "Delta",
		"Added", "Modified", "Removed", "Renamed", "Design", "TaskList", "TaskGroup", "Task", "TaskId", "TaskLink",
		"RequirementRef", "ScenarioRef", "LinkBasis",
	],
	"openspec/process": [
		"Step", "StepResult", "StepFailure", "Intent", "CapabilityIndex", "ValidationReport", "Approval", "ArchiveResult", "ChangeState",
	],
	"openspec/loops": [
		"Loop", "LoopInput", "Iteration", "Budget", "Action", "ContextRef", "Verdict", "Target", "Feedback", "Escalation",
		"EscalationAnswer", "LoopOutcome", "TaskOutcome", "GroupOutcome", "ChangeOutcome",
	],
	"openspec/evidence": ["Evidence", "TestEvidence", "ValidationEvidence", "CheckEvidence", "DiffEvidence", "ReviewEvidence", "Finding"],
};

/** Names declared as `export type X` in the entry's source. */
const declaredTypes = () =>
	readdirSync(SRC)
		.filter((file) => file.endsWith(".ts"))
		.flatMap((file) => [...readFileSync(join(SRC, file), "utf8").matchAll(/^export type (\w+)/gm)].map((m) => m[1]!));

/**
 * Names exported as a schema, or as a generic schema's constructor: every
 * PascalCase export. Constants are UPPER_CASE and functions camelCase.
 */
const exportedSchemas = () =>
	Object.entries(openspec)
		.filter(([name]) => /^[A-Z][a-z]/.test(name))
		.map(([name, value]) => {
			expect(IsSchema(value) || name in GENERIC, `${name} is PascalCase but not a schema`).toBe(true);
			return name;
		});

const ESCALATION = { level: "task", to: "principal", reason: "ask", question: "Which is intended?" };
const TASK_OUTCOME_SCHEMA = openspec.TaskOutcome;
const LOOP_INPUT = { goal: task("2.4"), context: [], budget: { maxIterations: 3 }, carried: [] };

/** One value each schema accepts and one it refuses. Generic schemas are instantiated over `Task` / `TaskOutcome`. */
const FIXTURES: Record<string, { valid: unknown; invalid: unknown; args?: TSchema[] }> = {
	Root: { valid: { specsDir: "openspec/specs", changesDir: "openspec/changes", schema: "spec-driven" }, invalid: { specsDir: "openspec/specs" } },
	CapabilityPath: { valid: ["durable", "run-task"], invalid: [] },
	Clause: { valid: { keyword: "WHEN", text: "x" }, invalid: { keyword: "BUT", text: "x" } },
	Scenario: { valid: STEP_SCENARIO, invalid: { ...STEP_SCENARIO, clauses: [{ keyword: "WHEN", text: "x" }] } },
	Requirement: { valid: STEP_REQUIREMENT, invalid: { ...STEP_REQUIREMENT, scenarios: [] } },
	Capability: { valid: RUN_TASK, invalid: { ...RUN_TASK, path: [] } },
	RequirementRef: { valid: { capability: ["a"], requirement: "r" }, invalid: { capability: ["a"], requirement: "" } },
	ScenarioRef: { valid: STEP_REF, invalid: { ...STEP_REF, scenario: 1 } },
	TaskId: { valid: "2.4", invalid: "2.0" },
	LinkBasis: { valid: "file-overlap", invalid: "guessed" },
	TaskLink: { valid: { target: STEP_REF, basis: "inferred", confidence: 0.2 }, invalid: { target: STEP_REF, basis: "inferred", confidence: 1 } },
	Task: { valid: task("2.4"), invalid: { ...task("2.4"), done: "yes" } },
	TaskGroup: { valid: { number: 2, title: "t", tasks: [task("2.1")] }, invalid: { number: 2, title: "t", tasks: [task("1.1")] } },
	TaskList: { valid: { groups: [{ number: 1, title: "t", tasks: [] }] }, invalid: { groups: [] } },
	ChangeState: { valid: "amended", invalid: "done" },
	Proposal: { valid: OWN_PROPOSAL, invalid: { ...OWN_PROPOSAL, capabilities: { new: [["a"]], modified: [["a"]] } } },
	Added: { valid: { op: "ADDED", capability: ["a"], requirement: STEP_REQUIREMENT }, invalid: { op: "ADDED", capability: ["a"] } },
	Modified: { valid: { op: "MODIFIED", capability: ["a"], requirement: STEP_REQUIREMENT }, invalid: { op: "MODIFIED", capability: ["a"], requirement: { name: "x" } } },
	Removed: { valid: { op: "REMOVED", capability: ["a"], name: "n", reason: "r", migration: "m" }, invalid: { op: "REMOVED", capability: ["a"], name: "n" } },
	Renamed: { valid: { op: "RENAMED", capability: ["a"], from: "x", to: "y" }, invalid: { op: "RENAMED", capability: ["a"], from: "x", to: "x" } },
	Delta: { valid: { op: "RENAMED", capability: ["a"], from: "x", to: "y" }, invalid: { op: "CHANGED", capability: ["a"] } },
	Design: { valid: { sections: [{ heading: "Context", body: "" }] }, invalid: { sections: [] } },
	Change: { valid: demoChange(), invalid: { ...demoChange(), id: "Add_Thing" } },
	Target: { valid: { check: "strict validation" }, invalid: { check: "" } },
	ValidationReport: { valid: VALID, invalid: { valid: true, issues: [{ level: "FATAL", path: "", message: "" }] } },
	TestEvidence: { valid: pass(STEP_REF), invalid: { ...pass(STEP_REF), status: "flaky" } },
	ValidationEvidence: { valid: { kind: "validation", report: VALID }, invalid: { kind: "validation" } },
	CheckEvidence: { valid: GREEN_CHECK, invalid: { ...GREEN_CHECK, exitCode: "0" } },
	DiffEvidence: { valid: { kind: "diff", files: [{ path: "a.ts", change: "added" }] }, invalid: { kind: "diff", files: [{ path: "a.ts", change: "renamed" }] } },
	ReviewEvidence: { valid: { kind: "review", reviewer: "principal", verdict: "changes", notes: "" }, invalid: { kind: "review", reviewer: "ci", verdict: "approve", notes: "" } },
	Evidence: { valid: GREEN_CHECK, invalid: { kind: "vibe" } },
	FindingKind: { valid: "environment", invalid: "bug" },
	Finding: { valid: finding("code-defect"), invalid: { ...finding("code-defect"), evidence: [] } },
	Budget: { valid: { maxIterations: 1 }, invalid: { maxIterations: 0 } },
	ContextRef: { valid: { kind: "capability", ref: "durable/run-task" }, invalid: { kind: "capability", ref: "a › b" } },
	Action: { valid: { kind: "edit", summary: "s", refs: ["a.ts"] }, invalid: { kind: "think", summary: "s", refs: [] } },
	Verdict: { valid: { met: true, satisfied: [], unmet: [] }, invalid: { met: true, satisfied: [], unmet: [{ target: STEP_REF, reason: "r" }] } },
	FeedbackAction: { valid: "add-task", invalid: "ignore" },
	Feedback: { valid: { from: finding("code-defect"), action: "retry" }, invalid: { from: finding("code-defect"), action: "ignore" } },
	Recipient: { valid: "agent", invalid: "ci" },
	LoopLevel: { valid: "group", invalid: "step" },
	Escalation: { valid: ESCALATION, invalid: { ...ESCALATION, question: "" } },
	EscalationAnswer: { valid: { escalation: ESCALATION, by: "principal", decision: "d", feedback: [] }, invalid: { escalation: ESCALATION, by: "agent", decision: "d", feedback: [] } },
	Iteration: { valid: metIteration(1), invalid: { ...unmetIteration(1), feedback: [] } },
	LoopInput: { args: [openspec.Task], valid: LOOP_INPUT, invalid: { ...LOOP_INPUT, budget: { maxIterations: 0 } } },
	LoopOutcome: { args: [TASK_OUTCOME_SCHEMA], valid: taskConverged("2.4"), invalid: { status: "converged", iterations: [metIteration(1)] } },
	Loop: { args: [openspec.Task, TASK_OUTCOME_SCHEMA], valid: { input: LOOP_INPUT, output: taskConverged("2.4") }, invalid: { input: LOOP_INPUT } },
	LoopStatus: { valid: "failed", invalid: "running" },
	TaskOutcome: { valid: { task: "2.4", ticked: true }, invalid: { task: "2.4" } },
	GroupOutcome: { valid: GROUP_OUTCOME, invalid: { ...GROUP_OUTCOME, group: 3 } },
	ChangeOutcome: { valid: CHANGE_OUTCOME, invalid: { ...CHANGE_OUTCOME, groups: [...CHANGE_OUTCOME.groups, ...CHANGE_OUTCOME.groups] } },
	StepName: { valid: "archive", invalid: "deploy" },
	StepActor: { valid: "loop", invalid: "ci" },
	Step: { valid: { name: "plan", actor: "agent", input: "PlanInput", output: "TaskList" }, invalid: { name: "plan", actor: "agent", input: "PlanInput" } },
	StepFailure: { valid: { step: "archive", kind: "refused", message: "m", findings: [] }, invalid: { step: "archive", kind: "oops", message: "m", findings: [] } },
	StepResult: { args: [TASK_OUTCOME_SCHEMA], valid: { ok: true, value: { task: "2.4", ticked: false } }, invalid: { ok: true, failure: {} } },
	CapabilityIndex: { valid: [{ path: ["durable", "cli"], purpose: "p" }], invalid: [{ path: [] }] },
	Intent: { valid: { words: "w", existing: [] }, invalid: { words: 1, existing: [] } },
	SpecifyInput: { valid: { proposal: OWN_PROPOSAL, design: { sections: [{ heading: "h", body: "" }] }, base: [RUN_TASK] }, invalid: { proposal: OWN_PROPOSAL, base: [RUN_TASK] } },
	DesignInput: { valid: { proposal: OWN_PROPOSAL }, invalid: { proposal: OWN_PROPOSAL, deltas: [] } },
	PlanInput: { valid: { proposal: OWN_PROPOSAL, deltas: [], design: { sections: [{ heading: "h", body: "" }] } }, invalid: { proposal: OWN_PROPOSAL, deltas: [] } },
	Approval: { valid: { approved: true, by: "principal", principal: "Jesse", notes: "" }, invalid: { approved: true, by: "agent", principal: "bot", notes: "" } },
	ApproveInput: { valid: { change: demoChange(), report: VALID }, invalid: { change: demoChange() } },
	ArchiveInput: { valid: { change: demoChange(), outcome: { status: "converged", iterations: [], result: CHANGE_OUTCOME } }, invalid: { change: demoChange(), outcome: { status: "done", iterations: [] } } },
	ArchiveResult: { valid: { archivedAs: "x", totals: { added: 1, modified: 0, removed: 0, renamed: 0 }, specsUpdated: [["a"]] }, invalid: { archivedAs: "x", totals: { added: -1, modified: 0, removed: 0, renamed: 0 }, specsUpdated: [] } },
	ChangeEvent: { valid: { on: "execute" }, invalid: { on: "deploy" } },
	TransitionResult: { valid: { ok: true, state: "approved" }, invalid: { ok: true, state: "deployed" } },
};

/** The exported schema of that name; a generic one instantiated over its fixture's parameters. */
const schemaOf = (name: string): TSchema =>
	name in GENERIC
		? GENERIC[name]!(...(FIXTURES[name]?.args ?? []))
		: ((openspec as Record<string, unknown>)[name] as TSchema);

describe("Every model type has a static type and a JSON Schema", () => {
	it("Scenario: Every type has a schema", () => {
		const types = declaredTypes();
		const schemas = exportedSchemas();
		expect(types.length).toBeGreaterThan(40);
		// Each exported type has a schema of the same name, and each schema a type.
		expect([...new Set(types)].sort()).toEqual([...new Set(schemas)].sort());
		expect(new Set(types).size, "a type is declared twice").toBe(types.length);
		// Each is a TypeBox schema (a generic one once given its parameters) whose JSON Schema is plain JSON.
		for (const name of schemas) {
			const schema = schemaOf(name);
			expect(IsSchema(schema), `${name} is not a TypeBox schema`).toBe(true);
			const json = toJSONSchema(schema);
			expect(JSON.parse(JSON.stringify(json)), `${name} is not plain JSON`).toEqual(json);
			expect(Object.keys(json).length, `${name} exported an empty JSON Schema`).toBeGreaterThan(0);
			expect(JSON.stringify(json), `${name} leaks TypeBox bookkeeping`).not.toMatch(/"~/);
		}
		// Every type the specs define is among them, and the list is the specs' own.
		const specText = Object.keys(SPEC_TYPES)
			.map((capability) => read(`openspec/specs/${capability}/spec.md`))
			.join("\n");
		for (const [capability, names] of Object.entries(SPEC_TYPES)) {
			for (const name of names) {
				expect(types, `${capability} defines ${name}`).toContain(name);
				expect(specText, `${name} is not named in the specs`).toMatch(new RegExp(`\`${name}[\`<]`));
			}
		}
	});
});

describe("Cross-field rules are part of the schema's own check", () => {
	it("Scenario: The schema's own check enforces a cross-field rule", () => {
		const group = { number: 2, title: "t", tasks: [task("3.1")] };
		expect(Value.Check(TaskGroup, group)).toBe(false);
		// The same group in its own number passes, so it is the rule that refused it.
		expect(Value.Check(TaskGroup, { ...group, tasks: [task("2.1")] })).toBe(true);
		// explain names the task id, and check reports it like any other issue.
		expect(explain(TaskGroup, group).join("\n")).toContain("3.1");
		expect(check(TaskGroup, group)).toBe(false);
	});

	it("leaves each refinement out of the JSON Schema rather than throwing", () => {
		// The exported contract is wider: the task id rule is not in it.
		expect(toJSONSchema(TaskGroup)).toMatchObject({ type: "object", required: ["number", "title", "tasks"] });
		expect(JSON.stringify(toJSONSchema(TaskGroup))).not.toContain("3.1");
	});

	it("keeps a rule JSON Schema can state in the JSON Schema", () => {
		// A scenario's WHEN and THEN are `contains` in the schema itself, so the export keeps them.
		const clauses = (toJSONSchema(openspec.Scenario).properties as Record<string, { allOf?: unknown[] }>).clauses!;
		expect(clauses.allOf).toHaveLength(2);
		expect(JSON.stringify(clauses.allOf)).toContain('"const":"WHEN"');
		expect(JSON.stringify(clauses.allOf)).toContain('"const":"THEN"');
	});
});

describe("schema and type agreement", () => {
	it("has a fixture for every schema, and only for schemas", () => {
		expect(Object.keys(FIXTURES).sort()).toEqual(exportedSchemas().sort());
	});

	for (const [name, fixture] of Object.entries(FIXTURES)) {
		it(`${name} accepts a valid value and refuses an invalid one`, () => {
			const schema = schemaOf(name);
			expect(IsSchema(schema), `${name} is not a TypeBox schema`).toBe(true);
			expect(check(schema, fixture.valid), `${name} refuses its valid fixture`).toBe(true);
			expect(check(schema, fixture.invalid), `${name} accepts its invalid fixture`).toBe(false);
			// The schema exports as JSON Schema.
			expect(() => JSON.parse(JSON.stringify(toJSONSchema(schema)))).not.toThrow();
		});
	}

	it("generic schemas take their parameter's schema", () => {
		// The same LoopOutcome over two result types accepts each one's results only.
		const groupLevel = openspec.LoopOutcome(openspec.GroupOutcome);
		expect(check(groupLevel, { status: "converged", iterations: [], result: GROUP_OUTCOME })).toBe(true);
		expect(check(groupLevel, taskConverged("2.4"))).toBe(false);
	});

	it("reads the source tree it checks", () => {
		expect(readdirSync(SRC).filter((file) => file.endsWith(".ts")).sort()).toEqual([
			"evidence.ts", "index.ts", "loops.ts", "model.ts", "process.ts", "schema.ts",
		]);
		expect(ROOT).toBeTruthy();
	});
});
