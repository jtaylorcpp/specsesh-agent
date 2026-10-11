import { describe, expect, it } from "vitest";
import { parse } from "../src/authoring/index.js";

describe("platform-agentscript-authoring: A script with a syntax error", () => {
	it("returns a document plus diagnostics naming each problem and its position", () => {
		const broken = 'config:\n    agent_type: "unterminated\n';
		const { document, diagnostics } = parse(broken);

		expect(document).toBeDefined();
		expect(document.source).toBe(broken);
		expect(diagnostics.length).toBeGreaterThan(0);

		// A diagnostic without a position sends the author looking for the problem.
		for (const d of diagnostics) {
			expect(typeof d.message).toBe("string");
			expect(d.message.length).toBeGreaterThan(0);
			const range = (d as { range?: { start?: { line?: number } } }).range;
			expect(range?.start?.line, `"${d.message}" carries no position`).toBeTypeOf("number");
		}
	});

	it("keeps parsing after the problem rather than stopping at it", () => {
		// NEWLINE and DEDENT are unconditional recovery points upstream, so a
		// problem early in the file must not hide everything after it.
		const { diagnostics } = parse(
			'config:\n    agent_type: "unterminated\n\nvariables:\n    stage: not_a_type = 1\n',
		);
		expect(diagnostics.length).toBeGreaterThan(1);
	});
});

describe("platform-agentscript-authoring: The text survives", () => {
	const AWKWARD = [
		'config:\n    agent_name: "spec-author"',           // no trailing newline
		'config:\n    agent_name: "spec-author"\n\n\n',     // trailing blank lines
		'config:\n\tagent_name: "spec-author"\n',           // tabs
		'config:\n    agent_name: "spec-author"   \n',      // trailing spaces
		'system:\n    instructions: |\n        line\n\n        line after a blank\n',
		'config:\n    agent_type: "unterminated',      // does not parse at all
		"",                                            // empty
	];

	for (const source of AWKWARD) {
		it(`writes back byte-identically: ${JSON.stringify(source.slice(0, 30))}…`, () => {
			const { document } = parse(source);
			// The document is the text. Anything that normalises on the way in or
			// out has silently edited work the author did not ask it to touch.
			expect(document.source).toBe(source);
			expect(Buffer.from(document.source, "utf8").equals(Buffer.from(source, "utf8"))).toBe(true);
		});
	}

	it("survives an edit and an undo without changing a byte", () => {
		const original = 'config:\n    agent_name: "spec-author"   \n\n';
		const { document } = parse(original);
		document.edit('config:\n    agent_type: "Other"\n');
		document.undo();
		expect(document.source).toBe(original);
	});
});
