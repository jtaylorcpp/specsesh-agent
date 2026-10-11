import { describe, expect, it } from "vitest";
import { UnsupportedConstructError, run, scanDocument } from "../src/interpreter/index.js";
import {
	EXPRESSION_DEFAULT,
	TWO_UNSUPPORTED,
	UNSUPPORTED_BLOCK,
	UNSUPPORTED_ON_UNREACHED_BRANCH,
} from "./helpers/fixtures.js";
import { answered, recordingPort } from "./helpers/recording-port.js";

/** Assert the refusal and hand it back, so each scenario can look at its own detail. */
async function refusal(source: string, entry?: string): Promise<UnsupportedConstructError> {
	const { port, requests } = recordingPort(answered());
	const error = await run(source, entry === undefined ? { port } : { port, entry }).then(
		() => undefined,
		(err: unknown) => err,
	);
	expect(error, "the run was not refused").toBeInstanceOf(UnsupportedConstructError);
	// Before execution, in every scenario: a refusal that arrives after a turn has
	// been dispatched is not the refusal this requirement asks for.
	expect(requests, "a step was dispatched before the refusal").toHaveLength(0);
	return error as UnsupportedConstructError;
}

describe("platform-agentscript-interpreter: A Construct Outside The Subset Fails By Name, Before Execution", () => {
	it("Scenario: An unsupported block — refused before execution, naming the block and its position", async () => {
		// `model_config:` is valid Agent Script that lints CLEAN against the pinned
		// dialect (asserted in fixtures-lint.test.ts), so the refusal below can only
		// come from our own subset scan.
		const error = await refusal(UNSUPPORTED_BLOCK);

		const block = error.constructs.find((c) => c.construct === "model_config");
		expect(block, "the model_config block was not named").toBeDefined();
		// `model_config:` starts on source line 4, column 1 — reported 1-based, as
		// an editor numbers them.
		expect(block?.range.start).toEqual({ line: 3, character: 0 });
		expect(block?.message).toContain("4:1");

		// The wording is the requirement, not decoration: `model_config:` is
		// perfectly valid Agent Script that Salesforce's runtime would execute.
		// Telling the author their document is invalid sends them to fix nothing.
		expect(block?.message).toContain("unsupported by this runtime");
		expect(block?.message).not.toMatch(/invalid Agent Script/i);
		expect(block?.message).toContain("may well be valid Agent Script");
	});

	it("Scenario: A variable defaulted from an expression — refused by name, not dropped in silence", async () => {
		// The scan and the reader must admit the same set. When they did not, this
		// document passed the scan with a clean bill of health, `b` was dropped by
		// `readDeclarations` without a word, and the run then accused the document
		// of never declaring the variable it declares on the line above:
		//
		//   UndeclaredVariableError: the document references @variables.b at 8:13,
		//   but declares no such variable.
		//
		// A false accusation, from the one error message in the package whose text
		// promises the opposite. And with nothing referencing `b`, the run reported
		// `completed` and the variable simply did not exist.
		const error = await refusal(EXPRESSION_DEFAULT);

		const finding = error.constructs.find((c) => c.where === 'variable "b"');
		expect(finding, "the expression default was not named").toBeDefined();
		expect(finding?.construct).toBe("MemberExpression as a variable's default");
		expect(finding?.message).toContain("unsupported by this runtime");
		// Where the author wrote it, not the top of the file.
		expect(finding?.range.start.line).toBe(2);

		// And the reader is never reached with something it cannot read: the two
		// now agree, which is what makes `readLiteral` total rather than partial.
		expect(error.constructs).toHaveLength(1);
	});

	it("Scenario: Every refusal carries a real position, or says it has none", async () => {
		// Positions were asserted on two hand-picked findings and nowhere else. The
		// scan falls back to the origin whenever the parser reported no span, and
		// the message rendered that as "1:1" — indistinguishable from a real
		// position at the top of the file, and it sends an author to a line with
		// nothing wrong on it.
		//
		// Both halves are asserted. First, every refusal a real document produces:
		for (const source of [UNSUPPORTED_BLOCK, UNSUPPORTED_ON_UNREACHED_BRANCH, TWO_UNSUPPORTED]) {
			const error = await refusal(
				source,
				source === UNSUPPORTED_ON_UNREACHED_BRANCH ? "draft" : undefined,
			);
			expect(error.constructs.length).toBeGreaterThan(0);
			for (const found of error.constructs) {
				// Against the pinned dialect every one of these HAS a position, which
				// is worth pinning in itself.
				expect(found.range.start.line + found.range.start.character).toBeGreaterThan(0);
				expect(found.message).toContain(
					`${found.range.start.line + 1}:${found.range.start.character + 1}`,
				);
			}
		}

		// And then the fallback itself, driven directly — a node the parser gave no
		// `__cst` at all. Not reachable from the pinned dialect today, which is
		// exactly why it needs asserting: it is reached the day upstream stops
		// attaching a span to something, and a refusal is the last place that
		// should quietly invent a fact.
		const unpositioned = scanDocument({
			__children: [{ key: "mystery_block", value: {} }],
			mystery_block: {},
		});
		expect(unpositioned).toHaveLength(1);
		expect(unpositioned[0]?.range.start).toEqual({ line: 0, character: 0 });
		expect(unpositioned[0]?.message).toContain("a position the parser did not report");
		expect(unpositioned[0]?.message).not.toContain("at 1:1");
	});

	it("Scenario: An unsupported construct on an unreached branch — still refused up front", async () => {
		// The run enters "draft" and would never reach "review". The refusal comes
		// anyway, because a document that refuses in week three mid-run is worse
		// than one that refuses now.
		const error = await refusal(UNSUPPORTED_ON_UNREACHED_BRANCH, "draft");

		const finding = error.constructs.find((c) => c.where === 'subagent "review"');
		expect(finding, "the unreached subagent was not scanned").toBeDefined();
		expect(finding?.construct).toBe("set @context");
		expect(finding?.message).toContain("unsupported by this runtime");
	});

	it("Scenario: Nothing is silently skipped — no partial execution, a diagnostic per dropped instruction", async () => {
		const error = await refusal(TWO_UNSUPPORTED);

		// Both, not the first: a caller fixing them one refusal at a time is a
		// caller running the parser as a linter.
		expect(error.constructs.map((c) => c.construct).sort()).toEqual([
			"model_config",
			"set @context",
		]);
		for (const found of error.constructs) {
			expect(found.message).toContain("unsupported by this runtime");
		}

		// And nothing ran: the three supported instructions in this document — two
		// prompt lines and a `set` — were not partially executed on the way to the
		// refusal. `refusal()` has already asserted zero dispatches; this asserts
		// the run produced no result at all to have executed into.
		const { port, requests } = recordingPort(answered());
		await expect(run(TWO_UNSUPPORTED, { port })).rejects.toThrow(UnsupportedConstructError);
		expect(requests).toHaveLength(0);
	});
});
