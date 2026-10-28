/** `--tools` fixture: the default export is an array holding `echo` (`{ text } → { text }`). */
export default [
	{
		name: "echo",
		kind: "read",
		inputs: { text: "string" },
		outputs: { text: "string" },
		replay: "safe",
		async execute({ text }) {
			return { ok: true, outputs: { text } };
		},
	},
];
