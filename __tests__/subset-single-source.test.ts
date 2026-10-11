import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	SUPPORTED_CONSTRUCTS,
	SUPPORTED_CONSTRUCT_IDS,
	SUPPORTED_DEFAULT_VALUE_KINDS,
	SUPPORTED_EXPRESSION_KINDS,
	SUPPORTED_NODE_KINDS,
	SUPPORTED_STATEMENT_KINDS,
	UnsupportedConstructError,
	renderSubsetMarkdown,
	run,
} from "../src/interpreter/index.js";
import { UNSUPPORTED_BLOCK } from "./helpers/fixtures.js";
import { answered, recordingPort } from "./helpers/recording-port.js";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every `.ts` under `src/`, read from disk rather than from git's index. */
function sourceFiles(dir = join(PKG_DIR, "src")): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return entry.name.endsWith(".ts") ? [path] : [];
	});
}

describe("platform-agentscript-interpreter: The Interpreter Runs An Enumerated Subset, Declared In One Place", () => {
	it("Scenario: One declaration of the subset — the diagnostic, the documentation and this test all read the one export", async () => {
		// 1. THE DIAGNOSTIC. The refusal a caller gets names the supported set, and
		//    names it from the export rather than from a sentence someone typed.
		const { port } = recordingPort(answered());
		const error = (await run(UNSUPPORTED_BLOCK, { port }).then(
			() => undefined,
			(err: unknown) => err,
		)) as UnsupportedConstructError;
		expect(error).toBeInstanceOf(UnsupportedConstructError);
		for (const id of SUPPORTED_CONSTRUCT_IDS) {
			expect(error.constructs[0]?.message, `the diagnostic omits ${id}`).toContain(id);
		}

		// 2. THE DOCUMENTATION. The README's generated block is character-identical
		//    to what the export renders, so a construct added or removed in one
		//    place cannot stay unsaid in the other.
		const readme = readFileSync(join(PKG_DIR, "README.md"), "utf8");
		const block = readme.split("<!-- SUBSET:BEGIN")[1]?.split("<!-- SUBSET:END")[0] ?? "";
		const documented = block.slice(block.indexOf("-->") + 3).trim();
		expect(documented).toBe(renderSubsetMarkdown());

		// 3. THE CONFORMANCE TEST. The script reads the same declaration out of the
		//    same file, so a bump is checked against the list that is in force.
		const report = JSON.parse(
			execFileSync("node", ["scripts/check-subset-conformance.mjs", "--json"], {
				cwd: PKG_DIR,
				encoding: "utf8",
			}),
		) as { checked: number };
		expect(report.checked).toBe(SUPPORTED_CONSTRUCTS.length);

		// And there is only ONE to read from. The requirement's own reasoning:
		// three restatements drift into three different subsets, and the one that
		// matters — what the interpreter actually runs — is the one nobody reads.
		const declarations = sourceFiles().filter((file) =>
			/(?:const|let|var)\s+SUPPORTED_CONSTRUCTS\s*[:=]/.test(readFileSync(file, "utf8")),
		);
		expect(declarations.map((f) => f.slice(PKG_DIR.length + 1))).toEqual([
			"src/interpreter/subset.ts",
		]);
	});

	it("Scenario: The kinds the scan matches on are the kinds the constructs declare", () => {
		// `SUPPORTED_NODE_KINDS` was exported and read by NOTHING, while
		// `subset.ts` claimed "the scan matches on these, so an upstream rename
		// shows up as a refusal naming a kind nobody declared". The scan matches on
		// the two lists below, which were never checked against `kinds` at all — so
		// the claim was simply false, and the conformance script could prove
		// nothing about the strings the scan actually uses.
		//
		// This is the tie. The conformance script walks each probe against `kinds`;
		// this asserts the scan's own lists are inside that set, so what the script
		// proves is a fact about the code that runs.
		expect(SUPPORTED_CONSTRUCTS.length).toBeGreaterThan(5);
		const declared = new Set(SUPPORTED_CONSTRUCTS.flatMap((c) => c.kinds));
		for (const kind of [...SUPPORTED_STATEMENT_KINDS, ...SUPPORTED_EXPRESSION_KINDS]) {
			expect(declared.has(kind), `the scan matches on ${kind}, which no construct declares`).toBe(
				true,
			);
			expect(SUPPORTED_NODE_KINDS).toContain(kind);
		}

		// And no construct declares an EMPTY kinds list. A declared empty
		// collection is a construct every loop over it skips in silence — which is
		// exactly what `reasoning.structured-output` was.
		for (const construct of SUPPORTED_CONSTRUCTS) {
			expect(construct.kinds.length, `${construct.id} declares no kinds`).toBeGreaterThan(0);
		}
	});

	it("Scenario: The scan and the reader admit the same variable defaults", async () => {
		// F4's gap in one assertion. `scanDefaultValue` admits
		// SUPPORTED_DEFAULT_VALUE_KINDS; `readLiteral` reads a switch. When the two
		// disagreed the scan passed a declaration the reader then dropped in
		// silence, and the run accused the document of never declaring it.
		const { readDeclarations } = await import("../src/interpreter/compose.js");
		const { analyze } = await import("../src/authoring/index.js");

		for (const [source, name, expected] of [
			['variables:\n    v: mutable string = "x"\n', "v", "x"],
			["variables:\n    v: mutable number = 3\n", "v", 3],
			["variables:\n    v: mutable boolean = True\n", "v", true],
			["variables:\n    v: mutable boolean = False\n", "v", false],
		] as const) {
			expect(readDeclarations(analyze(source).parsed).get(name)?.initial).toBe(expected);
		}

		// Every kind the scan admits is one the reader reads, so the `continue`
		// that used to sit on this path has nothing left to skip.
		expect([...SUPPORTED_DEFAULT_VALUE_KINDS].sort()).toEqual([
			"BooleanLiteral",
			"NumberLiteral",
			"StringLiteral",
		]);
	});
});
