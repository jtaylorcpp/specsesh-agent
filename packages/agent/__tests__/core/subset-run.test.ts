import { describe, expect, it } from "vitest";
import { run } from "../../src/interpreter/index.js";
import { BOOLEAN_COMPARISON, IN_SUBSET } from "./helpers/fixtures.js";
import { answered, recordingPort } from "./helpers/recording-port.js";

describe("platform-agentscript-interpreter: The Interpreter Runs An Enumerated Subset, Declared In One Place", () => {
	it("Scenario: A document within the subset — a document using only supported constructs executes", async () => {
		const { port, requests } = recordingPort(answered("done"));

		const result = await run(IN_SUBSET, { port });

		expect(result.kind).toBe("completed");
		expect(requests).toHaveLength(1);
		expect(result.steps.map((s) => s.subagent)).toEqual(["draft"]);
		// It executed rather than merely not throwing: the deterministic `set` ran
		// and the conditional took the branch the authored value selects.
		expect(result.variables["stage"]).toBe("specs");
		expect(requests[0]?.prompt).toContain("Ask the author to approve first.");
	});

	it("Scenario: A boolean literal in an expression — the dialect's spelling, evaluated as a value", async () => {
		// `True` / `False` are `BooleanLiteral` nodes, and the subset excluded that
		// kind entirely. What it admitted instead was `Identifier` named `true` /
		// `false` — the lower-case spelling the dialect reports as an ERROR ("Did
		// you mean 'False' (capitalized)?"). So a boolean was either runnable or
		// saveable and never both, and the fixture that claimed to hold "every
		// construct in the subset" was on the unsaveable side of that trade.
		//
		// A comparison rather than a bare default, deliberately: the two positions
		// are scanned against different lists, and `IN_SUBSET` only ever exercises
		// the default one.
		const { port, requests } = recordingPort(answered());

		const result = await run(BOOLEAN_COMPARISON, { port });

		// Decided deterministically, with no dispatch: `False == False` holds.
		expect(requests).toHaveLength(0);
		expect(result.kind).toBe("completed");
		expect(result.variables["stage"]).toBe("blocked");
		expect(result.variables["approved"]).toBe(false);

		// And the other branch, seeded — so the comparison is really being
		// evaluated rather than always falling one way.
		const other = await run(BOOLEAN_COMPARISON, {
			port: recordingPort(answered()).port,
			variables: { approved: true },
		});
		expect(other.variables["stage"]).toBe("specs");
	});
});
