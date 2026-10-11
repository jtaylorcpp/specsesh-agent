import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { KNOWN_FAILURE_CATEGORIES, toFailureCategory } from "../src/interpreter/index.js";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The categories the model layer this port is fed by actually reports.
 *
 * Read from the HARNESS's own restatement of the SDK union rather than typed
 * out here: that file carries a compile-time drift guard against the SDK
 * (`CategoriesMatchSdk`), so this list is the SDK's, one hop removed. It is
 * read as text because the harness is a private workspace package this one may
 * not import — which is the whole reason the port exists.
 */
function harnessCategories(): string[] {
	const types = readFileSync(join(PKG_DIR, "..", "agent-harness", "src", "types.ts"), "utf8");
	const union = types.slice(
		types.indexOf("export type ModelFailureCategory"),
		types.indexOf("export interface ModelFailure"),
	);
	return [...union.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
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
