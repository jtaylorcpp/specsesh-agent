/**
 * Evidence (`openspec/evidence`): what a verdict may rest on, the findings a
 * failed check produces, and when evidence satisfies a target.
 */

import Type, { type Static } from "typebox";
import { RequirementRef, ScenarioRef } from "./model.js";
import { Int, Name, closed, literals, sameValue } from "./schema.js";

/** Declared by `openspec/loops`; here because a `Finding` may name one. */
export const Target = Type.Union([RequirementRef, ScenarioRef, closed({ check: Name() })]);
export type Target = Static<typeof Target>;

/** Declared by `openspec/process`; here because `ValidationEvidence` carries one. */
export const ValidationReport = closed({
	valid: Type.Boolean(),
	issues: Type.Array(closed({ level: literals("ERROR", "WARNING", "INFO"), path: Type.String(), message: Type.String() })),
});
export type ValidationReport = Static<typeof ValidationReport>;

/** The vitest separator between a describe block and a test in a full test name. */
const NAME_SEPARATOR = " > ";

/** True when a test's name claims the scenario: `Scenario: <exact name>`, alone or as the last segment of its full name. */
export function claims(testName: string, scenarioName: string): boolean {
	const own = testName.split(NAME_SEPARATOR).at(-1);
	return own === `Scenario: ${scenarioName}`;
}

export const TestEvidence = Type.Refine(
	closed({
		kind: Type.Literal("test"),
		file: Name(),
		name: Name(),
		scenario: Type.Optional(ScenarioRef),
		status: literals("pass", "fail", "skip"),
		message: Type.Optional(Type.String()),
	}),
	(evidence) => evidence.scenario === undefined || claims(evidence.name, evidence.scenario.scenario),
	(evidence) => `test "${evidence.name}" does not carry the exact name of the scenario it names`,
);
export type TestEvidence = Static<typeof TestEvidence>;

export const ValidationEvidence = closed({ kind: Type.Literal("validation"), report: ValidationReport });
export type ValidationEvidence = Static<typeof ValidationEvidence>;

export const CheckEvidence = closed({ kind: Type.Literal("check"), command: Name(), exitCode: Int(), output: Type.String() });
export type CheckEvidence = Static<typeof CheckEvidence>;

export const DiffEvidence = closed({
	kind: Type.Literal("diff"),
	files: Type.Array(closed({ path: Name(), change: literals("added", "modified", "deleted") })),
});
export type DiffEvidence = Static<typeof DiffEvidence>;

export const ReviewEvidence = closed({
	kind: Type.Literal("review"),
	reviewer: literals("agent", "principal"),
	verdict: literals("approve", "changes"),
	notes: Type.String(),
});
export type ReviewEvidence = Static<typeof ReviewEvidence>;

export const Evidence = Type.Union([TestEvidence, ValidationEvidence, CheckEvidence, DiffEvidence, ReviewEvidence]);
export type Evidence = Static<typeof Evidence>;

export const FindingKind = literals("code-defect", "spec-defect", "test-defect", "environment", "needs-decision");
export type FindingKind = Static<typeof FindingKind>;

/** A finding rests on evidence: `evidence` is never empty. */
export const Finding = closed({
	kind: FindingKind,
	target: Type.Optional(Target),
	evidence: Type.Array(Evidence, { minItems: 1 }),
	message: Type.String(),
});
export type Finding = Static<typeof Finding>;

/**
 * Whether `evidence` satisfies `target`:
 * - a scenario needs a passing test that claims it by its exact name;
 * - a requirement needs every one of its scenarios satisfied;
 * - a named check needs a `CheckEvidence` for that command, exit code 0.
 * A skipped test satisfies nothing, and a check never satisfies a scenario or requirement.
 * `scenariosOf` names a requirement's scenarios (`undefined` when unknown, which satisfies nothing).
 */
export function satisfies(
	target: Target,
	evidence: readonly Evidence[],
	scenariosOf: (ref: RequirementRef) => readonly string[] | undefined = () => undefined,
): boolean {
	if ("check" in target) {
		return evidence.some((item) => item.kind === "check" && item.exitCode === 0 && item.command === target.check);
	}
	if ("scenario" in target) {
		return evidence.some(
			(item) =>
				item.kind === "test" &&
				item.status === "pass" &&
				item.scenario !== undefined &&
				sameValue(item.scenario, target) &&
				claims(item.name, target.scenario),
		);
	}
	const scenarios = scenariosOf(target);
	if (scenarios === undefined || scenarios.length === 0) return false;
	return scenarios.every((scenario) => satisfies({ ...target, scenario }, evidence));
}
