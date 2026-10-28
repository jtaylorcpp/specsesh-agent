/**
 * `--tools` fixture for the spawned CLI: a named `tools` function that appends
 * its argument to `<workspace>/tools-calls.jsonl`, returning `echo`
 * (`{ text } → { text }`), whose `execute` appends its inputs to
 * `<workspace>/echo-calls.jsonl`.
 */
import { appendFileSync } from "node:fs";
import { join } from "node:path";

export function tools(arg) {
	appendFileSync(join(arg.workspace, "tools-calls.jsonl"), JSON.stringify(arg) + "\n");
	return [
		{
			name: "echo",
			kind: "read",
			inputs: { text: "string" },
			outputs: { text: "string" },
			replay: "safe",
			async execute(inputs, { workspace }) {
				appendFileSync(join(workspace, "echo-calls.jsonl"), JSON.stringify(inputs) + "\n");
				return { ok: true, outputs: { text: inputs.text } };
			},
		},
	];
}
