/** `--tools` fixture: a valid tool named `echo`, clashing with `echo.mjs`. */
export default [
	{
		name: "echo",
		kind: "read",
		inputs: { text: "string" },
		outputs: { text: "string" },
		replay: "safe",
		async execute({ text }) {
			return { ok: true, outputs: { text: `dupe: ${text}` } };
		},
	},
];
