import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyze } from "../../src/authoring/index.js";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Lint was dead for a while and every test stayed green.
 *
 * Two independent mistakes each silenced it without an error: passing the
 * `defaultRules` factory uncalled (which threw, and was swallowed into a
 * per-document "could not be linted" diagnostic), and passing `dialect.parse()`'s
 * `{ value, diagnostics }` WRAPPER where the AST root was wanted (which threw
 * nothing at all — every pass simply found no keys to walk and returned an empty
 * array). An `as never` cast is what let the second one compile.
 *
 * The lesson these pin is narrow and worth keeping: a test that asserts analysis
 * *does not throw* is not a test that analysis *happens*. These assert lint
 * produces its own findings — ones the parse stage provably cannot produce.
 */

/** Declares `stage`, references `change_id`, which does not exist. */
const UNDECLARED_REFERENCE = `config:
    agent_name: "spec-author"

variables:
    stage: mutable string = "proposal"

subagent draft:
    description: "d"

    reasoning:
        instructions: ->
            | Read {!@variables.change_id} now.
`;

describe("lint is live — findings only the lint stage can produce", () => {
	it("reports a reference to a variable that was never declared", () => {
		const { diagnostics } = analyze(UNDECLARED_REFERENCE);

		const undefinedRef = diagnostics.find(
			(d) => (d as { code?: string }).code === "undefined-reference",
		);
		expect(
			undefinedRef,
			"no undefined-reference diagnostic — lint is not running, whatever else is green",
		).toBeDefined();
		expect(undefinedRef?.message).toMatch(/change_id/);
	});

	it("carries the position of the reference, not the top of the file", () => {
		const { diagnostics } = analyze(UNDECLARED_REFERENCE);
		const undefinedRef = diagnostics.find(
			(d) => (d as { code?: string }).code === "undefined-reference",
		) as { range?: { start?: { line?: number; character?: number } } } | undefined;

		// A diagnostic that always points at line 0 is indistinguishable from one
		// the surface invented, and cannot be shown at the reference.
		expect(undefinedRef?.range?.start?.line).toBeGreaterThan(0);
		expect(undefinedRef?.range?.start?.character).toBeGreaterThan(0);
	});

	it("reports a declared variable nothing ever reads", () => {
		const { diagnostics } = analyze(`config:
    agent_name: "spec-author"

variables:
    unread: mutable string = "x"

subagent draft:
    description: "d"
`);
		expect(
			diagnostics.some((d) => (d as { code?: string }).code === "unused-variable"),
			"no unused-variable diagnostic — lint is not running",
		).toBe(true);
	});

	it("still carries parse-stage diagnostics alongside lint ones", () => {
		// The two stages are separate and both must reach the caller; the dead-lint
		// bug survived precisely because this half kept working.
		const { diagnostics } = analyze('config:\n    nonexistent_field: "x"\n');
		expect(diagnostics.some((d) => /nonexistent_field/.test(d.message))).toBe(true);
	});

	it("a clean document produces no diagnostics at all", () => {
		// The other direction: if lint reported on everything, the tests above would
		// pass for the wrong reason.
		const { diagnostics } = analyze(`config:
    agent_name: "spec-author"

variables:
    stage: mutable string = "proposal"

subagent draft:
    description: "d"

    reasoning:
        instructions: ->
            | Read {!@variables.stage} now.
`);
		expect(diagnostics.map((d) => d.message)).toEqual([]);
	});
});

describe("the boundary that hid it is closed", () => {
	// The dead-lint bug type-checked because `parsedRoot` was declared to return
	// `never`. A `never` return is the strongest possible "stop checking"
	// instruction: it is assignable to everything, so `LintEngine.run()`'s first
	// parameter was never validated against what we handed it. The bug was fixed,
	// the cast was moved into a named function with a comment explaining why casts
	// at boundaries are bad — and the compiler protection stayed at zero.
	//
	// These are source-level assertions ON PURPOSE. The property is about what the
	// compiler checks, and no runtime input can observe it: a green suite over a
	// `never` return is precisely what happened last time.

	const documentSource = readFileSync(join(PKG_DIR, "src/authoring/document.ts"), "utf8");
	// Comments stripped: the file DISCUSSES the `as never` cast at length, and
	// must go on doing so. What it may not contain is one.
	const documentCode = documentSource
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");

	it("hands the lint engine a value typed as the AST root upstream declares", () => {
		expect(documentCode).toMatch(/function parsedRoot\(result: unknown\): AstRoot/);
		// Not `never`, under any spelling, anywhere in the file.
		expect(documentCode).not.toMatch(/\bas never\b/);
		expect(documentCode).not.toMatch(/\): never\b/);
	});

	it("guards the shape it claims rather than asserting it", () => {
		// A type earned by a runtime check, not by a cast: `AstRoot` declares
		// `__cst` and `__diagnostics`, so both are checked before the value is
		// typed as one, and a mismatch throws naming the shape.
		expect(documentCode).toMatch(/__cst.*in root/);
		expect(documentCode).toMatch(/__diagnostics/);
		expect(documentSource).toMatch(/upstream node shape has changed/);
	});

	it("unwraps the parse result in ONE place, shared with the interpreter", () => {
		// Two predicates for the same wrapper is how they come to disagree:
		// `parsedRoot` unwrapped on `"value" in result`, while `documentRoot`
		// required `"value" in parsed && "diagnostics" in parsed`. One definition
		// now, imported.
		expect(documentCode).toMatch(/documentRoot/);
		expect([...documentCode.matchAll(/"value" in /g)]).toHaveLength(0);
	});
});
