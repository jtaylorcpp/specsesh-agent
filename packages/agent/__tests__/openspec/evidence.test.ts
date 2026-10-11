import { describe, expect, it } from "vitest";
import {
	CheckEvidence,
	Evidence,
	Finding,
	type ScenarioRef,
	TestEvidence,
	check,
	claims,
	feedbackFor,
	satisfies,
	scenariosIn,
} from "../../src/openspec/index.js";
import {
	GREEN_CHECK,
	GREEN_SUITE,
	STEP_REF,
	THREE,
	THREE_CAP,
	fail,
	finding,
	pass,
	read,
	skip,
	threeRef,
} from "./fixtures.js";

describe("Evidence is one of five kinds", () => {
	it("Scenario: An unknown kind is refused", () => {
		expect(check(Evidence, { kind: "vibe", notes: "looks fine" })).toBe(false);
		const kinds: Evidence[] = [
			pass(STEP_REF),
			{ kind: "validation", report: { valid: true, issues: [] } },
			GREEN_CHECK,
			{ kind: "diff", files: [{ path: "src/openspec/model.ts", change: "added" }] },
			{ kind: "review", reviewer: "agent", verdict: "approve", notes: "" },
		];
		for (const item of kinds) expect(check(Evidence, item), item.kind).toBe(true);
	});
});

describe("Test evidence ties a test to a scenario", () => {
	it("Scenario: A passing test from this repository", () => {
		const scenario: ScenarioRef = {
			capability: ["pi", "claude-code"],
			requirement: "The claude-code surface is exported from the root entry",
			scenario: "Argv building and spawning stay module-level",
		};
		const evidence: TestEvidence = {
			kind: "test",
			file: "packages/agentscript-pi/__tests__/claude-code.test.ts",
			name: "Scenario: Argv building and spawning stay module-level",
			scenario,
			status: "pass",
		};
		expect(check(TestEvidence, evidence)).toBe(true);
		// The scenario sits under that requirement in pi/claude-code, and the test exists under that name today.
		const spec = read("openspec/specs/pi/claude-code/spec.md");
		const at = spec.indexOf(`### Requirement: ${scenario.requirement}`);
		expect(at).toBeGreaterThan(-1);
		expect(spec.indexOf(`#### Scenario: ${scenario.scenario}`)).toBeGreaterThan(at);
		expect(read("packages/agent/__tests__/pi/claude-code.test.ts")).toContain(`it("${evidence.name}"`);
		// The runner's full name, describe block first, still claims it.
		expect(check(TestEvidence, { ...evidence, name: `${scenario.requirement} > ${evidence.name}` })).toBe(true);
	});
});

describe("The other evidence kinds have fixed fields", () => {
	it("Scenario: A type check is check evidence", () => {
		const evidence: CheckEvidence = { kind: "check", command: "pnpm check", exitCode: 0, output: "" };
		expect(check(CheckEvidence, evidence)).toBe(true);
		expect(check(Evidence, evidence)).toBe(true);
		expect(check(CheckEvidence, { ...evidence, exitCode: 0.5 })).toBe(false);
		expect(check(CheckEvidence, { ...evidence, scenario: STEP_REF })).toBe(false);
	});
});

describe("A finding classifies what went wrong", () => {
	it("Scenario: A finding without evidence is refused", () => {
		expect(check(Finding, { ...finding("code-defect"), evidence: [] })).toBe(false);
		expect(check(Finding, finding("code-defect"))).toBe(true);
	});
});

describe("Finding kinds say where the fault lies", () => {
	it("Scenario: A spec that describes the code wrongly", () => {
		// The test written to the scenario fails because the scenario misdescribes intended behaviour.
		const spec: Finding = {
			kind: "spec-defect",
			target: STEP_REF,
			evidence: [{ ...fail(STEP_REF), message: "the lint refuses it first; the behaviour is intended" }],
			message: "the scenario misdescribes intended behaviour",
		};
		expect(check(Finding, spec)).toBe(true);
		// Of the five kinds, only spec-defect sends the fix to the spec.
		expect(feedbackFor(spec).action).toBe("amend-spec");
		for (const kind of ["code-defect", "test-defect", "environment", "needs-decision"] as const) {
			expect(feedbackFor({ ...spec, kind }).action, kind).not.toBe("amend-spec");
		}
	});
});

describe("A test claims a scenario by its exact name", () => {
	it("Scenario: A near-miss name claims nothing", () => {
		const nearMiss = "Scenario: The first and second model steps are numbered 0 & 1";
		expect(claims(nearMiss, STEP_REF.scenario)).toBe(false);
		expect(claims(`Scenario: ${STEP_REF.scenario}`, STEP_REF.scenario)).toBe(true);
		// A near miss may not name the scenario, and naming it would not satisfy it.
		expect(check(TestEvidence, { ...pass(STEP_REF), name: nearMiss })).toBe(false);
		expect(satisfies(STEP_REF, [{ ...pass(STEP_REF), name: nearMiss }])).toBe(false);
	});
});

describe("A passing claiming test satisfies a scenario target", () => {
	it("Scenario: A failing test does not satisfy", () => {
		expect(satisfies(STEP_REF, [fail(STEP_REF)])).toBe(false);
		expect(satisfies(STEP_REF, [fail(STEP_REF), pass(STEP_REF)])).toBe(true);
		// A pass for another scenario does not count.
		expect(satisfies(STEP_REF, [pass(threeRef("one"))])).toBe(false);
	});
});

describe("A requirement target needs every scenario", () => {
	it("Scenario: Two of three is not enough", () => {
		const target = { capability: ["demo", "three"], requirement: THREE.name };
		const lookup = scenariosIn([THREE_CAP]);
		expect(satisfies(target, [pass(threeRef("one")), pass(threeRef("two"))], lookup)).toBe(false);
		expect(satisfies(target, ["one", "two", "three"].map((s) => pass(threeRef(s))), lookup)).toBe(true);
		// An unknown requirement satisfies nothing.
		expect(satisfies(target, ["one", "two", "three"].map((s) => pass(threeRef(s))))).toBe(false);
	});
});

describe("A check is evidence for its command only", () => {
	it("Scenario: A green suite command is not scenario evidence", () => {
		expect(satisfies(STEP_REF, [GREEN_SUITE])).toBe(false);
		expect(satisfies({ capability: ["demo", "three"], requirement: THREE.name }, [GREEN_SUITE], scenariosIn([THREE_CAP]))).toBe(false);
		// It does satisfy a target naming that command, and only with exit code 0.
		expect(satisfies({ check: "pnpm test" }, [GREEN_SUITE])).toBe(true);
		expect(satisfies({ check: "pnpm check" }, [GREEN_SUITE])).toBe(false);
		expect(satisfies({ check: "pnpm test" }, [{ ...GREEN_SUITE, exitCode: 1 }])).toBe(false);
	});
});

describe("A skipped test satisfies nothing", () => {
	it("Scenario: Skipped Workers AI checks", () => {
		expect(read("examples/cloudflare-worker/test/routes.sh")).toContain('echo "SKIP Default Workers AI model');
		const ref: ScenarioRef = {
			capability: ["durable", "cloudflare"],
			requirement: "The model is Workers AI unless faux mode is on",
			scenario: "Default Workers AI model",
		};
		const skipped = skip(ref);
		expect(check(TestEvidence, skipped)).toBe(true);
		expect(satisfies(ref, [skipped])).toBe(false);
		expect(
			satisfies({ capability: ref.capability, requirement: ref.requirement }, [skipped], () => [ref.scenario]),
		).toBe(false);
	});
});
