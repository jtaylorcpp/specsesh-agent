import { describe, expect, it } from "vitest";
import { analyze } from "../src/authoring/index.js";
import { NoReasoningPortError, UnparsedDocumentError, run } from "../src/interpreter/index.js";
import * as interpreter from "../src/interpreter/index.js";
import { IN_SUBSET, TWO_STEPS } from "./helpers/fixtures.js";
import { answered, recordingPort } from "./helpers/recording-port.js";

describe("platform-agentscript-interpreter: Reasoning Goes Out Through A Declared Port, And The Package Imports No Model Client", () => {
	it("Scenario: A reasoning step runs — the turn is made through the injected port", async () => {
		const { port, requests } = recordingPort(answered("drafted"));

		const result = await run(IN_SUBSET, { port });

		expect(requests).toHaveLength(1);
		expect(result.steps).toHaveLength(1);
		expect(result.steps[0]?.outcome).toEqual({ kind: "answered", text: "drafted" });
		// The injected object is what answered — not a sibling the package built.
		expect(result.steps[0]?.request).toBe(requests[0]);
	});

	it("Scenario: System instructions travel beside the prompt, not inside it", async () => {
		const { port, requests } = recordingPort(answered());

		await run(IN_SUBSET, { port });

		const request = requests[0];
		expect(request?.systemInstructions).toBe("You walk the author through one OpenSpec change.");
		// Its own channel, not a prefix. A boundary that fuses the agent's standing
		// character with this step's request can never treat them differently again.
		expect(request?.prompt).not.toContain("You walk the author");
		expect(request?.prompt).toBe(
			"Read the current artifact.\nAsk the author to approve first.",
		);
	});

	it("Scenario: No port is injected — the run is refused and no default is constructed", async () => {
		await expect(run(IN_SUBSET)).rejects.toBeInstanceOf(NoReasoningPortError);
		await expect(run(IN_SUBSET, {})).rejects.toThrow(/no reasoning port was provided/);

		// And nothing in the surface could have been used as one: a default port
		// would mean a model client in a package whose whole shape is not having
		// one. `NoReasoningPortError` is a class, not an implementation.
		const implementations = Object.entries(interpreter).filter(
			([, value]) =>
				typeof value === "object" && value !== null && typeof Reflect.get(value, "reason") === "function",
		);
		expect(implementations).toEqual([]);
	});
});

/** A system block that interpolates a declared variable, with a prompt to dispatch. */
const SYSTEM_INTERPOLATION = `system:
    instructions: |
        You are working on the {!@variables.stage}.

variables:
    stage: mutable string = "proposal"

subagent draft:
    description: "Fill the proposal"

    reasoning:
        instructions: ->
            | Read the current artifact.
`;

/** Declares a subagent and no `system:` block at all. */
const NO_SYSTEM_BLOCK = `subagent draft:
    description: "Fill the proposal"

    reasoning:
        instructions: ->
            | Read the current artifact.
`;

describe("core-reasoning-port: System instructions travel as their own channel", () => {
	it("Scenario: No system block", async () => {
		expect(analyze(NO_SYSTEM_BLOCK).diagnostics).toEqual([]);
		const { port, requests } = recordingPort(answered());

		await run(NO_SYSTEM_BLOCK, { port });

		expect(requests).toHaveLength(1);
		expect(requests[0]?.systemInstructions).toBe("");
		expect(requests[0]?.prompt).toBe("Read the current artifact.");
	});

	it("Scenario: Every step carries the same instructions", async () => {
		const { port, requests } = recordingPort(answered("first"), answered("second"));

		await run(TWO_STEPS, { port, entry: ["first", "second"] });

		expect(requests).toHaveLength(2);
		expect(requests[0]?.systemInstructions).toBe("You walk the author through one OpenSpec change.");
		expect(requests[1]?.systemInstructions).toBe(requests[0]?.systemInstructions);
	});
});

describe("core-reasoning-port: System instructions are not composed against run state", () => {
	it("Scenario: An interpolation in the system block is not filled in", async () => {
		expect(analyze(SYSTEM_INTERPOLATION).diagnostics).toEqual([]);
		const { port, requests } = recordingPort(answered());

		await run(SYSTEM_INTERPOLATION, { port });

		const system = requests[0]?.systemInstructions;
		expect(system).toContain("{!@variables.stage}");
		// Not filled in, and not an empty hole either.
		expect(system).not.toContain("proposal");
		expect(system).toBe("You are working on the {!@variables.stage}.");
	});
});

describe("core-reasoning-port: There is no default port", () => {
	it("Scenario: No port is refused before the document is read", async () => {
		// A source the dialect cannot make sense of: read first, it would be a
		// document error. The port is checked before anything is parsed.
		const unparsable = 'subagent draft:\n    set @variables.stage = "unterminated\n';
		expect(analyze(unparsable).diagnostics.length).toBeGreaterThan(0);

		const error = await run(unparsable).then(
			() => undefined,
			(err: unknown) => err,
		);

		expect(error).toBeInstanceOf(NoReasoningPortError);
		expect(error).not.toBeInstanceOf(UnparsedDocumentError);
		expect((error as Error).name).toBe("NoReasoningPortError");

		// And with the port supplied the same text IS a document error, so the
		// ordering above is what the test observed rather than a source that
		// would have been accepted anyway.
		const { port, requests } = recordingPort(answered());
		await expect(run(unparsable, { port })).rejects.not.toBeInstanceOf(NoReasoningPortError);
		expect(requests).toHaveLength(0);
	});
});
