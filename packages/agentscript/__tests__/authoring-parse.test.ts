import { describe, expect, it } from "vitest";
import { Document, analyze } from "../src/authoring/index.js";

/**
 * A document exercising the blocks the interpreter's subset will cover.
 *
 * Written to lint CLEAN, which is why it carries a subagent that reads `stage`:
 * a declared variable nothing reads is a diagnostic of its own, and a "clean
 * document" fixture that is not clean cannot be used to prove the surface says
 * nothing when there is nothing to say.
 */
const SCRIPT = `config:
    agent_name: "spec-author"

system:
    instructions: |
        You walk the author through one OpenSpec change.

variables:
    stage: mutable string = "proposal"
        description: "proposal | specs | design | tasks"

subagent draft:
    description: "Fill the proposal"

    reasoning:
        instructions: ->
            | Draft the {!@variables.stage}.
`;

describe("platform-agentscript-authoring: A document is parsed and linted", () => {
	it("returns a document and its lint diagnostics", () => {
		const analysis = analyze(SCRIPT);

		expect(analysis.source).toBe(SCRIPT);
		expect(analysis.parsed).not.toBeNull();
		// NOT `Array.isArray(diagnostics)`, which is what this asserted and which
		// passes on `[]` forever — it was green throughout both of the bugs that
		// killed linting outright. This document is one an author could save, so
		// the diagnostics must be empty; and a document with a problem in it must
		// produce one. Two directions, neither satisfiable by returning nothing.
		expect(analysis.diagnostics.map((d) => d.message)).toEqual([]);
		expect(
			analyze(SCRIPT.replace("{!@variables.stage}", "{!@variables.missing}")).diagnostics.map(
				(d) => d.message,
			),
		).toEqual(["Variable 'stage' is declared but never used", "'missing' is not defined in variables"]);
	});

	it("keeps the source byte-identical to what was supplied", () => {
		// The text is the document. Analysis must not normalise it on the way in.
		const awkward = "config:\n    agent_name: \"spec-author\"\n\n\n   \n";
		expect(analyze(awkward).source).toBe(awkward);
	});
});

describe("platform-agentscript-authoring: A half-written document yields diagnostics, not a thrown away buffer", () => {
	// An author mid-keystroke is the normal case. A parser that throws on it
	// takes the editor down; one that discards the buffer loses their work.
	const HALF_WRITTEN = [
		"config:",
		"config:\n    agent_type:",
		'config:\n    agent_type: "unterminated',
		"subagent draft:\n    reasoning:\n        instructions: ->\n            if ",
		"variables:\n    stage: mutable string =",
		"\t\t\tnot even indentation that means anything",
	];

	for (const source of HALF_WRITTEN) {
		it(`yields diagnostics rather than throwing on: ${JSON.stringify(source.slice(0, 34))}…`, () => {
			expect(() => analyze(source)).not.toThrow();
			const analysis = analyze(source);
			expect(analysis.source).toBe(source);
			// The requirement this names is "yields DIAGNOSTICS". Asserting only
			// that nothing threw would pass on `{ parsed: null, diagnostics: [] }`
			// for every input — which is the shape both dead-lint bugs had, and this
			// loop was green through both of them.
			expect(analysis.diagnostics.length, "no diagnostic for a half-written document").toBeGreaterThan(0);
			expect(analysis.diagnostics.every((d) => typeof d.message === "string" && d.message.length > 0)).toBe(
				true,
			);
		});
	}
});

describe("Document edit history", () => {
	it("undoes and redoes over whole-text snapshots", () => {
		const doc = new Document("config:\n");
		doc.edit('config:\n    agent_type: "a"\n');
		doc.edit('config:\n    agent_type: "b"\n');

		expect(doc.source).toContain('"b"');
		doc.undo();
		expect(doc.source).toContain('"a"');
		doc.undo();
		expect(doc.source).toBe("config:\n");
		expect(doc.canUndo).toBe(false);

		doc.redo();
		expect(doc.source).toContain('"a"');
		expect(doc.canRedo).toBe(true);
	});

	it("spends no history step on a no-op edit", () => {
		const doc = new Document("config:\n");
		doc.edit("config:\n");
		expect(doc.canUndo).toBe(false);
	});

	it("drops the redo future once a new edit lands", () => {
		const doc = new Document("a");
		doc.edit("b");
		doc.undo();
		expect(doc.canRedo).toBe(true);
		doc.edit("c");
		expect(doc.canRedo).toBe(false);
	});

	it("re-analyses on every move, so diagnostics follow the text", () => {
		const doc = new Document(SCRIPT);
		const before = doc.analysis.source;
		doc.edit("config:\n    agent_type:");
		expect(doc.analysis.source).not.toBe(before);
		expect(doc.analysis.source).toBe(doc.source);
		doc.undo();
		expect(doc.analysis.source).toBe(SCRIPT);
	});
});
