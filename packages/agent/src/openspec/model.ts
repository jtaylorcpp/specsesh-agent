/**
 * The taxonomy (`openspec/model`): the typed nouns a change is made of.
 *
 * Nothing here reads a file. These are the shapes a parser would produce and a
 * runner would consume; the functions are pure rules over typed values.
 */

import { z } from "zod";
import { Name, closed, literals, sameValue } from "./schema.js";

// ── Root and capabilities ───────────────────────────────────────────────────

export const Root = closed({ specsDir: Name(), changesDir: Name(), schema: Name() });
export type Root = z.infer<typeof Root>;

/** One directory segment per element; a segment never holds `/`, so the serialised form is unambiguous. */
export const CapabilityPath = z.array(z.string().regex(/^[^/]+$/)).min(1);
export type CapabilityPath = z.infer<typeof CapabilityPath>;

export const Clause = closed({ keyword: literals("GIVEN", "WHEN", "THEN", "AND"), text: z.string() });
export type Clause = z.infer<typeof Clause>;

const hasKeyword = (keyword: string) => ({ contains: { type: "object", properties: { keyword: { const: keyword } } } });

/** A scenario has a `WHEN` and a `THEN`. JSON Schema can say this too (`contains`), so the metadata states it there. */
export const Scenario = closed({
	name: Name(),
	clauses: z
		.array(Clause)
		.min(1)
		.superRefine((clauses, ctx) => {
			for (const keyword of ["WHEN", "THEN"]) {
				if (!clauses.some((clause) => clause.keyword === keyword)) ctx.addIssue({ code: "custom", message: `no ${keyword} clause` });
			}
		})
		.meta({ allOf: [hasKeyword("WHEN"), hasKeyword("THEN")] }),
});
export type Scenario = z.infer<typeof Scenario>;

export const Requirement = closed({
	name: Name(),
	text: z.string().regex(/SHALL|MUST/),
	scenarios: z.array(Scenario).min(1),
});
export type Requirement = z.infer<typeof Requirement>;

export const Capability = closed({ path: CapabilityPath, purpose: z.string(), requirements: z.array(Requirement) });
export type Capability = z.infer<typeof Capability>;

// ── References ──────────────────────────────────────────────────────────────

export const RequirementRef = closed({ capability: CapabilityPath, requirement: Name() });
export type RequirementRef = z.infer<typeof RequirementRef>;

export const ScenarioRef = closed({ capability: CapabilityPath, requirement: Name(), scenario: Name() });
export type ScenarioRef = z.infer<typeof ScenarioRef>;

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

export const TaskId = z.string().regex(/^[1-9][0-9]*\.[1-9][0-9]*$/);
export type TaskId = z.infer<typeof TaskId>;

/** Strongest first. */
export const LINK_BASES = ["scenario-named", "requirement-named", "capability-named", "file-overlap", "inferred"] as const;

export const LinkBasis = literals(...LINK_BASES);
export type LinkBasis = z.infer<typeof LinkBasis>;

/** Negative when `a` is the stronger basis, positive when weaker, 0 when the same. */
export const compareBasis = (a: LinkBasis, b: LinkBasis): number => LINK_BASES.indexOf(a) - LINK_BASES.indexOf(b);

const LinkTarget = z.union([RequirementRef, ScenarioRef]);

/** An exact name is certain (confidence 1); anything weaker is less than certain. */
export const TaskLink = z.union([
	closed({ target: LinkTarget, basis: literals("scenario-named", "requirement-named"), confidence: z.literal(1) }),
	closed({
		target: LinkTarget,
		basis: literals("capability-named", "file-overlap", "inferred"),
		confidence: z.number().min(0).lt(1),
	}),
]);
export type TaskLink = z.infer<typeof TaskLink>;

export const Task = closed({
	id: TaskId,
	text: z.string(),
	done: z.boolean(),
	files: z.array(z.string()),
	links: z.array(TaskLink),
});
export type Task = z.infer<typeof Task>;

export const TaskGroup = closed({ number: z.int().min(1), title: z.string(), tasks: z.array(Task) }).superRefine((group, ctx) => {
	for (const task of group.tasks) {
		if (!task.id.startsWith(`${group.number}.`)) {
			ctx.addIssue({ code: "custom", message: `task ${task.id} does not start with its group's number ${group.number}` });
		}
	}
});
export type TaskGroup = z.infer<typeof TaskGroup>;

/** Non-empty: a change with no tasks yet has no task list at all. */
export const TaskList = closed({ groups: z.array(TaskGroup).min(1) }).superRefine((list, ctx) => {
	if (!list.groups.every((group, i) => i === 0 || group.number > list.groups[i - 1]!.number)) {
		ctx.addIssue({ code: "custom", message: "group numbers are not unique and ascending" });
	}
});
export type TaskList = z.infer<typeof TaskList>;

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
export type ChangeState = z.infer<typeof ChangeState>;

export const Proposal = closed({
	why: z.string(),
	whatChanges: z.array(z.string()),
	capabilities: closed({ new: z.array(CapabilityPath), modified: z.array(CapabilityPath) }),
	outOfScope: z.array(z.string()),
	impact: z.array(z.string()),
}).superRefine((proposal, ctx) => {
	if (proposal.capabilities.new.some((path) => proposal.capabilities.modified.some((m) => sameValue(path, m)))) {
		ctx.addIssue({ code: "custom", message: "a capability path is both new and modified" });
	}
});
export type Proposal = z.infer<typeof Proposal>;

export const Added = closed({ op: z.literal("ADDED"), capability: CapabilityPath, requirement: Requirement });
export type Added = z.infer<typeof Added>;

export const Modified = closed({ op: z.literal("MODIFIED"), capability: CapabilityPath, requirement: Requirement });
export type Modified = z.infer<typeof Modified>;

export const Removed = closed({
	op: z.literal("REMOVED"),
	capability: CapabilityPath,
	name: Name(),
	reason: Name(),
	migration: Name(),
});
export type Removed = z.infer<typeof Removed>;

export const Renamed = closed({ op: z.literal("RENAMED"), capability: CapabilityPath, from: Name(), to: Name() }).superRefine(
	(renamed, ctx) => {
		if (renamed.from === renamed.to) ctx.addIssue({ code: "custom", message: "a rename's from and to are the same" });
	},
);
export type Renamed = z.infer<typeof Renamed>;

export const Delta = z.union([Added, Modified, Removed, Renamed]);
export type Delta = z.infer<typeof Delta>;

/** Free-form and in source order; no heading is required. Non-empty: a change with no design has none. */
export const Design = closed({ sections: z.array(closed({ heading: z.string(), body: z.string() })).min(1) });
export type Design = z.infer<typeof Design>;

export const Change = closed({
	id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
	schema: Name(),
	proposal: Proposal,
	deltas: z.array(Delta),
	design: Design.optional(),
	tasks: TaskList.optional(),
	state: ChangeState,
});
export type Change = z.infer<typeof Change>;

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
