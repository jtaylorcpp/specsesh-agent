/** `--tools` fixture: an otherwise valid entry with no `execute`. */
export default [
	{
		name: "no_execute",
		kind: "read",
		inputs: { text: "string" },
		outputs: { text: "string" },
		replay: "safe",
	},
];
