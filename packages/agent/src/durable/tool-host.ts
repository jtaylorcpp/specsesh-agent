/**
 * `registryHost`: an action registry as the two hosts a one-shot `run()` takes,
 * `actionHost` for its `run` statements and `toolHost` for the pi port's offered
 * tools. Both run the same lookup and never throw: a missing tool, a durable
 * action, a throwing `execute` and outputs that break the declaration each answer
 * `ok: false`. Runtime-neutral: no `node:` import.
 */

import type { ActionCall, ActionResult, VariableValue } from "../interpreter/index.js";
import type { PiToolCall, PiToolHost } from "../pi/port.js";
import { type ActionRegistry, checkDeclaredOutputs, isDurable } from "./actions.js";

export interface RegistryHostOptions {
	/** The directory passed to every `execute` as `workspace`. */
	readonly workspace: string;
	readonly signal?: AbortSignal;
}

export interface RegistryHost {
	readonly actionHost: (call: ActionCall) => Promise<ActionResult>;
	readonly toolHost: PiToolHost;
}

export function registryHost(registry: ActionRegistry, options: RegistryHostOptions): RegistryHost {
	const { workspace, signal } = options;

	async function invoke(tool: string, inputs: Readonly<Record<string, unknown>>): Promise<ActionResult> {
		const action = registry.get(tool);
		if (action === undefined) return { ok: false, message: `mcpTool://${tool} is not registered on this host` };
		if (isDurable(action)) return { ok: false, message: `${tool} runs only in a durable host` };
		try {
			const result = await action.execute(inputs as Readonly<Record<string, VariableValue>>, {
				workspace,
				...(signal !== undefined ? { signal } : {}),
			});
			if (result.ok !== true) return result;
			const mismatch = checkDeclaredOutputs(action, result.outputs ?? {});
			return mismatch === undefined ? result : { ok: false, message: mismatch };
		} catch (error) {
			return { ok: false, message: error instanceof Error ? error.message : String(error) };
		}
	}

	return {
		actionHost: (call: ActionCall) => invoke(call.tool, call.inputs),
		toolHost: (call: PiToolCall) => invoke(call.tool, call.inputs),
	};
}
