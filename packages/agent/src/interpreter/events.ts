/**
 * What a run reports while it runs.
 *
 * Every event is plain JSON, so a durable host can produce the same ones from a
 * checkpointed run. `step` is the 0-based index into `result.steps`; for an action
 * event it is the index of the step that follows. The port reports `StreamDelta`s
 * and the runner tags each with the current step and subagent.
 */

import type { StepOutcome } from "./port.js";
import type { RunResult } from "./run.js";

/** What a port may report through `reason`'s second argument while a step runs. */
export type StreamDelta =
	| { readonly type: "text_delta"; readonly delta: string }
	| { readonly type: "thinking_delta"; readonly delta: string }
	| { readonly type: "tool_call"; readonly name: string; readonly inputs: Readonly<Record<string, unknown>> }
	| { readonly type: "tool_result"; readonly name: string; readonly ok: boolean; readonly outputs: unknown };

/** The second argument to `reason`, passed only when the run has a listener. */
export interface StreamSink {
	onDelta(delta: StreamDelta): void;
}

interface Tagged {
	readonly step: number;
	readonly subagent: string;
}

export type RunEvent =
	| ({ readonly type: "step_start" } & Tagged)
	| ({ readonly type: "step_end"; readonly outcome: StepOutcome } & Tagged)
	| (StreamDelta & Tagged)
	| ({
			readonly type: "action_start";
			readonly action: string;
			readonly tool: string;
			readonly inputs: Readonly<Record<string, unknown>>;
	  } & Tagged)
	| ({
			readonly type: "action_end";
			readonly action: string;
			readonly tool: string;
			readonly ok: boolean;
			readonly outputs: Readonly<Record<string, unknown>>;
	  } & Tagged)
	| { readonly type: "run_end"; readonly result: RunResult };
