import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyze } from "../src/authoring/index.js";
import { collectUndeclaredReferences } from "../src/interpreter/compose.js";
import { UndeclaredVariableError, UnparsedDocumentError, run } from "../src/interpreter/index.js";
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
