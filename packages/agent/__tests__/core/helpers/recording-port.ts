/**
 * A port implementation that records instead of reasoning.
 *
 * Every test in this suite injects one of these. That is not only convenience:
 * a package that shipped a default port would be a package that imported a model
 * client, and the tests would be the first place it appeared.
 */

import type { ReasoningPort, ReasoningRequest, StepOutcome } from "../../../src/interpreter/port.js";

export interface Recording {
	readonly port: ReasoningPort;
	/** Every request dispatched, in order. Empty means no model turn was made. */
	readonly requests: ReasoningRequest[];
}

/**
 * @param answers one outcome per step, in order. A step past the end of the list
 *   gets the last one, so a test that only cares about the first step says so by
 *   supplying one answer rather than by counting.
 */
export function recordingPort(...answers: StepOutcome[]): Recording {
	const requests: ReasoningRequest[] = [];
	const port: ReasoningPort = {
		async reason(request: ReasoningRequest): Promise<StepOutcome> {
			requests.push(request);
			const answer = answers[Math.min(requests.length - 1, answers.length - 1)];
			return answer ?? { kind: "answered", text: "" };
		},
	};
	return { port, requests };
}

/** The everyday outcome: the step answered, with text and nothing structured. */
export function answered(text = "ok"): StepOutcome {
	return { kind: "answered", text };
}
