/** `--tools` fixture: a named `tools` function that records each argument it is called with. */
export const calls = [];

export function tools(arg) {
	calls.push(arg);
	return [
		{
			name: "fn_echo",
			kind: "read",
			inputs: { text: "string" },
			outputs: { text: "string" },
			replay: "safe",
			async execute({ text }) {
				return { ok: true, outputs: { text } };
			},
		},
	];
}
