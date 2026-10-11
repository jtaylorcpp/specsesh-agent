import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyze } from "../../src/authoring/index.js";
import { collectUndeclaredReferences } from "../../src/interpreter/compose.js";
import { UndeclaredVariableError, UnparsedDocumentError, run } from "../../src/interpreter/index.js";
import {
	IN_SUBSET,
	PERSISTED_BOOLEAN,
	TWO_STEPS,
	UNDECLARED_REFERENCE,
} from "./helpers/fixtures.js";
import { answered, recordingPort } from "./helpers/recording-port.js";

describe("platform-agentscript-interpreter: The Document's Declared Variables Are The Run's Initial State", () => {
	it("Scenario: The port remembers nothing — the second step carries its own system instructions and prompt in full", async () => {
		const { port, requests } = recordingPort(answered("first"), answered("second"));

		const result = await run(TWO_STEPS, { port, entry: ["first", "second"] });

		expect(result.steps.map((s) => s.subagent)).toEqual(["first", "second"]);
		expect(requests).toHaveLength(2);

		const [one, two] = requests;
		// Each step restates the standing instructions rather than assuming the
		// first left them behind.
		expect(one?.systemInstructions).toBe("You walk the author through one OpenSpec change.");
		expect(two?.systemInstructions).toBe(one?.systemInstructions);

		// And each carries its own prompt in full — the second's text reads the
		// state the first wrote, but takes it from the INTERPRETER's state, not
		// from anything the port retained.
		expect(one?.prompt).toBe("Draft the proposal.");
		expect(two?.prompt).toBe("Review the specs.");

		// The proof that nothing was retained: a brand new port, with no history at
		// all, answers the second step's request identically.
		const naive = recordingPort(answered());
		await naive.port.reason(two!);
		expect(naive.requests[0]).toEqual(two);
	});

	it("Scenario: An authored value is the starting value", async () => {
		const { port, requests } = recordingPort(answered());

		const result = await run(TWO_STEPS, { port, entry: "first" });

		// `stage: mutable string = "proposal"` in the document IS the run's opening
		// state — there is no separate seeding step that could disagree with it.
		expect(requests[0]?.prompt).toBe("Draft the proposal.");
		expect(result.steps).toHaveLength(1);
		// And the value the run ends with is the one its own `set` produced.
		expect(result.variables["stage"]).toBe("specs");
	});

	it("Scenario: A run does not edit the script", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agentscript-run-"));
		const file = join(dir, "agent.as");
		writeFileSync(file, TWO_STEPS, "utf8");

		const { port } = recordingPort(answered());
		const result = await run(readFileSync(file, "utf8"), { port, entry: "first" });

		// `stage` moved from "proposal" to "specs" during the run.
		expect(result.variables["stage"]).toBe("specs");
		// The document did not. The interpreter writes no files at all, and offers
		// nothing to write unless asked.
		expect(readFileSync(file, "utf8")).toBe(TWO_STEPS);
		expect(result.updatedSource).toBeUndefined();

		// Asked for, it hands back TEXT and still writes nothing itself.
		const asked = await run(readFileSync(file, "utf8"), {
			port: recordingPort(answered()).port,
			entry: "first",
			persistVariables: true,
		});
		expect(asked.updatedSource).toContain('stage: mutable string = "specs"');
		expect(readFileSync(file, "utf8")).toBe(TWO_STEPS);
	});

	it("Scenario: An undeclared variable — the run is refused, naming it, and it is not resolved to an empty value", async () => {
		const { port, requests } = recordingPort(answered());

		const error = (await run(UNDECLARED_REFERENCE, { port }).then(
			() => undefined,
			(err: unknown) => err,
		)) as UnparsedDocumentError;

		// The DIALECT's own `undefined-reference` pass reports this at error
		// severity, and the runner now refuses on error-severity diagnostics before
		// it scans — so this is the refusal a caller gets, and it names the
		// variable and where it is read.
		expect(error).toBeInstanceOf(UnparsedDocumentError);
		expect(error.message).toContain("approved");
		expect(error.diagnostics.map((d) => d.message)).toEqual([
			"'approved' is not defined in variables",
		]);
		// Refused, not resolved: an `if` on a variable nobody declared would read
		// as false and skip the branch, and nothing would ever say why.
		expect(requests).toHaveLength(0);

		// And the interpreter's OWN check is live rather than shadowed into
		// decoration. It walks the whole document up front — including branches a
		// run would never enter — and its message is the one that says WHY the
		// reference is refused instead of resolved.
		const problems = collectUndeclaredReferences(
			analyze(UNDECLARED_REFERENCE).parsed,
			new Set(["stage"]),
		);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toBeInstanceOf(UndeclaredVariableError);
		expect(problems[0]?.variable).toBe("approved");
		expect(problems[0]?.message).toContain("not resolved to an empty value");
		// Positioned at the reference itself, not at the top of the file.
		expect(problems[0]?.range.start.line).toBeGreaterThan(0);

		// The declared variable in the same document is fine — this is about the
		// reference, not about the document being unreadable.
		const ok = await run(IN_SUBSET, { port: recordingPort(answered()).port });
		expect(ok.kind).toBe("completed");
	});

	it("Scenario: Persistence writes the dialect's spelling, so a saved run still lints clean", async () => {
		// `literal()` wrote `String(true)` — JavaScript's lower-case `true`, which
		// Agent Script reports as an error ("Did you mean 'True' (capitalized)?").
		// Persisting a run therefore took a document that lints clean and handed
		// back one that does not: an agent silently rewriting the author's script
		// into a broken one.
		const { port } = recordingPort(answered());
		const result = await run(PERSISTED_BOOLEAN, { port, persistVariables: true });

		expect(result.variables["approved"]).toBe(true);
		expect(result.updatedSource).toContain("approved: mutable boolean = True");
		expect(result.updatedSource).not.toContain("= true");
		// The proof that matters: hand the rewritten text back to the authoring
		// surface and it must be as clean as what went in.
		expect(analyze(PERSISTED_BOOLEAN).diagnostics).toEqual([]);
		expect(analyze(result.updatedSource as string).diagnostics.map((d) => d.message)).toEqual([]);
	});
});

/** One subagent over the given declarations and instruction lines. */
function stateDocument(declarations: readonly string[], statements: readonly string[], extra = ""): string {
	return [
		"variables:",
		...declarations.map((line) => `    ${line}`),
		"",
		"subagent draft:",
		'    description: "Draft it"',
		"",
		"    reasoning:",
		"        instructions: ->",
		...statements.map((line) => `            ${line}`),
		"",
		...(extra === "" ? [] : [extra, ""]),
	].join("\n");
}

function lintMessages(source: string): string[] {
	return analyze(source).diagnostics.map((d) => d.message);
}

describe("core-composition: Declared variables are the run's initial state", () => {
	it("Scenario: Each literal kind starts as its JavaScript value", async () => {
		const source = stateDocument(
			['name: mutable string = "World"', "count: mutable number = 3", "approved: mutable boolean = False"],
			["| Greet {!@variables.name}, {!@variables.count} times, approved: {!@variables.approved}."],
		);
		expect(lintMessages(source)).toEqual([]);
		const { port } = recordingPort(answered());

		const result = await run(source, { port });

		expect(result.variables).toEqual({ name: "World", count: 3, approved: false });
		// Types, not just looks: `3` is a number and `false` the boolean.
		expect(typeof result.variables["count"]).toBe("number");
		expect(result.variables["approved"]).toBe(false);
	});
});

describe("core-composition: Both declaration forms are read the same way", () => {
	it("Scenario: Both declaration forms seed state", async () => {
		const source = stateDocument(
			['stage: mutable string = "proposal"', 'change_id: string = "OS-1"'],
			["| Draft {!@variables.change_id} at {!@variables.stage}."],
		);
		expect(lintMessages(source)).toEqual([]);
		const { port, requests } = recordingPort(answered());

		const result = await run(source, { port });

		expect(result.variables).toEqual({ stage: "proposal", change_id: "OS-1" });
		expect(requests[0]?.prompt).toBe("Draft OS-1 at proposal.");
	});

	it("Scenario: A description changes nothing", async () => {
		const source = stateDocument(
			['name: mutable string = "World"', '    description: "who to greet"'],
			["| Greet {!@variables.name}."],
		);
		expect(lintMessages(source)).toEqual([]);
		const { port, requests } = recordingPort(answered());

		const result = await run(source, { port });

		expect(result.variables["name"]).toBe("World");
		expect(requests[0]?.prompt).toBe("Greet World.");
	});
});

describe("core-composition: Every undeclared reference is refused before anything runs", () => {
	// Every document here is refused by the dialect's own `undefined-reference`
	// error before the interpreter's check is reached (see the scenario in
	// "The Document's Declared Variables Are The Run's Initial State"), so `run`
	// rejects with `UnparsedDocumentError` naming the variable. The interpreter's
	// own check is exercised directly: it is the one that must cover every
	// position, whatever the lint happens to catch.
	async function refusal(source: string, ghost: string) {
		const { port, requests } = recordingPort(answered());
		const error = (await run(source, { port }).then(
			() => undefined,
			(err: unknown) => err,
		)) as UnparsedDocumentError;
		expect(error).toBeInstanceOf(UnparsedDocumentError);
		expect(error.diagnostics.map((d) => d.message)).toEqual([`'${ghost}' is not defined in variables`]);
		expect(requests).toHaveLength(0);
		return collectUndeclaredReferences(analyze(source).parsed, new Set(["ok", "stage"]));
	}

	it("Scenario: An undeclared reference on a branch nobody takes", async () => {
		const source = stateDocument(
			["ok: mutable boolean = True", 'stage: mutable string = "proposal"'],
			["| Read the {!@variables.stage}.", "if @variables.ok:", "    | Taken.", "else:", '    set @variables.ghost = "y"'],
		);

		const problems = await refusal(source, "ghost");

		expect(problems.map((p) => p.variable)).toEqual(["ghost"]);
		expect(problems[0]).toBeInstanceOf(UndeclaredVariableError);
	});

	it("Scenario: An undeclared reference in a subagent the run never enters", async () => {
		const source = stateDocument(
			["ok: mutable boolean = True", 'stage: mutable string = "proposal"'],
			["| Read the {!@variables.stage}."],
			[
				"subagent review:",
				'    description: "Never entered"',
				"",
				"    reasoning:",
				"        instructions: ->",
				"            | Review {!@variables.ghost}.",
				"            if @variables.ok:",
				"                | Fine.",
			].join("\n"),
		);

		// `entry` names only the first subagent; the second is checked all the same.
		const problems = await refusal(source, "ghost");

		expect(problems.map((p) => p.variable)).toEqual(["ghost"]);
	});
});

describe("core-composition: The undeclared check covers every reading and writing position", () => {
	async function refusal(source: string, ghost: string) {
		const { port, requests } = recordingPort(answered());
		const error = (await run(source, { port }).then(
			() => undefined,
			(err: unknown) => err,
		)) as UnparsedDocumentError;
		expect(error).toBeInstanceOf(UnparsedDocumentError);
		expect(error.diagnostics.map((d) => d.message)).toEqual([`'${ghost}' is not defined in variables`]);
		expect(requests).toHaveLength(0);
		return collectUndeclaredReferences(analyze(source).parsed, new Set(["ok", "stage"]));
	}

	it("Scenario: An undeclared set target", async () => {
		const source = stateDocument(
			["ok: mutable boolean = True", 'stage: mutable string = "proposal"'],
			["| Read the {!@variables.stage}.", "if @variables.ok:", '    set @variables.nowhere = "x"'],
		);

		const problems = await refusal(source, "nowhere");

		expect(problems.map((p) => p.variable)).toEqual(["nowhere"]);
	});

	it("Scenario: An undeclared read on the right of or", async () => {
		const source = stateDocument(
			["ok: mutable boolean = True", 'stage: mutable string = "proposal"'],
			["| Read the {!@variables.stage}.", "if @variables.ok or @variables.ghost:", "    | Taken."],
		);

		// `ok` is true, so evaluation would never reach `ghost`; the check does.
		const problems = await refusal(source, "ghost");

		expect(problems.map((p) => p.variable)).toEqual(["ghost"]);
	});
});

describe("core-composition: An undeclared reference error names the reference and its position", () => {
	it("Scenario: Each reference reports its own position", async () => {
		const line = "| {!@variables.stage} then {!@variables.bad}.";
		const source = stateDocument(['stage: mutable string = "proposal"'], [line]);
		expect(lintMessages(source)).toEqual(["'bad' is not defined in variables"]);
		const { port, requests } = recordingPort(answered());
		await expect(run(source, { port })).rejects.toBeInstanceOf(UnparsedDocumentError);
		expect(requests).toHaveLength(0);

		const problems = collectUndeclaredReferences(analyze(source).parsed, new Set(["stage"]));

		expect(problems).toHaveLength(1);
		const error = problems[0] as UndeclaredVariableError;
		expect(error.name).toBe("UndeclaredVariableError");
		expect(error.variable).toBe("bad");
		const lines = source.split("\n");
		const row = lines.findIndex((l) => l.includes(line));
		const column = (lines[row] as string).indexOf("{!@variables.bad}");
		// The reference's own start, past the `{!@variables.stage}` before it —
		// not the start of the line holding both.
		expect(error.range.start).toEqual({ line: row, character: column });
		expect(column).toBeGreaterThan((lines[row] as string).indexOf("|") + 2);
		expect(error.message).toContain("@variables.bad");
		expect(error.message).toContain(`${row + 1}:${column + 1}`);
		expect(error.message).toContain("declares no such variable");
	});
});

describe("core-composition: A run does not edit the script unless asked", () => {
	it("Scenario: Nothing changed means identical text", async () => {
		const source = stateDocument(
			['stage: mutable string = "proposal"', "count: mutable number = 3", "approved: mutable boolean = False"],
			["| Draft the {!@variables.stage}, {!@variables.count}, {!@variables.approved}."],
		);
		expect(lintMessages(source)).toEqual([]);
		const { port } = recordingPort(answered());

		const result = await run(source, { port, persistVariables: true });

		expect(result.variables).toEqual({ stage: "proposal", count: 3, approved: false });
		expect(result.updatedSource).toBe(source);
	});
});

describe("core-composition: Persistence rewrites only changed values, in the dialect's spelling", () => {
	it("Scenario: Only the value span changes", async () => {
		const source = [
			"variables:",
			'    stage: mutable string = "proposal"  # the working stage',
			'        description: "proposal | specs"',
			"    count: mutable number = 3",
			"",
			"subagent draft:",
			'    description: "Draft it"',
			"",
			"    reasoning:",
			"        instructions: ->",
			"            | Draft the {!@variables.stage}, {!@variables.count} times.",
			'            set @variables.stage = "say \\"hi\\""',
			"",
		].join("\n");
		expect(lintMessages(source)).toEqual([]);
		const { port } = recordingPort(answered());

		const result = await run(source, { port, persistVariables: true });

		expect(result.variables["stage"]).toBe('say "hi"');
		expect(result.updatedSource).toBe(source.replace('= "proposal"', '= "say \\"hi\\""'));
		// The unchanged number, the comment, the description and the body survive.
		expect(result.updatedSource).toContain("count: mutable number = 3");
		expect(result.updatedSource).toContain("# the working stage");
		expect(result.updatedSource).toContain('description: "proposal | specs"');
		expect(lintMessages(result.updatedSource as string)).toEqual([]);
	});
});
