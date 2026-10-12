import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as openspec from "../../src/openspec/index.js";
import {
	Approval,
	ArchiveResult,
	type ChangeEvent,
	type ChangeOutcome,
	type ChangeState,
	DesignInput,
	type Intent,
	type LoopOutcome,
	PlanInput,
	STEPS,
	STEP_SCHEMAS,
	SpecifyInput,
	archiveGuard,
	check,
	coversEveryGroup,
	invokeStep,
	newChange,
	proposalIssues,
	specifyIssues,
	strictlyValid,
	transition,
} from "../../src/openspec/index.js";
import {
	CHANGE_OUTCOME,
	INVALID,
	OWN_PROPOSAL,
	ROOT,
	THREE,
	THREE_CAP,
	VALID,
	demoChange,
	finding,
	metIteration,
	read,
	task,
	unmetIteration,
} from "./fixtures.js";

const APPROVAL: Approval = { approved: true, by: "principal", principal: "Jesse", notes: "" };
const DESIGN = { sections: [{ heading: "Context", body: "" }] };
const converged: LoopOutcome<ChangeOutcome> = { status: "converged", iterations: [metIteration(1)], result: CHANGE_OUTCOME };
const exhausted: LoopOutcome<ChangeOutcome> = { status: "exhausted", iterations: [unmetIteration(1)] };

/** The event that drives each forward transition. */
const FORWARD_EVENTS: ChangeEvent[] = [
	{ on: "design", design: DESIGN },
	{ on: "specify", deltas: demoChange().deltas },
	{ on: "plan", tasks: { groups: [{ number: 1, title: "One", tasks: [task("1.1")] }] } },
	{ on: "validate", report: VALID },
	{ on: "approve", approval: APPROVAL },
	{ on: "execute" },
	{ on: "converge", outcome: converged },
	{ on: "archive", report: VALID, convergedAt: "2026-10-11T10:00:00Z", reportedAt: "2026-10-11T10:05:00Z" },
];

const ALL_STATES: ChangeState[] = [
	"drafting",
	"designed",
	"specified",
	"planned",
	"validated",
	"approved",
	"executing",
	"converged",
	"archived",
	"amended",
	"abandoned",
];
const ALL_EVENTS: ChangeEvent[] = [
	...FORWARD_EVENTS,
	{ on: "amend", finding: finding("spec-defect") },
	{ on: "abandon" },
];

describe("A step has a named input, output and actor", () => {
	it("Scenario: Every step's types are named", () => {
		const exported = openspec as Record<string, unknown>;
		for (const step of STEPS) {
			expect(check(openspec.Step, step), step.name).toBe(true);
			// Each name is a type with a schema of that name: `Delta[]` and `LoopOutcome<ChangeOutcome>` are built from them.
			for (const name of [step.input, step.output]) {
				const parts = name.match(/[A-Z][A-Za-z]*/g)!;
				expect(parts.length).toBeGreaterThan(0);
				for (const part of parts) expect(exported[part], `${step.name}: ${part}`).toBeDefined();
			}
			expect(STEP_SCHEMAS[step.name].input).toBeTypeOf("object");
			expect(STEP_SCHEMAS[step.name].output).toBeTypeOf("object");
		}
		expect(Object.keys(STEP_SCHEMAS)).toEqual(STEPS.map((step) => step.name));
	});
});

describe("A step returns a result, never throws", () => {
	it("Scenario: Input that fails its schema", () => {
		let ran = false;
		const result = invokeStep("propose", { words: 42 }, () => {
			ran = true;
			return { ok: true, value: OWN_PROPOSAL };
		});
		expect(ran).toBe(false);
		expect(result.ok).toBe(false);
		expect(!result.ok && result.failure).toMatchObject({ step: "propose", kind: "invalid-input", findings: [] });
		expect(check(openspec.StepFailure, !result.ok && result.failure)).toBe(true);
		// A body that throws is an error value too.
		const thrown = invokeStep("propose", { words: "w", existing: [] }, () => {
			throw new Error("boom");
		});
		expect(thrown).toEqual({ ok: false, failure: { step: "propose", kind: "error", message: "boom", findings: [] } });
		expect(invokeStep("propose", { words: "w", existing: [] }, () => ({ ok: true, value: OWN_PROPOSAL })).ok).toBe(true);
	});
});

describe("Failure kinds mean distinct things", () => {
	it("Scenario: Archiving without a valid report is refused", () => {
		const result = archiveGuard({ change: { ...demoChange(), state: "converged" }, outcome: converged }, INVALID);
		expect(result.ok).toBe(false);
		expect(!result.ok && result.failure.kind).toBe("refused");
		expect(archiveGuard({ change: { ...demoChange(), state: "converged" }, outcome: converged }, VALID).ok).toBe(true);
	});
});

describe("Propose turns intent into a proposal", () => {
	it("Scenario: The proposal reuses existing capability paths", () => {
		const intent: Intent = { words: "make the durable CLI resumable by name", existing: [{ path: ["durable", "cli"], purpose: "The durable CLI." }] };
		const reuses = { ...OWN_PROPOSAL, capabilities: { new: [], modified: [["durable", "cli"]] } };
		expect(proposalIssues(intent, reuses)).toEqual([]);
		const nearDuplicate = { ...OWN_PROPOSAL, capabilities: { new: [], modified: [["durable", "clis"]] } };
		expect(proposalIssues(intent, nearDuplicate)).toEqual(["durable/clis is modified but is not an existing capability"]);
		expect(newChange("make-cli-resumable", "spec-driven", reuses).state).toBe("drafting");
	});
});

describe("Specify turns a proposal into deltas", () => {
	it("Scenario: A modified delta must exist in the base", () => {
		const input: SpecifyInput = {
			proposal: { ...OWN_PROPOSAL, capabilities: { new: [], modified: [["demo", "three"]] } },
			design: DESIGN,
			base: [THREE_CAP],
		};
		const absent = { ...THREE, name: "Not in the base" };
		expect(specifyIssues(input, [{ op: "MODIFIED", capability: ["demo", "three"], requirement: absent }])).toEqual([
			'MODIFIED "Not in the base" is not a requirement of demo/three',
		]);
		expect(specifyIssues(input, [{ op: "MODIFIED", capability: ["demo", "three"], requirement: THREE }])).toEqual([]);
		// Every capability the proposal names gets a delta.
		expect(specifyIssues(input, [])).toEqual(["demo/three has no delta"]);
	});

	it("Scenario: Specify sees the design", () => {
		const base = [THREE_CAP];
		expect(check(SpecifyInput, { proposal: OWN_PROPOSAL, design: DESIGN, base })).toBe(true);
		expect(check(SpecifyInput, { proposal: OWN_PROPOSAL, base })).toBe(false);
	});
});

describe("Design follows the proposal", () => {
	it("Scenario: Design sees only the proposal", () => {
		expect(check(DesignInput, { proposal: OWN_PROPOSAL })).toBe(true);
		expect(check(DesignInput, { proposal: OWN_PROPOSAL, deltas: demoChange().deltas })).toBe(false);
		expect(STEPS.find((step) => step.name === "design")).toEqual({ name: "design", actor: "agent", input: "DesignInput", output: "Design" });
	});

	it("Scenario: The steps in lifecycle order", () => {
		expect(STEPS.map((step) => step.name)).toEqual(["propose", "design", "specify", "plan", "validate", "approve", "execute", "archive"]);
	});
});

describe("Plan follows the deltas and the design", () => {
	it("Scenario: Plan sees the design", () => {
		const deltas = demoChange().deltas;
		expect(check(PlanInput, { proposal: OWN_PROPOSAL, deltas, design: DESIGN })).toBe(true);
		expect(check(PlanInput, { proposal: OWN_PROPOSAL, deltas })).toBe(false);
		expect(STEPS.find((step) => step.name === "plan")?.input).toBe("PlanInput");
	});
});

describe("Validate reports issues by level", () => {
	it("Scenario: A warning fails strict validation", () => {
		const warning = { level: "WARNING" as const, path: "specs/x/spec.md", message: "Requirement text exceeds 500 characters" };
		expect(strictlyValid([warning])).toBe(false);
		expect(strictlyValid([{ ...warning, level: "ERROR" }])).toBe(false);
		expect(strictlyValid([{ ...warning, level: "INFO" }])).toBe(true);
		expect(strictlyValid([])).toBe(true);
	});
});

describe("Approve is the principal's gate", () => {
	it("Scenario: An agent cannot approve", () => {
		const byAgent = { ...APPROVAL, by: "agent" };
		expect(check(Approval, byAgent)).toBe(false);
		expect(check(Approval, APPROVAL)).toBe(true);
		const result = transition("validated", { on: "approve", approval: byAgent as unknown as Approval });
		expect(result.ok).toBe(false);
	});
});

describe("Execute runs the change loop", () => {
	it("Scenario: Execute produces a change outcome", () => {
		const change = { ...demoChange({ groups: [{ number: 2, title: "Two", tasks: [task("2.4")] }] }), state: "approved" as const };
		expect(check(STEP_SCHEMAS.execute.output, converged)).toBe(true);
		expect(coversEveryGroup(change, converged)).toBe(true);
		const missing = { ...demoChange({ groups: [{ number: 2, title: "Two", tasks: [] }, { number: 3, title: "Three", tasks: [] }] }) };
		expect(coversEveryGroup(missing, converged)).toBe(false);
	});
});

describe("Archive folds a converged change, guarded", () => {
	it("Scenario: The durable baseline's archive", () => {
		const dir = "openspec/changes/archive/2026-10-11-baseline-agentscript-durable/specs";
		const specFiles = (sub: string): string[] =>
			readdirSync(join(ROOT, sub), { withFileTypes: true }).flatMap((entry) =>
				entry.isDirectory() ? specFiles(`${sub}/${entry.name}`) : entry.name === "spec.md" ? [`${sub}/${entry.name}`] : [],
			);
		const files = specFiles(dir);
		const specsUpdated = files.map((file) => file.slice(dir.length + 1, -"/spec.md".length).split("/"));
		const added = files.reduce((sum, file) => sum + (read(file).match(/^### Requirement:/gm)?.length ?? 0), 0);
		const result: ArchiveResult = {
			archivedAs: "2026-10-11-baseline-agentscript-durable",
			totals: { added, modified: 0, removed: 0, renamed: 0 },
			specsUpdated,
		};
		expect(check(ArchiveResult, result)).toBe(true);
		expect(result.totals.added).toBe(140);
		expect(result.specsUpdated).toHaveLength(9);
		for (const file of files) expect(read(file)).not.toMatch(/^## (MODIFIED|REMOVED|RENAMED) Requirements/m);
	});

	it("Scenario: An exhausted change is not archived", () => {
		const result = archiveGuard({ change: { ...demoChange(), state: "converged" }, outcome: exhausted }, VALID);
		expect(result.ok).toBe(false);
		expect(!result.ok && result.failure).toMatchObject({ step: "archive", kind: "refused" });
	});
});

describe("A change moves through a fixed sequence of states", () => {
	it("Scenario: The forward path", () => {
		let state: ChangeState = "drafting";
		const visited: ChangeState[] = [state];
		for (const event of FORWARD_EVENTS) {
			const result = transition(state, event);
			expect(result.ok, `${event.on} from ${state}`).toBe(true);
			if (result.ok) state = result.state;
			visited.push(state);
		}
		expect(visited).toEqual(["drafting", "designed", "specified", "planned", "validated", "approved", "executing", "converged", "archived"]);
	});

	it("Scenario: A new change starts drafting", () => {
		const change = newChange("add-openspec-ontology", "spec-driven", OWN_PROPOSAL);
		expect(change.state).toBe("drafting");
		expect(check(openspec.Change, change)).toBe(true);
		for (const state of ALL_STATES) {
			for (const event of ALL_EVENTS) {
				const result = transition(state, event);
				expect(result.ok && result.state === "drafting", `${state} --${event.on}--> drafting`).toBe(false);
			}
		}
	});
});

describe("Each forward transition follows its step", () => {
	it("Scenario: Skipping planning is refused", () => {
		expect(transition("specified", { on: "validate", report: VALID }).ok).toBe(false);
		// Exactly the defined transitions are allowed, and nothing else.
		const allowed = new Set([
			"drafting:design",
			"designed:specify",
			"specified:plan",
			"planned:validate",
			"amended:validate",
			"validated:approve",
			"approved:execute",
			"executing:converge",
			"executing:amend",
			"converged:archive",
			...ALL_STATES.filter((s) => s !== "archived" && s !== "abandoned").map((s) => `${s}:abandon`),
		]);
		for (const state of ALL_STATES) {
			for (const event of ALL_EVENTS) {
				expect(transition(state, event).ok, `${state}:${event.on}`).toBe(allowed.has(`${state}:${event.on}`));
			}
		}
		// A step whose guard fails does not move the change.
		expect(transition("planned", { on: "validate", report: INVALID }).ok).toBe(false);
	});

	it("Scenario: Specifying before designing is refused", () => {
		expect(transition("drafting", { on: "specify", deltas: demoChange().deltas }).ok).toBe(false);
		expect(transition("drafting", { on: "design", design: DESIGN })).toEqual({ ok: true, state: "designed" });
	});
});

describe("Execution needs approval", () => {
	it("Scenario: Executing without approval is refused", () => {
		expect(transition("validated", { on: "execute" }).ok).toBe(false);
		expect(transition("validated", { on: "approve", approval: { ...APPROVAL, approved: false } }).ok).toBe(false);
		expect(transition("validated", { on: "approve", approval: APPROVAL })).toEqual({ ok: true, state: "approved" });
	});
});

describe("Archiving needs convergence and a fresh valid report", () => {
	it("Scenario: A stale report does not license archive", () => {
		const stale: ChangeEvent = { on: "archive", report: VALID, reportedAt: "2026-10-11T09:00:00Z", convergedAt: "2026-10-11T10:00:00Z" };
		expect(transition("converged", stale).ok).toBe(false);
		expect(transition("converged", { ...stale, reportedAt: "2026-10-11T10:00:00Z" }).ok).toBe(false);
		expect(transition("converged", { ...stale, reportedAt: "2026-10-11T11:00:00Z" })).toEqual({ ok: true, state: "archived" });
		expect(transition("executing", { on: "converge", outcome: exhausted }).ok).toBe(false);
	});
});

describe("A spec defect sends the change back through amendment", () => {
	it("Scenario: An amendment is re-approved", () => {
		expect(transition("executing", { on: "amend", finding: finding("code-defect") }).ok).toBe(false);
		expect(transition("executing", { on: "amend", finding: finding("spec-defect") })).toEqual({ ok: true, state: "amended" });
		expect(transition("amended", { on: "validate", report: INVALID }).ok).toBe(false);
		const validated = transition("amended", { on: "validate", report: VALID });
		expect(validated).toEqual({ ok: true, state: "validated" });
		// From validated again, execution needs a new approval.
		expect(transition("validated", { on: "execute" }).ok).toBe(false);
		expect(transition("amended", { on: "approve", approval: APPROVAL }).ok).toBe(false);
		expect(transition("validated", { on: "approve", approval: APPROVAL })).toEqual({ ok: true, state: "approved" });
	});
});

describe("Any change may be abandoned", () => {
	it("Scenario: An archived change cannot be abandoned", () => {
		expect(transition("archived", { on: "abandon" }).ok).toBe(false);
		expect(transition("abandoned", { on: "abandon" }).ok).toBe(false);
		for (const state of ALL_STATES.filter((s) => s !== "archived" && s !== "abandoned")) {
			expect(transition(state, { on: "abandon" }), state).toEqual({ ok: true, state: "abandoned" });
		}
	});
});
