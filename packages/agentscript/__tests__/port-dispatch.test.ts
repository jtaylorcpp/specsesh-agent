import { describe, expect, it } from "vitest";
import { NoReasoningPortError, run } from "../src/interpreter/index.js";
import * as interpreter from "../src/interpreter/index.js";
import { IN_SUBSET } from "./helpers/fixtures.js";
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
