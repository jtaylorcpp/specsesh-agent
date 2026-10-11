/**
 * The taxonomy (`openspec/model`): the typed nouns a change is made of.
 *
 * Nothing here reads a file. These are the shapes a parser would produce and a
 * runner would consume; the functions are pure rules over typed values.
 */

import Type, { type Static } from "typebox";
import { Name, closed, literals, sameValue } from "./schema.js";

// ── Root and capabilities ───────────────────────────────────────────────────

export const Root = closed({ specsDir: Name(), changesDir: Name(), schema: Name() });
export type Root = Static<typeof Root>;

/** One directory segment per element; a segment never holds `/`, so the serialised form is unambiguous. */
export const CapabilityPath = Type.Array(Type.String({ minLength: 1, pattern: "^[^/]+$" }), { minItems: 1 });
export type CapabilityPath = Static<typeof CapabilityPath>;

export const Clause = closed({
	keyword: Type.Union([Type.Literal("GIVEN"), Type.Literal("WHEN"), Type.Literal("THEN"), Type.Literal("AND")]),
	text: Type.String(),
});
export type Clause = Static<typeof Clause>;

const hasKeyword = (keyword: string) => ({ contains: { type: "object", properties: { keyword: { const: keyword } } } });

export const Scenario = closed({
	name: Name(),
	clauses: Type.Array(Clause, { minItems: 1, allOf: [hasKeyword("WHEN"), hasKeyword("THEN")] }),
});
export type Scenario = Static<typeof Scenario>;

export const Requirement = closed({
	name: Name(),
	text: Type.String({ pattern: "SHALL|MUST" }),
	scenarios: Type.Array(Scenario, { minItems: 1 }),
});
export type Requirement = Static<typeof Requirement>;

export const Capability = closed({ path: CapabilityPath, purpose: Type.String(), requirements: Type.Array(Requirement) });
export type Capability = Static<typeof Capability>;

// ── References ──────────────────────────────────────────────────────────────

export const RequirementRef = closed({ capability: CapabilityPath, requirement: Name() });
export type RequirementRef = Static<typeof RequirementRef>;

export const ScenarioRef = closed({ capability: CapabilityPath, requirement: Name(), scenario: Name() });
export type ScenarioRef = Static<typeof ScenarioRef>;

/** Space, U+203A, space. */
export const REF_SEPARATOR = " › ";

/** `durable/run-task`, `durable/run-task › <requirement>` or `durable/run-task › <requirement> › <scenario>`. */
export function formatRef(ref: CapabilityPath | RequirementRef | ScenarioRef): string {
	if (Array.isArray(ref)) return ref.join("/");
	const parts = [ref.capability.join("/"), ref.requirement];
	if ("scenario" in ref) parts.push(ref.scenario);
	return parts.join(REF_SEPARATOR);
}

/** The reference `formatRef` wrote, or `undefined` when the text is not one. */
export function parseRef(text: string): CapabilityPath | RequirementRef | ScenarioRef | undefined {
	const [path, requirement, scenario, ...rest] = text.split(REF_SEPARATOR);
	if (rest.length > 0 || path === undefined) return undefined;
	const capability = path.split("/");
	if (capability.some((segment) => segment.length === 0)) return undefined;
	if (requirement === undefined) return capability;
	if (requirement.length === 0) return undefined;
	if (scenario === undefined) return { capability, requirement };
	return scenario.length === 0 ? undefined : { capability, requirement, scenario };
}

// ── Task lists ──────────────────────────────────────────────────────────────

export const TaskId = Type.String({ pattern: "^[1-9][0-9]*\\.[1-9][0-9]*$" });
export type TaskId = Static<typeof TaskId>;

/** Strongest first. */
export const LINK_BASES = ["scenario-named", "requirement-named", "capability-named", "file-overlap", "inferred"] as const;

export const LinkBasis = literals(...LINK_BASES);
export type LinkBasis = Static<typeof LinkBasis>;

/** Negative when `a` is the stronger basis, positive when weaker, 0 when the same. */
export const compareBasis = (a: LinkBasis, b: LinkBasis): number => LINK_BASES.indexOf(a) - LINK_BASES.indexOf(b);

const LinkTarget = Type.Union([RequirementRef, ScenarioRef]);

/** An exact name is certain (confidence 1); anything weaker is less than certain. */
export const TaskLink = Type.Union([
	closed({
		target: LinkTarget,
		basis: Type.Union([Type.Literal("scenario-named"), Type.Literal("requirement-named")]),
		confidence: Type.Literal(1),
	}),
	closed({
		target: LinkTarget,
		basis: Type.Union([Type.Literal("capability-named"), Type.Literal("file-overlap"), Type.Literal("inferred")]),
		confidence: Type.Number({ minimum: 0, exclusiveMaximum: 1 }),
	}),
]);
export type TaskLink = Static<typeof TaskLink>;

export const Task = closed({
	id: TaskId,
	text: Type.String(),
	done: Type.Boolean(),
	files: Type.Array(Type.String()),
	links: Type.Array(TaskLink),
});
export type Task = Static<typeof Task>;

export const TaskGroup = Type.Refine(
	closed({ number: Type.Integer({ minimum: 1 }), title: Type.String(), tasks: Type.Array(Task) }),
	(group) => group.tasks.every((task) => task.id.startsWith(`${group.number}.`)),
	(group) => `a task id does not start with its group's number ${group.number}`,
);
export type TaskGroup = Static<typeof TaskGroup>;

/** Non-empty: a change with no tasks yet has no task list at all. */
export const TaskList = Type.Refine(
	closed({ groups: Type.Array(TaskGroup, { minItems: 1 }) }),
	(list) => list.groups.every((group, i) => i === 0 || group.number > list.groups[i - 1]!.number),
	() => "group numbers are not unique and ascending",
);
export type TaskList = Static<typeof TaskList>;

// ── Changes ─────────────────────────────────────────────────────────────────

/** Declared by `openspec/process`; here because `Change` carries it. */
export const ChangeState = literals(
	"drafting",
	"specified",
	"designed",
	"planned",
	"validated",
	"approved",
	"executing",
	"converged",
	"archived",
	"amended",
	"abandoned",
);
export type ChangeState = Static<typeof ChangeState>;

export const Proposal = Type.Refine(
	closed({
		why: Type.String(),
		whatChanges: Type.Array(Type.String()),
		capabilities: closed({ new: Type.Array(CapabilityPath), modified: Type.Array(CapabilityPath) }),
		outOfScope: Type.Array(Type.String()),
		impact: Type.Array(Type.String()),
	}),
	(proposal) => !proposal.capabilities.new.some((path) => proposal.capabilities.modified.some((m) => sameValue(path, m))),
	() => "a capability path is both new and modified",
);
export type Proposal = Static<typeof Proposal>;

export const Added = closed({ op: Type.Literal("ADDED"), capability: CapabilityPath, requirement: Requirement });
export type Added = Static<typeof Added>;

export const Modified = closed({ op: Type.Literal("MODIFIED"), capability: CapabilityPath, requirement: Requirement });
export type Modified = Static<typeof Modified>;

export const Removed = closed({
	op: Type.Literal("REMOVED"),
	capability: CapabilityPath,
	name: Name(),
	reason: Name(),
	migration: Name(),
});
export type Removed = Static<typeof Removed>;

export const Renamed = Type.Refine(
	closed({ op: Type.Literal("RENAMED"), capability: CapabilityPath, from: Name(), to: Name() }),
	(renamed) => renamed.from !== renamed.to,
	() => "a rename's from and to are the same",
);
export type Renamed = Static<typeof Renamed>;

export const Delta = Type.Union([Added, Modified, Removed, Renamed]);
export type Delta = Static<typeof Delta>;

/** Free-form and in source order; no heading is required. Non-empty: a change with no design has none. */
export const Design = closed({
	sections: Type.Array(closed({ heading: Type.String(), body: Type.String() }), { minItems: 1 }),
});
export type Design = Static<typeof Design>;

export const Change = closed({
	id: Type.String({ pattern: "^[a-z0-9]+(-[a-z0-9]+)*$" }),
	schema: Name(),
	proposal: Proposal,
	deltas: Type.Array(Delta),
	design: Type.Optional(Design),
	tasks: Type.Optional(TaskList),
	state: ChangeState,
});
export type Change = Static<typeof Change>;

/**
 * A delta applied to the capability it names. `MODIFIED` replaces the whole
 * requirement of the same name, scenarios included. Throws when the delta names
 * another capability or a requirement the capability does not have.
 */
export function applyDelta(capability: Capability, delta: Delta): Capability {
	if (!sameValue(capability.path, delta.capability)) {
		throw new Error(`delta for ${formatRef(delta.capability)} applied to ${formatRef(capability.path)}`);
	}
	const index = (name: string) => {
		const i = capability.requirements.findIndex((requirement) => requirement.name === name);
		if (i < 0) throw new Error(`${formatRef(capability.path)} has no requirement "${name}"`);
		return i;
	};
	const requirements = [...capability.requirements];
	switch (delta.op) {
		case "ADDED":
			requirements.push(delta.requirement);
			break;
		case "MODIFIED":
			requirements[index(delta.requirement.name)] = delta.requirement;
			break;
		case "REMOVED":
			requirements.splice(index(delta.name), 1);
			break;
		case "RENAMED":
			requirements[index(delta.from)] = { ...requirements[index(delta.from)]!, name: delta.to };
			break;
	}
	return { ...capability, requirements };
}

/** Every scenario a delta carries, as references. */
export function deltaScenarios(change: Change): ScenarioRef[] {
	return change.deltas.flatMap((delta) =>
		delta.op === "ADDED" || delta.op === "MODIFIED"
			? delta.requirement.scenarios.map((scenario) => ({
					capability: delta.capability,
					requirement: delta.requirement.name,
					scenario: scenario.name,
				}))
			: [],
	);
}

/**
 * The delta scenarios no task claims. A scenario is claimed by a
 * `scenario-named` link to it, or a `requirement-named` link to its
 * requirement; weaker links never claim.
 */
export function unclaimedScenarios(change: Change): ScenarioRef[] {
	const links = (change.tasks?.groups ?? []).flatMap((group) => group.tasks.flatMap((task) => task.links));
	const claims = (ref: ScenarioRef) =>
		links.some((link) =>
			link.basis === "scenario-named"
				? sameValue(link.target, ref)
				: link.basis === "requirement-named" &&
					!("scenario" in link.target) &&
					sameValue(link.target, { capability: ref.capability, requirement: ref.requirement }),
		);
	return deltaScenarios(change).filter((ref) => !claims(ref));
}
