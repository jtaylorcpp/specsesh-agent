import { describe, expect, it } from "vitest";
import {
	NoReasoningPortError,
	UnparsedDocumentError,
	apply,
	next,
	run,
	start,
} from "../../src/interpreter/index.js";
import { TWO_STEPS, UNTERMINATED_STRING } from "./helpers/fixtures.js";
import { answered, recordingPort } from "./helpers/recording-port.js";

const persist = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("platform-agentscript-step-machine: Run Drives The Step Machine Through A Port", () => {
	it("Scenario: No port means a refusal, not a default", async () => {
		await expect(run(TWO_STEPS, { entry: ["first", "second"] })).rejects.toBeInstanceOf(NoReasoningPortError);
	});

	it("Scenario: run and the hand-driven machine agree", async () => {
		const answers = [answered("drafted"), answered("reviewed")];
		const entry = ["first", "second"];
		const { port } = recordingPort(...answers);
		const viaRun = await run(TWO_STEPS, { port, entry });

		let state = persist(start(TWO_STEPS, { entry }));
		let result;
		for (let i = 0; result === undefined; i += 1) {
			const step = next(TWO_STEPS, state);
			if (step.type === "done") {
				result = step.result;
			} else if (step.type === "request") {
				state = persist(apply(TWO_STEPS, persist(step.state), answers[i] ?? answered("ok")));
			} else {
				throw new Error("this fixture runs no actions");
			}
		}

		expect(result).toEqual(viaRun);
		expect(result.kind).toBe("completed");
	});

	it("Scenario: A refused document never reaches the port", async () => {
		const { port, requests } = recordingPort(answered());
		await expect(run(UNTERMINATED_STRING, { port })).rejects.toBeInstanceOf(UnparsedDocumentError);
		expect(requests).toEqual([]);
	});
});
