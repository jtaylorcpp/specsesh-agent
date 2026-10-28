/** `--tools` fixture: an entry with a `durable` pair, which a module may not register. */
export default [
	{
		name: "child",
		kind: "delegate",
		inputs: { text: "string" },
		outputs: { text: "string" },
		replay: "safe",
		durable: {
			async start() {
				return { ok: false, message: "never started" };
			},
			async finish() {
				return { ok: false, message: "never finished" };
			},
		},
		async execute({ text }) {
			return { ok: true, outputs: { text } };
		},
	},
];
