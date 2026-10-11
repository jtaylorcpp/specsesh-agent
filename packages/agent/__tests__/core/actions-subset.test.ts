import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyze } from "../../src/authoring/index.js";
import {
	SUPPORTED_CONSTRUCTS,
	SUPPORTED_DEFAULT_VALUE_KINDS,
	SUPPORTED_EXPRESSION_KINDS,
	SUPPORTED_NODE_KINDS,
	SUPPORTED_STATEMENT_KINDS,
	UnparsedDocumentError,
	UnsupportedConstructError,
	run,
	scanDocument,
} from "../../src/interpreter/index.js";
import { readDeclarations } from "../../src/interpreter/compose.js";
import { EXPRESSION_DEFAULT } from "./helpers/fixtures.js";
import { RUN_CHECKS_DEFINITION, subagentDocument, taskAgentFile } from "./helpers/actions.js";
import { answered, recordingPort } from "./helpers/recording-port.js";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const scan = (source: string) => scanDocument(analyze(source).parsed);
const errors = (source: string) => analyze(source).diagnostics.filter((d) => d.severity === 1);

const CHECK_VARIABLES = `task_id: mutable string = "2.4"
checks_passed: mutable boolean = False`;

const RUN_CHECKS = `run @actions.run_checks
    with task_id = @variables.task_id
    set @variables.checks_passed = @outputs.passed`;

const EDIT_DEFINITION = `    actions:
        edit_file:
            description: "Replace a file"
            inputs:
                path: string
                content: string
            outputs:
                ok: boolean
            target: "mcpTool://edit_file"
`;

/** A subagent defining one action with the given output declarations and target. */
const defining = (outputs: string, target = "mcpTool://run_checks") =>
	subagentDocument({
		actions: `    actions:
        run_checks:
            description: "Run the checks"
            inputs:
                task_id: string
            outputs:
${outputs}
            target: "${target}"
`,
		instructions: "| Report on the checks.",
	});

describe("core/subset: An action is defined on its subagent", () => {
	it("Scenario: A well-formed action scans clean", () => {
		const source = defining("                passed: boolean\n                output: string");
		expect(errors(source)).toEqual([]);
		expect(scan(source)).toEqual([]);
	});

	it("Scenario: A list-typed output is refused", () => {
		const source = defining("                files: list[string]");
		// The dialect accepts it: the refusal is ours.
		expect(errors(source)).toEqual([]);
		const found = scan(source);
		expect(found).toHaveLength(1);
		expect(found[0]?.construct).toContain("files");
		expect(found[0]?.where).toBe('subagent "t"');
	});
});

describe("core/subset: Only mcpTool targets execute", () => {
	it("Scenario: An mcpTool target is accepted", () => {
		const found = scan(defining("                passed: boolean"));
		expect(found.filter((c) => c.construct.startsWith("target"))).toEqual([]);
		expect(found).toEqual([]);
	});

	it("Scenario: A flow target is refused by this runtime", () => {
		const source = defining("                passed: boolean", "flow://RunTests");
		expect(errors(source)).toEqual([]);
		const found = scan(source);
		expect(found.map((c) => c.construct)).toEqual(["target flow://"]);
		expect(found[0]?.message).toContain("unsupported by this runtime");
	});

	it("Scenario: A host scheme never reaches the scan", async () => {
		const source = defining("                passed: boolean", "host://command");
		const { port, requests } = recordingPort(answered());
		const error = await run(source, { port }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(UnparsedDocumentError);
		expect((error as Error).message).toContain('unsupported target scheme "host://"');
		expect(requests).toHaveLength(0);
	});
});

describe("core/subset: A run statement calls an action deterministically", () => {
	it("Scenario: A complete run statement scans clean", () => {
		const source = subagentDocument({ variables: CHECK_VARIABLES, actions: RUN_CHECKS_DEFINITION, instructions: RUN_CHECKS });
		expect(errors(source)).toEqual([]);
		expect(scan(source)).toEqual([]);
	});

	it("Scenario: A missing input is refused", () => {
		const source = subagentDocument({
			actions: EDIT_DEFINITION,
			instructions: 'run @actions.edit_file\n    with path = "a.ts"',
		});
		const found = scan(source);
		expect(found).toHaveLength(1);
		expect(found[0]?.construct).toContain("content");
		expect(found[0]?.construct).not.toContain("path");
	});

	it("Scenario: A model-filled input in a run is refused", () => {
		const source = subagentDocument({
			variables: CHECK_VARIABLES,
			actions: RUN_CHECKS_DEFINITION,
			instructions: "run @actions.run_checks\n    with task_id = ...",
		});
		expect(scan(source).map((c) => c.construct)).toEqual(["Ellipsis"]);
	});
});

describe("core/subset: A subagent that runs actions is deterministic", () => {
	it("Scenario: A run beside a prompt line is refused", () => {
		const source = subagentDocument({
			variables: CHECK_VARIABLES,
			actions: RUN_CHECKS_DEFINITION,
			instructions: `| Fix it.\n${RUN_CHECKS}`,
		});
		const found = scan(source);
		expect(found).toHaveLength(1);
		expect(found[0]?.where).toBe('subagent "t"');
		expect(found[0]?.construct).toBe("a prompt line beside a run statement");
	});

	it("Scenario: A run under a condition is still deterministic", () => {
		const source = subagentDocument({
			variables: `${CHECK_VARIABLES}\nready: mutable boolean = True`,
			actions: RUN_CHECKS_DEFINITION,
			instructions: `if @variables.ready:\n${RUN_CHECKS.split("\n").map((l) => `    ${l}`).join("\n")}`,
		});
		expect(errors(source)).toEqual([]);
		expect(scan(source)).toEqual([]);
	});
});

describe("core/subset: A reasoning action offers an action to the model", () => {
	it("Scenario: An entry with model-filled inputs scans clean", () => {
		const source = subagentDocument({
			actions: EDIT_DEFINITION,
			instructions: "| Edit the file.",
			reasoningActions: "edit: @actions.edit_file\n    with path = ...\n    with content = ...",
		});
		expect(errors(source)).toEqual([]);
		expect(scan(source)).toEqual([]);
	});

	it("Scenario: An entry name of run is a syntax error", async () => {
		const source = subagentDocument({
			actions: `    actions:
        run_command:
            description: "Run"
            inputs:
                command: string
            outputs:
                exit_code: number
            target: "mcpTool://run_command"
`,
			instructions: "| Run it.",
			reasoningActions: "run: @actions.run_command\n    with command = ...",
		});
		const { port, requests } = recordingPort(answered());
		const error = await run(source, { port }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(UnparsedDocumentError);
		expect((error as Error).message).toContain("Syntax error");
		expect(requests).toHaveLength(0);
	});

	it("Scenario: Reasoning actions without a prompt line are refused", () => {
		const source = subagentDocument({
			actions: EDIT_DEFINITION,
			instructions: 'set @variables.note = "x"',
			variables: 'note: mutable string = ""',
			reasoningActions: "edit: @actions.edit_file\n    with path = ...\n    with content = ...",
		});
		const found = scan(source);
		expect(found).toHaveLength(1);
		expect(found[0]?.where).toBe('subagent "t"');
		expect(found[0]?.construct).toBe("reasoning actions with no prompt line");
	});
});

describe("core/subset: @actions names only the subagent's own actions", () => {
	it("Scenario: Calling another subagent's action is refused", () => {
		const source =
			subagentDocument({
				name: "act",
				actions: EDIT_DEFINITION,
				instructions: "| Edit the file.",
				reasoningActions: "edit: @actions.edit_file\n    with path = ...\n    with content = ...",
			}) +
			`
subagent check:
    description: "c"

    reasoning:
        instructions: ->
            run @actions.edit_file
                with path = "a.ts"
                with content = "x"
`;
		const found = scan(source).filter((c) => c.where === 'subagent "check"');
		expect(found.map((c) => c.construct)).toEqual(["@actions.edit_file (not an action this subagent defines)"]);
		expect(found[0]?.construct).toContain("edit_file");
	});

	it("Scenario: @actions in a condition is refused", () => {
		const source = subagentDocument({
			actions: RUN_CHECKS_DEFINITION,
			instructions: "if @actions.run_checks:\n    | Go.",
		});
		expect(scan(source).map((c) => c.construct)).toEqual(["@actions"]);
	});
});

describe("core/subset: The supported subset is declared once, as SUPPORTED_CONSTRUCTS", () => {
	it("Scenario: Exactly one declaration exists", () => {
		const files = (dir: string): string[] =>
			readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
				const path = join(dir, entry.name);
				if (entry.isDirectory()) return files(path);
				return entry.name.endsWith(".ts") ? [path] : [];
			});
		const all = files(join(PKG_DIR, "src"));
		expect(all.length).toBeGreaterThan(10);
		// The spec's pattern, exactly.
		const matches = all.filter((file) => /(const|let|var)\s+SUPPORTED_CONSTRUCTS\s*(:|=)/.test(readFileSync(file, "utf8")));
		expect(matches.map((f) => f.slice(PKG_DIR.length + 1))).toEqual(["src/interpreter/subset.ts"]);
	});
});

describe("core/subset: Statements, expressions and defaults are limited to declared kinds", () => {
	it("Scenario: Statement and expression kinds are inside the declared kinds", () => {
		const declared = new Set(SUPPORTED_CONSTRUCTS.flatMap((c) => c.kinds));
		const listed = [...SUPPORTED_STATEMENT_KINDS, ...SUPPORTED_EXPRESSION_KINDS];
		expect(listed).toContain("RunStatement");
		for (const kind of listed) {
			expect(declared.has(kind), `${kind} is declared by no construct`).toBe(true);
			expect(SUPPORTED_NODE_KINDS).toContain(kind);
		}
	});

	it("Scenario: The scan and the reader admit the same defaults", () => {
		const source = 'variables:\n    a: mutable string = "x"\n    b: mutable number = 3\n    c: mutable boolean = True\n    d: mutable boolean = False\n';
		const declarations = readDeclarations(analyze(source).parsed);
		expect(["a", "b", "c", "d"].map((name) => declarations.get(name)?.initial)).toEqual(["x", 3, true, false]);
		expect([...SUPPORTED_DEFAULT_VALUE_KINDS].sort()).toEqual(["BooleanLiteral", "NumberLiteral", "StringLiteral"]);
	});

	it("Scenario: A default built from an expression is refused, not dropped", async () => {
		const { port, requests } = recordingPort(answered());
		const error = await run(EXPRESSION_DEFAULT, { port }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(UnsupportedConstructError);
		expect(requests).toHaveLength(0);
		const findings = (error as UnsupportedConstructError).constructs;
		expect(findings).toHaveLength(1);
		expect(findings[0]?.where).toBe('variable "b"');
		expect(findings[0]?.construct).toBe("MemberExpression as a variable's default");
		expect(findings[0]?.range.start.line).toBe(2);
	});
});

describe("the task scripts this change exists for", () => {
	it("scan clean and lint clean", () => {
		for (const name of ["task.agent", "task-delegate.agent"] as const) {
			const source = taskAgentFile(name);
			expect(errors(source), name).toEqual([]);
			expect(scan(source), name).toEqual([]);
		}
	});
});
