/** `--tools` fixture: `echo` (`{ text } → { text }`), which kills its process with 137 when `CRASH_ON_ECHO=1`. */
export default [
	{
		name: "echo",
		kind: "read",
		inputs: { text: "string" },
		outputs: { text: "string" },
		replay: "safe",
		async execute({ text }) {
			if (process.env.CRASH_ON_ECHO === "1") process.exit(137);
			return { ok: true, outputs: { text } };
		},
	},
];
