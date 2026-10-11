/**
 * Evidence (`openspec/evidence`): what a verdict may rest on, the findings a
 * failed check produces, and when evidence satisfies a target.
 */

import { z } from "zod";
import { RequirementRef, ScenarioRef } from "./model.js";
import { Name, closed, literals, sameValue } from "./schema.js";

/** Declared by `openspec/loops`; here because a `Finding` may name one. */
export const Target = z.union([RequirementRef, ScenarioRef, closed({ check: Name() })]);
export type Target = z.infer<typeof Target>;

/** Declared by `openspec/process`; here because `ValidationEvidence` carries one. */
export const ValidationReport = closed({
	valid: z.boolean(),
	issues: z.array(closed({ level: literals("ERROR", "WARNING", "INFO"), path: z.string(), message: z.string() })),
});
export type ValidationReport = z.infer<typeof ValidationReport>;

/** The vitest separator between a describe block and a test in a full test name. */
const NAME_SEPARATOR = " > ";

/** True when a test's name claims the scenario: `Scenario: <exact name>`, alone or as the last segment of its full name. */
export function claims(testName: string, scenarioName: string): boolean {
	const own = testName.split(NAME_SEPARATOR).at(-1);
	return own === `Scenario: ${scenarioName}`;
}

export const TestEvidence = closed({
	kind: z.literal("test"),
	file: Name(),
	name: Name(),
	scenario: ScenarioRef.optional(),
	status: literals("pass", "fail", "skip"),
	message: z.string().optional(),
}).superRefine((evidence, ctx) => {
	if (evidence.scenario !== undefined && !claims(evidence.name, evidence.scenario.scenario)) {
		ctx.addIssue({ code: "custom", message: `test "${evidence.name}" does not carry the exact name of the scenario it names` });
	}
});
export type TestEvidence = z.infer<typeof TestEvidence>;

export const ValidationEvidence = closed({ kind: z.literal("validation"), report: ValidationReport });
export type ValidationEvidence = z.infer<typeof ValidationEvidence>;

export const CheckEvidence = closed({ kind: z.literal("check"), command: Name(), exitCode: z.int(), output: z.string() });
export type CheckEvidence = z.infer<typeof CheckEvidence>;

export const DiffEvidence = closed({
	kind: z.literal("diff"),
	files: z.array(closed({ path: Name(), change: literals("added", "modified", "deleted") })),
});
export type DiffEvidence = z.infer<typeof DiffEvidence>;

export const ReviewEvidence = closed({
	kind: z.literal("review"),
	reviewer: literals("agent", "principal"),
	verdict: literals("approve", "changes"),
	notes: z.string(),
});
export type ReviewEvidence = z.infer<typeof ReviewEvidence>;

export const Evidence = z.union([TestEvidence, ValidationEvidence, CheckEvidence, DiffEvidence, ReviewEvidence]);
export type Evidence = z.infer<typeof Evidence>;

export const FindingKind = literals("code-defect", "spec-defect", "test-defect", "environment", "needs-decision");
export type FindingKind = z.infer<typeof FindingKind>;

/** A finding rests on evidence: `evidence` is never empty. */
export const Finding = closed({
	kind: FindingKind,
	target: Target.optional(),
	evidence: z.array(Evidence).min(1),
	message: z.string(),
});
export type Finding = z.infer<typeof Finding>;

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
