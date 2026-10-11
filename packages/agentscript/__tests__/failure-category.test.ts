import { describe, expect, it } from "vitest";
import { KNOWN_FAILURE_CATEGORIES, isFailureCategory, toFailureCategory } from "../src/interpreter/index.js";

/**
 * The categories the model layer this port is fed by actually reports.
 *
 * Snapshot of `ModelFailureCategory` from coopcli's `packages/agent-harness/src/types.ts`
 * (tag `archive/pre-unspecced`), which mirrored the Claude Agent SDK's union. The harness
 * no longer sits beside this package, so the list is pinned here; refresh it from the SDK
 * when the port is next wired to a real model layer.
 */
const HARNESS_CATEGORIES = [
	"authentication_failed",
	"oauth_org_not_allowed",
	"billing_error",
	"rate_limit",
	"overloaded",
	"invalid_request",
	"model_not_found",
	"server_error",
	"unknown",
	"max_output_tokens",
];

function harnessCategories(): string[] {
	return HARNESS_CATEGORIES;
}

describe("platform-agentscript-interpreter: A Model-Layer Failure Carries The Layer's Own Category", () => {
	it("Scenario: Every category the layer reports has a name here, not a collapse to unrecognised", () => {
		// Five of the layer's ten categories arrived as `unrecognised` — a
		// retryable `server_error` and a permanent `invalid_request` were
		// indistinguishable to a port consumer, which is the gap the categories
		// exist to close, reopened one layer up.
		const reported = harnessCategories();
		expect(reported.length, "the harness union could not be read").toBeGreaterThan(5);

		for (const category of reported) {
			expect(
				toFailureCategory(category),
				`${category} collapses to unrecognised at the port`,
			).not.toBe("unrecognised");
		}
	});

	it("Scenario: The layer saying 'unknown' and the layer saying nothing are different facts", () => {
		// The SDK's own `'unknown'` means THE LAYER said unknown. Our `unknown`
		// means nobody said anything. Same word, opposite facts — and the mapping
		// used to invert it, sending the layer's positive report to `unrecognised`
		// while an absent category became `unknown`.
		expect(toFailureCategory("unknown")).toBe("layer_unknown");
		expect(toFailureCategory(undefined)).toBe("unknown");
		expect(toFailureCategory(null)).toBe("unknown");
		expect(toFailureCategory("")).toBe("unknown");
		expect(toFailureCategory("unknown")).not.toBe(toFailureCategory(undefined));
	});

	it("Scenario: A category from some other layer stays unrecognised, message untouched", () => {
		// Naming more categories must not turn `unrecognised` into a place things
		// get quietly filed. A string outside the set is still outside the set.
		for (const foreign of ["quota_exceeded", "ECONNRESET", "unknown_error", "RATE_LIMIT"]) {
			expect(toFailureCategory(foreign), `${foreign} was folded into a named category`).toBe(
				"unrecognised",
			);
			expect(KNOWN_FAILURE_CATEGORIES).not.toContain(foreign);
		}
	});
});

describe("platform-agentscript-interpreter: The known layer vocabulary is exported", () => {
	it("Scenario: The exported vocabulary", () => {
		expect([...KNOWN_FAILURE_CATEGORIES]).toEqual([
			"authentication_failed",
			"oauth_org_not_allowed",
			"billing_error",
			"rate_limit",
			"overloaded",
			"invalid_request",
			"model_not_found",
			"server_error",
			"max_output_tokens",
			"unknown",
		]);
	});
});

describe("platform-agentscript-interpreter: Our own categories are recognisable", () => {
	it("Scenario: Membership", () => {
		for (const category of ["rate_limit", "layer_unknown", "unrecognised", "unknown"]) {
			expect(isFailureCategory(category), category).toBe(true);
		}
		expect(isFailureCategory("aborted")).toBe(false);
		expect(isFailureCategory("")).toBe(false);
		// Exactly the twelve: the ten the layer vocabulary names (the layer's own
		// `unknown` is also one of ours), plus the two we add.
		for (const category of KNOWN_FAILURE_CATEGORIES) expect(isFailureCategory(category), category).toBe(true);
		expect(isFailureCategory("RATE_LIMIT")).toBe(false);
	});
});
