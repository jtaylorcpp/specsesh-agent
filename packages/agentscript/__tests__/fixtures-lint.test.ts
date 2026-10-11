import { describe, expect, it } from "vitest";
import { analyze } from "../src/authoring/index.js";
import * as fixtures from "./helpers/fixtures.js";

/**
 * The seam that was missing.
 *
 * Both halves of this package parse the same documents with the same dialect —
 * the authoring surface to lint them, the interpreter to run them — and nothing
 * made them agree. The interpreter's fixtures were never once handed to
 * `analyze`, so the interpreter was built against whatever the fixtures
 * happened to say, and what they said was wrong three separate times:
 * `false` for `False`, `{@variables.x}` for `{!@variables.x}`, and `@output`
 * for `@outputs`. Each spelling ran, and each was an error in the author's
 * editor. A boolean was either runnable or saveable, never both.
 *
 * One assertion per fixture closes the whole family, and would have closed it
 * before any of the three was written.
 */

/** Error severity on the LSP scale the dialect's diagnostics use. */
const ERROR = 1;

describe("platform-agentscript-interpreter: every interpreter fixture is a document an author could save", () => {
	it("registers every fixture this module exports, so a new one cannot skip the check", () => {
		// The structural half. Without it the assertion below is only as good as
		// whoever remembered to add a row, and the fixture that broke this package
		// was added by someone who did not know the check existed.
		const exported = Object.entries(fixtures)
			.filter(([, value]) => typeof value === "string")
			.map(([name]) => name)
			.sort();

		expect(exported.length).toBeGreaterThan(5);
		expect(Object.keys(fixtures.FIXTURES).sort()).toEqual(exported);
		for (const [name, entry] of Object.entries(fixtures.FIXTURES)) {
			expect(entry.source, `${name} is registered with a different source`).toBe(
				(fixtures as unknown as Record<string, string>)[name],
			);
		}
	});

	for (const [name, entry] of Object.entries(fixtures.FIXTURES)) {
		it(`${name}: the authoring surface says ${entry.lint === "clean" ? "nothing" : "exactly what it must"}`, () => {
			const messages = analyze(entry.source).diagnostics.map((d) => d.message);

			if (entry.lint === "clean") {
				// Not "no errors" — NOTHING. A hint about an unused variable or a
				// deprecated spelling is a fixture drifting away from the language it
				// claims to be written in, and the drift is what this test exists for.
				expect(messages, `${name} is not a document an author could save clean`).toEqual([]);
				return;
			}
			expect(messages).toEqual([...entry.lint]);
		});
	}

	it("keeps a deliberately-broken fixture broken at ERROR severity, not merely noisy", () => {
		// The two broken fixtures are load-bearing: one proves the runner refuses a
		// document with a syntax error, the other that it refuses an undeclared
		// reference. Both depend on the diagnostic being an ERROR — a warning would
		// not be refused, and the scenario would silently stop testing anything.
		for (const name of ["UNDECLARED_REFERENCE", "UNTERMINATED_STRING"] as const) {
			const diagnostics = analyze(fixtures.FIXTURES[name]!.source).diagnostics;
			expect(
				diagnostics.some((d) => (d as { severity?: number }).severity === ERROR),
				`${name} no longer carries an error-severity diagnostic`,
			).toBe(true);
		}
	});
});
