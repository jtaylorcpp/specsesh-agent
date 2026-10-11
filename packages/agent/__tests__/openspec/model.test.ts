import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	Capability,
	CapabilityPath,
	Change,
	Clause,
	Design,
	Modified,
	Proposal,
	Removed,
	Renamed,
	Requirement,
	Root,
	Scenario,
	TaskGroup,
	TaskId,
	TaskLink,
	TaskList,
	type LinkBasis,
	LINK_BASES,
	applyDelta,
	check,
	compareBasis,
	formatRef,
	parseRef,
	unclaimedScenarios,
} from "../../src/openspec/index.js";
import {
	OWN_PROPOSAL,
	ROOT,
	RUN_TASK,
	STEP_REF,
	STEP_REQUIREMENT,
	STEP_SCENARIO,
	THREE,
	demoChange,
	read,
	task,
	threeRef,
} from "./fixtures.js";

describe("Every model type has a static type and a JSON Schema", () => {
	it("Scenario: A schema rejects what the static type rejects", () => {
		// @ts-expect-error the static type refuses "BUT" as a keyword
		const but: Clause = { keyword: "BUT", text: "x" };
		expect(check(Clause, but)).toBe(false);
		expect(check(Clause, { keyword: "AND", text: "x" })).toBe(true);
	});
	// "Scenario: Every type has a schema" is in schema-agreement.test.ts, with the fixture checks.
});

describe("Root locates a planning home", () => {
	it("Scenario: This repository's root", () => {
		const root: Root = { specsDir: "openspec/specs", changesDir: "openspec/changes", schema: "spec-driven" };
		expect(check(Root, root)).toBe(true);
		expect(existsSync(join(ROOT, root.specsDir))).toBe(true);
		expect(existsSync(join(ROOT, root.changesDir))).toBe(true);
		// The schema OpenSpec is configured with.
		expect(read("openspec/config.yaml").split("\n")).toContain(`schema: ${root.schema}`);
	});
});

describe("A capability is a path, a purpose and its requirements", () => {
	it("Scenario: A nested capability path", () => {
		expect(check(Capability, RUN_TASK)).toBe(true);
		expect(RUN_TASK.path).toEqual(["durable", "run-task"]);
		expect(existsSync(join(ROOT, "openspec/specs", ...RUN_TASK.path, "spec.md"))).toBe(true);
	});

	it("Scenario: An empty path is not a capability path", () => {
		expect(check(CapabilityPath, [])).toBe(false);
		expect(check(CapabilityPath, ["durable", ""])).toBe(false);
		expect(check(CapabilityPath, ["durable"])).toBe(true);
	});
});

describe("A requirement is a name, normative text and its scenarios", () => {
	it("Scenario: A requirement without a scenario is not a requirement", () => {
		expect(check(Requirement, { name: "x", text: "The system SHALL x.", scenarios: [] })).toBe(false);
		expect(check(Requirement, { name: "x", text: "The system SHALL x.", scenarios: [STEP_SCENARIO] })).toBe(true);
	});

	it("Scenario: Text without a normative keyword is refused", () => {
		expect(check(Requirement, { ...STEP_REQUIREMENT, text: "The system should do x." })).toBe(false);
		expect(check(Requirement, { ...STEP_REQUIREMENT, text: "The system MUST do x." })).toBe(true);
	});
});

describe("A scenario is a name and ordered clauses", () => {
	it("Scenario: A scenario from this repository", () => {
		expect(check(Scenario, STEP_SCENARIO)).toBe(true);
		expect(STEP_SCENARIO.clauses.map((clause) => clause.keyword)).toEqual(["WHEN", "THEN"]);
		// The text after each bold keyword, exactly as the spec writes it.
		const spec = read("openspec/specs/durable/run-task/spec.md");
		const block = spec.slice(spec.indexOf(`#### Scenario: ${STEP_SCENARIO.name}`)).split("\n\n")[0]!;
		expect(block.split("\n").slice(1)).toEqual(STEP_SCENARIO.clauses.map((c) => `- **${c.keyword}** ${c.text}`));
	});

	it("Scenario: A scenario with no THEN is refused", () => {
		const clauses: Clause[] = [
			{ keyword: "GIVEN", text: "a thing" },
			{ keyword: "WHEN", text: "it happens" },
		];
		expect(check(Scenario, { name: "no then", clauses })).toBe(false);
		expect(check(Scenario, { name: "then", clauses: [...clauses, { keyword: "THEN", text: "it holds" }] })).toBe(true);
	});
});

describe("A change gathers its artifacts and its state", () => {
	it("Scenario: A change still being planned", () => {
		const planning = { ...demoChange(), state: "specified" };
		expect(check(Change, planning)).toBe(true);
		expect("design" in planning).toBe(false);
		expect("tasks" in planning).toBe(false);
		// Empty values are not how absence is written.
		expect(check(Change, { ...planning, design: { sections: [] } })).toBe(false);
		expect(check(Change, { ...planning, tasks: { groups: [] } })).toBe(false);
		expect(check(Change, { ...planning, design: null })).toBe(false);
	});

	it("Scenario: A non-kebab-case id is refused", () => {
		expect(check(Change, { ...demoChange(), id: "Add_Thing" })).toBe(false);
		expect(check(Change, { ...demoChange(), id: "add-thing" })).toBe(true);
	});
});

describe("A proposal states why, what, which capabilities and what not", () => {
	it("Scenario: This change's own proposal", () => {
		expect(check(Proposal, OWN_PROPOSAL)).toBe(true);
		expect(OWN_PROPOSAL.capabilities.modified).toEqual([]);
		// The proposal names the four new capabilities.
		const proposal = read("openspec/changes/add-openspec-ontology/proposal.md");
		for (const path of OWN_PROPOSAL.capabilities.new) expect(proposal).toContain(`\`${formatRef(path)}\``);
	});

	it("Scenario: A path both new and modified is refused", () => {
		const both = { ...OWN_PROPOSAL, capabilities: { new: [["core", "subset"]], modified: [["core", "subset"]] } };
		expect(check(Proposal, both)).toBe(false);
		expect(check(Proposal, { ...both, capabilities: { new: [["core", "subset"]], modified: [["core", "authoring"]] } })).toBe(true);
	});
});

describe("A delta is one of four operations on one capability", () => {
	it("Scenario: A modified delta carries the whole requirement", () => {
		const base: Capability = {
			path: ["pi", "cli"],
			purpose: "The CLI.",
			requirements: [THREE, STEP_REQUIREMENT],
		};
		const replacement: Requirement = {
			name: THREE.name,
			text: "The thing SHALL hold one way.",
			scenarios: [THREE.scenarios[0]!],
		};
		const delta: Modified = { op: "MODIFIED", capability: ["pi", "cli"], requirement: replacement };
		expect(check(Modified, delta)).toBe(true);
		const applied = applyDelta(base, delta);
		expect(applied.requirements).toEqual([replacement, STEP_REQUIREMENT]);
		// Nothing of the old requirement survives: its other two scenarios are gone.
		expect(applied.requirements[0]!.scenarios.map((s) => s.name)).toEqual(["one"]);
		expect(() => applyDelta(base, { ...delta, requirement: { ...replacement, name: "Absent" } })).toThrow(/no requirement "Absent"/);
	});
});

describe("Removal and renaming carry their own fields", () => {
	it("Scenario: The packaging change removes the tsx bin requirement", () => {
		const name = "The bin runs the TypeScript CLI through tsx";
		const delta = read("openspec/changes/archive/2026-10-11-package-specsesh-agent/specs/pi/cli/spec.md");
		const removed = delta.slice(delta.indexOf("## REMOVED Requirements"));
		expect(removed).toContain(`### Requirement: ${name}`);
		const reason = /\*\*Reason\*\*: (.+)/.exec(removed)?.[1];
		const migration = /\*\*Migration\*\*: (.+)/.exec(removed)?.[1];
		const value: Removed = { op: "REMOVED", capability: ["pi", "cli"], name, reason: reason!, migration: migration! };
		expect(check(Removed, value)).toBe(true);
		expect(check(Removed, { ...value, reason: "" })).toBe(false);
		expect(check(Removed, { ...value, migration: "" })).toBe(false);
	});

	it("Scenario: A rename to the same name is refused", () => {
		const renamed: Renamed = { op: "RENAMED", capability: ["pi", "cli"], from: "Old", to: "Old" };
		expect(check(Renamed, renamed)).toBe(false);
		expect(check(Renamed, { ...renamed, to: "New" })).toBe(true);
	});
});

describe("A design is free-form sections", () => {
	it("Scenario: A design with custom headings is valid", () => {
		const design: Design = {
			sections: ["Context", "Two halves", "Risks and gaps"].map((heading) => ({ heading, body: "…" })),
		};
		expect(check(Design, design)).toBe(true);
	});
});

describe("A task list is numbered groups of tasks", () => {
	it("Scenario: A group heading from this repository", () => {
		const heading = "## 2. Durable: tests for scenarios with none today";
		expect(read("openspec/changes/archive/2026-10-11-baseline-agentscript-durable/tasks.md").split("\n")).toContain(heading);
		const group: TaskGroup = { number: 2, title: "Durable: tests for scenarios with none today", tasks: [task("2.4")] };
		expect(check(TaskGroup, group)).toBe(true);
		expect(`## ${group.number}. ${group.title}`).toBe(heading);
		// Numbers are positive, unique and ascending.
		expect(check(TaskList, { groups: [group, { ...group, number: 3, tasks: [] }] })).toBe(true);
		expect(check(TaskList, { groups: [group, { ...group, tasks: [] }] })).toBe(false);
		expect(check(TaskGroup, { ...group, number: 0, tasks: [] })).toBe(false);
	});
});

describe("A task has an id, text, a done flag, files and links", () => {
	it("Scenario: Task 2.4 of the durable baseline", () => {
		const line = read("openspec/changes/archive/2026-10-11-baseline-agentscript-durable/tasks.md")
			.split("\n")
			.find((l) => l.startsWith("- [x] 2.4 "))!;
		expect(line).toContain("`packages/agentscript-durable/__tests__/cli.test.ts`: no command, ");
		const value = { ...task("2.4", [], true), text: line, files: ["packages/agentscript-durable/__tests__/cli.test.ts"] };
		expect(check(TaskGroup, { number: 2, title: "Durable", tasks: [value] })).toBe(true);
		expect(value).toMatchObject({ id: "2.4", done: true, files: ["packages/agentscript-durable/__tests__/cli.test.ts"] });
	});
});

describe("A task id is its group number and its position", () => {
	it("Scenario: An id outside its group is refused", () => {
		const list: TaskList = { groups: [{ number: 2, title: "Two", tasks: [task("3.1")] }] };
		expect(check(TaskList, list)).toBe(false);
		expect(check(TaskList, { groups: [{ number: 2, title: "Two", tasks: [task("2.1")] }] })).toBe(true);
	});

	it("Scenario: A malformed id is refused", () => {
		for (const id of ["2", "2.0", "two.1"]) expect(check(TaskId, id), id).toBe(false);
		for (const id of ["2.4", "10.12"]) expect(check(TaskId, id), id).toBe(true);
	});
});

describe("A task link targets a requirement or a scenario", () => {
	it("Scenario: A link to a scenario", () => {
		const link: TaskLink = { target: STEP_REF, basis: "scenario-named", confidence: 1 };
		expect(check(TaskLink, link)).toBe(true);
		expect(link.target).toEqual({
			capability: ["durable", "run-task"],
			requirement: "The step number is the index of the step being run",
			scenario: "The first and second model steps are numbered 0 and 1",
		});
		// The scenario is under that requirement in the spec.
		const spec = read("openspec/specs/durable/run-task/spec.md");
		const at = spec.indexOf(`### Requirement: ${STEP_REF.requirement}`);
		expect(at).toBeGreaterThan(-1);
		expect(spec.indexOf(`#### Scenario: ${STEP_REF.scenario}`)).toBeGreaterThan(at);
		expect(spec.indexOf("### Requirement:", at + 1)).toBeGreaterThan(spec.indexOf(`#### Scenario: ${STEP_REF.scenario}`));
	});

	it("Scenario: Confidence outside the unit interval is refused", () => {
		expect(check(TaskLink, { target: STEP_REF, basis: "inferred", confidence: 1.5 })).toBe(false);
		expect(check(TaskLink, { target: STEP_REF, basis: "inferred", confidence: -0.1 })).toBe(false);
		expect(check(TaskLink, { target: STEP_REF, basis: "inferred", confidence: 0 })).toBe(true);
	});
});

describe("References serialise to one line of text", () => {
	it("Scenario: A scenario reference as text", () => {
		expect(formatRef(STEP_REF)).toBe(
			"durable/run-task › The step number is the index of the step being run › The first and second model steps are numbered 0 and 1",
		);
		expect(formatRef(STEP_REF)).toContain(" › ");
	});

	it("Scenario: Round trip", () => {
		const text = "durable/run-task › The step number is the index of the step being run";
		const ref = parseRef(text);
		expect(ref).toEqual({ capability: ["durable", "run-task"], requirement: STEP_REF.requirement });
		expect(formatRef(ref!)).toBe(text);
		// And the other two shapes.
		expect(formatRef(parseRef("durable/run-task")!)).toBe("durable/run-task");
		expect(parseRef(formatRef(STEP_REF))).toEqual(STEP_REF);
		for (const bad of ["", "durable//run-task", "a › ", "a › b › c › d"]) expect(parseRef(bad), bad).toBeUndefined();
	});
});

describe("A link records how it was inferred, strongest first", () => {
	it("Scenario: Bases are ordered", () => {
		expect(LINK_BASES).toEqual(["scenario-named", "requirement-named", "capability-named", "file-overlap", "inferred"]);
		const ranked = [...LINK_BASES].reverse().sort(compareBasis);
		expect(ranked).toEqual([...LINK_BASES]);
		for (let i = 1; i < LINK_BASES.length; i++) {
			expect(compareBasis(LINK_BASES[i - 1] as LinkBasis, LINK_BASES[i] as LinkBasis)).toBeLessThan(0);
		}
	});
});

describe("An exact name has confidence 1", () => {
	it("Scenario: A file-overlap link is less than certain", () => {
		expect(check(TaskLink, { target: STEP_REF, basis: "file-overlap", confidence: 1 })).toBe(false);
		expect(check(TaskLink, { target: STEP_REF, basis: "file-overlap", confidence: 0.6 })).toBe(true);
	});

	it("Scenario: An exact scenario name is certain", () => {
		expect(check(TaskLink, { target: STEP_REF, basis: "scenario-named", confidence: 0.8 })).toBe(false);
		expect(check(TaskLink, { target: STEP_REF, basis: "requirement-named", confidence: 0.8 })).toBe(false);
	});
});

describe("An unclaimed scenario is a coverage gap", () => {
	it("Scenario: A file-overlap link does not claim", () => {
		const change = demoChange({
			groups: [{ number: 1, title: "One", tasks: [task("1.3", [{ target: threeRef("one"), basis: "file-overlap", confidence: 0.5 }])] }],
		});
		expect(unclaimedScenarios(change)).toContainEqual(threeRef("one"));
		// A scenario-named link to it would claim it.
		const named = demoChange({
			groups: [{ number: 1, title: "One", tasks: [task("1.3", [{ target: threeRef("one"), basis: "scenario-named", confidence: 1 }])] }],
		});
		expect(unclaimedScenarios(named)).not.toContainEqual(threeRef("one"));
		expect(unclaimedScenarios(named)).toHaveLength(2);
	});

	it("Scenario: A requirement-named link claims every scenario of it", () => {
		const change = demoChange({
			groups: [
				{
					number: 1,
					title: "One",
					tasks: [task("1.1", [{ target: { capability: ["demo", "three"], requirement: THREE.name }, basis: "requirement-named", confidence: 1 }])],
				},
			],
		});
		expect(check(Change, change)).toBe(true);
		expect(THREE.scenarios).toHaveLength(3);
		expect(unclaimedScenarios(change)).toEqual([]);
		// With no tasks, all three are unclaimed.
		expect(unclaimedScenarios(demoChange())).toEqual(["one", "two", "three"].map(threeRef));
	});
});
