import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `analyze` is exercised here with the parser, the dialect and the lint engine
 * made to fail or to misbehave. That needs module mocks, which is why these
 * scenarios sit apart from `authoring-parse.test.ts`: a mock there would
 * disturb every real-parse test in the file. Each control defaults to the real
 * implementation, so a scenario changes exactly the one thing it names.
 */
const controls = vi.hoisted(() => ({
	parse: undefined as undefined | ((source: string) => unknown),
	dialectParse: undefined as undefined | ((root: unknown, schema: unknown) => unknown),
	lintRun: undefined as undefined | ((root: unknown, context: unknown) => unknown),
}));

vi.mock("@sf-agentscript/parser-javascript", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@sf-agentscript/parser-javascript")>();
	return {
		...actual,
		parse: (source: string) => (controls.parse ?? actual.parse)(source),
	};
});

vi.mock("@sf-agentscript/language", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@sf-agentscript/language")>();
	class Dialect extends actual.Dialect {
		override parse(root: never, schema: never) {
			return controls.dialectParse
				? (controls.dialectParse(root, schema) as never)
				: super.parse(root, schema);
		}
	}
	return { ...actual, Dialect };
});

vi.mock("@sf-agentscript/language/lint", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@sf-agentscript/language/lint")>();
	class LintEngine extends actual.LintEngine {
		override run(root: never, context: never) {
			return controls.lintRun
				? (controls.lintRun(root, context) as never)
				: super.run(root, context);
		}
	}
	return { ...actual, LintEngine };
});

import { analyze } from "../src/authoring/index.js";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

afterEach(() => {
	controls.parse = undefined;
	controls.dialectParse = undefined;
	controls.lintRun = undefined;
});

const at = (line: number, character: number) => ({ line, character });
const diagnostic = (message: string, start: ReturnType<typeof at>, code?: string) => ({
	...(code === undefined ? {} : { code }),
	message,
	severity: 1,
	range: { start, end: at(start.line, start.character + 1) },
});

describe("platform-agentscript-authoring: Identical diagnostics are reported once", () => {
	it("Scenario: A schema violation reported by both stages appears once", () => {
		const violation = diagnostic("Unknown field: 'nonexistent_field'", at(1, 4), "unknown-field");
		controls.dialectParse = () => ({ value: rootStub(), diagnostics: [violation] });
		controls.lintRun = () => ({ diagnostics: [{ ...violation }] });

		const found = analyze("config:\n    nonexistent_field: 1\n").diagnostics.filter(
			(d) => d.message === violation.message,
		);
		expect(found).toHaveLength(1);
	});

	it("Scenario: Same message on a different range is kept", () => {
		const first = diagnostic("Unknown field: 'x'", at(1, 4), "unknown-field");
		const second = diagnostic("Unknown field: 'x'", at(5, 4), "unknown-field");
		controls.dialectParse = () => ({ value: rootStub(), diagnostics: [first] });
		controls.lintRun = () => ({ diagnostics: [second] });

		const found = analyze("config:\n").diagnostics;
		expect(found).toEqual([first, second]);
	});
});

/** A parse root that satisfies the guard in front of the lint engine. */
function rootStub() {
	return { __cst: {}, __diagnostics: [] };
}

describe("platform-agentscript-authoring: analyze never throws and always explains a failure", () => {
	it("Scenario: A parser exception becomes a synthetic error diagnostic", () => {
		controls.parse = () => {
			throw new Error("boom");
		};

		const analysis = analyze("config:\n");
		expect(analysis.parsed).toBeNull();
		expect(analysis.diagnostics).toHaveLength(1);
		const [only] = analysis.diagnostics as unknown as {
			message: string;
			severity: number;
			range: unknown;
		}[];
		expect(only?.message).toBe("the document could not be parsed: boom");
		expect(only?.severity).toBe(1);
		expect(only?.range).toEqual({ start: at(0, 0), end: at(0, 0) });
	});

	it("Scenario: A lint exception keeps parse diagnostics and adds one", () => {
		const parseDiagnostic = diagnostic("a parse-stage problem", at(2, 1), "parse-problem");
		controls.dialectParse = () => ({ value: rootStub(), diagnostics: [parseDiagnostic] });
		controls.lintRun = () => {
			throw new Error("bad tree");
		};

		const diagnostics = analyze("config:\n").diagnostics as unknown as {
			message: string;
			severity: number;
		}[];
		expect(diagnostics).toHaveLength(2);
		expect(diagnostics[0]).toEqual(parseDiagnostic);
		expect(diagnostics[1]?.message).toBe(
			"the document was parsed but could not be linted: bad tree",
		);
		expect(diagnostics[1]?.severity).toBe(1);
	});

	it("Scenario: The lint input is guarded rather than cast", () => {
		// A wrapper whose `value` is not an object.
		controls.dialectParse = () => ({ value: "not an object", diagnostics: [] });
		const noRoot = analyze("config:\n").diagnostics.map((d) => d.message);
		expect(noRoot).toHaveLength(1);
		expect(noRoot[0]).toContain("the document was parsed but could not be linted:");
		expect(noRoot[0]).toContain("returned no readable root");

		// A root with no `__cst`.
		controls.dialectParse = () => ({ value: { __diagnostics: [] }, diagnostics: [] });
		const noCst = analyze("config:\n").diagnostics.map((d) => d.message);
		expect(noCst).toHaveLength(1);
		expect(noCst[0]).toContain("upstream node shape has changed");

		// A root whose `__diagnostics` is not an array.
		controls.dialectParse = () => ({ value: { __cst: {}, __diagnostics: "nope" }, diagnostics: [] });
		const badDiagnostics = analyze("config:\n").diagnostics.map((d) => d.message);
		expect(badDiagnostics).toHaveLength(1);
		expect(badDiagnostics[0]).toContain("upstream node shape has changed");

		// The unwrap is the interpreter's own predicate, not a second one.
		const source = readFileSync(join(PKG_DIR, "src/authoring/document.ts"), "utf8");
		const unwrapped = source.match(/\bdocumentRoot\b[^;]*;/)?.[0] ?? "";
		expect(unwrapped).toContain("interpreter/ast.js");
	});
});
