import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	BOOLEAN_LITERALS,
	SUPPORTED_BLOCK_FIELDS,
	SUPPORTED_CONSTRUCTS,
	SUPPORTED_CONSTRUCT_IDS,
	SUPPORTED_DEFAULT_VALUE_KINDS,
	SUPPORTED_EXPRESSION_KINDS,
	SUPPORTED_NODE_KINDS,
	SUPPORTED_STATEMENT_KINDS,
	UnsupportedConstructError,
	renderSubsetInline,
	renderSubsetMarkdown,
	run,
} from "../../src/interpreter/index.js";
import { UNSUPPORTED_BLOCK } from "./helpers/fixtures.js";
import { answered, recordingPort } from "./helpers/recording-port.js";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

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
		const { readDeclarations } = await import("../../src/interpreter/compose.js");
		const { analyze } = await import("../../src/authoring/index.js");

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

const byId = (id: string) => SUPPORTED_CONSTRUCTS.find((c) => c.id === id);

describe("platform-agentscript-interpreter: The supported subset is declared once, as SUPPORTED_CONSTRUCTS", () => {
	it("Scenario: The ten constructs, in order", () => {
		expect(SUPPORTED_CONSTRUCT_IDS.slice(0, 10)).toEqual([
			"config",
			"system.instructions",
			"variables",
			"variables.description",
			"subagent",
			"subagent.reasoning",
			"reasoning.prompt-line",
			"reasoning.interpolation",
			"reasoning.logic-line",
			"reasoning.structured-output",
		]);
		expect(SUPPORTED_CONSTRUCTS.map((c) => c.id)).toEqual([...SUPPORTED_CONSTRUCT_IDS]);
	});

	it("Scenario: Three action constructs follow the ten", () => {
		expect(SUPPORTED_CONSTRUCT_IDS).toHaveLength(13);
		expect(SUPPORTED_CONSTRUCT_IDS.slice(10)).toEqual(["subagent.actions", "reasoning.run", "reasoning.actions"]);
	});

	it("Scenario: Each construct declares its kinds", () => {
		const expected: Record<string, string[]> = {
			config: ["ConfigBlock"],
			"system.instructions": ["SystemBlock", "TemplateExpression", "TemplateText"],
			variables: [
				"VariablesBlock",
				"VariableDeclaration",
				"ParameterDeclaration",
				"Identifier",
				"StringLiteral",
				"BooleanLiteral",
			],
			"variables.description": ["VariablePropertiesBlock"],
			subagent: ["Collection<SubagentBlock>", "SubagentBlock"],
			"subagent.reasoning": ["ReasoningBlock", "ProcedureValue"],
			"reasoning.prompt-line": ["Template", "TemplateText"],
			"reasoning.interpolation": ["TemplateInterpolation"],
			"reasoning.logic-line": [
				"IfStatement",
				"SetClause",
				"MemberExpression",
				"AtIdentifier",
				"ComparisonExpression",
				"BinaryExpression",
				"UnaryExpression",
				"StringLiteral",
				"NumberLiteral",
				"BooleanLiteral",
			],
			"reasoning.structured-output": ["SetClause", "MemberExpression", "AtIdentifier"],
			"subagent.actions": ["Collection<ActionBlock>", "ActionBlock", "InputsBlock", "OutputsBlock", "ParameterDeclaration"],
			"reasoning.run": ["RunStatement", "WithClause", "SetClause", "MemberExpression", "AtIdentifier"],
			"reasoning.actions": ["Collection<ReasoningActionBlock>", "ReasoningActionBlock", "WithClause", "Ellipsis"],
		};
		expect(Object.keys(expected)).toHaveLength(SUPPORTED_CONSTRUCTS.length);
		for (const [id, kinds] of Object.entries(expected)) {
			expect(byId(id)?.kinds, `kinds of ${id}`).toEqual(kinds);
		}
		for (const construct of SUPPORTED_CONSTRUCTS) {
			expect(construct.kinds.length, `${construct.id} declares no kinds`).toBeGreaterThan(0);
		}
	});

	it("Scenario: Each construct's summary", () => {
		const expected: Record<string, string> = {
			config: "the config block naming the agent",
			"system.instructions": "standing instructions, as a multiline block",
			variables: "declared variables with a type and a literal default",
			"variables.description": "a variable's description",
			subagent: "a named subagent with a description",
			"subagent.reasoning": "a subagent's reasoning block",
			"reasoning.prompt-line": "a prompt line, interpreted by the model",
			"reasoning.interpolation": "a `{!@variables.x}` reference inside a prompt line",
			"reasoning.logic-line": "a logic line, run deterministically every turn",
			"reasoning.structured-output":
				"assigning a variable from a field of the step's structured result",
			"subagent.actions": "actions a subagent defines, each bound to a host tool",
			"reasoning.run": "a run statement, calling an action deterministically",
			"reasoning.actions": "actions a reasoning step offers the model as tools",
		};
		expect(Object.keys(expected)).toHaveLength(SUPPORTED_CONSTRUCTS.length);
		for (const [id, summary] of Object.entries(expected)) {
			expect(byId(id)?.summary, `summary of ${id}`).toBe(summary);
		}
	});

	it("Scenario: Probes exercise their constructs fully", () => {
		const variables = byId("variables")?.probe ?? "";
		expect(variables).toContain('stage: mutable string = "proposal"');
		expect(variables).toContain('change_id: string = "OS-1"');
		expect(variables).toContain("approved: mutable boolean = False");

		expect(byId("reasoning.interpolation")?.probe).toContain("{!@variables.stage}");

		const logic = byId("reasoning.logic-line")?.probe ?? "";
		expect(logic).toContain("if not @variables.approved and @variables.count > 1:");
		expect(logic).toContain("| Draft it.");
		expect(logic).toContain("else:");
		expect(logic).toContain('set @variables.stage = "specs"');

		expect(byId("reasoning.structured-output")?.probe).toContain(
			"set @variables.verdict = @outputs.verdict",
		);

		const actions = byId("subagent.actions")?.probe ?? "";
		expect(actions).toContain("description:");
		expect(actions).toContain("inputs:");
		expect(actions).toContain("outputs:");
		expect(actions).toContain('target: "mcpTool://run_checks"');

		const run = byId("reasoning.run")?.probe ?? "";
		expect(run).toContain("run @actions.run_checks");
		expect(run).toMatch(/\n\s+with \w+ = /);
		expect(run).toContain("set @variables.checks_passed = @outputs.passed");

		const offered = byId("reasoning.actions")?.probe ?? "";
		expect(offered).toContain("edit: @actions.edit_file");
		expect(offered).toContain("with path = ...");
	});
});

describe("platform-agentscript-interpreter: The subset is rendered from the declaration, never restated", () => {
	it("Scenario: Markdown rendering", () => {
		const lines = renderSubsetMarkdown().split("\n");
		expect(lines[0]).toBe("- `config` — the config block naming the agent");
		expect(lines).toHaveLength(SUPPORTED_CONSTRUCTS.length);
		lines.forEach((line, i) => {
			const construct = SUPPORTED_CONSTRUCTS[i];
			expect(line).toBe(`- \`${construct?.id}\` — ${construct?.summary}`);
		});
	});

	it("Scenario: Inline rendering", () => {
		const inline = renderSubsetInline();
		expect(
			inline.startsWith(
				"config, system.instructions, variables, variables.description, subagent, ",
			),
		).toBe(true);
		expect(inline.endsWith("reasoning.actions")).toBe(true);
		expect(inline).toBe(SUPPORTED_CONSTRUCT_IDS.join(", "));
	});
});

describe("platform-agentscript-interpreter: Supported block fields are named per block", () => {
	it("Scenario: The field table", () => {
		expect(SUPPORTED_BLOCK_FIELDS).toEqual({
			Document: ["config", "system", "variables", "subagent"],
			ConfigBlock: ["agent_name", "developer_name", "agent_type", "description"],
			SystemBlock: ["instructions"],
			VariableDeclaration: ["properties"],
			ParameterDeclaration: ["properties"],
			VariablePropertiesBlock: ["description"],
			SubagentBlock: ["description", "reasoning", "actions"],
			ReasoningBlock: ["instructions", "actions"],
			ActionBlock: ["description", "inputs", "outputs", "target"],
		});
	});
});

describe("platform-agentscript-interpreter: Statements, expressions and defaults are limited to declared kinds", () => {
	it("Scenario: The kind lists", () => {
		expect(SUPPORTED_STATEMENT_KINDS).toEqual(["Template", "IfStatement", "SetClause", "RunStatement"]);
		expect(SUPPORTED_EXPRESSION_KINDS).toEqual([
			"MemberExpression",
			"AtIdentifier",
			"ComparisonExpression",
			"BinaryExpression",
			"UnaryExpression",
			"StringLiteral",
			"NumberLiteral",
			"BooleanLiteral",
		]);
		expect(SUPPORTED_DEFAULT_VALUE_KINDS).toEqual(["StringLiteral", "NumberLiteral", "BooleanLiteral"]);
		// `Identifier` is how a bare name parses, and is deliberately not an expression.
		expect(SUPPORTED_EXPRESSION_KINDS).not.toContain("Identifier");
	});

	it("Scenario: SUPPORTED_NODE_KINDS is the deduplicated union", () => {
		const union = [
			...new Set([
				...SUPPORTED_CONSTRUCTS.flatMap((c) => c.kinds),
				...SUPPORTED_STATEMENT_KINDS,
				...SUPPORTED_EXPRESSION_KINDS,
			]),
		];
		expect(union.length).toBeGreaterThan(0);
		expect(SUPPORTED_NODE_KINDS).toEqual(union);
		expect(new Set(SUPPORTED_NODE_KINDS).size).toBe(SUPPORTED_NODE_KINDS.length);
	});
});

describe("platform-agentscript-interpreter: Booleans are spelled the dialect's way when written back", () => {
	it("Scenario: The literal table", () => {
		expect(BOOLEAN_LITERALS).toEqual({ true: "True", false: "False" });
	});
});
