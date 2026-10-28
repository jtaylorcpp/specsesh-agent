/**
 * Tools for `tools.agent`, loaded with `--tools examples/tools/tools.mjs`.
 *
 * Plain JavaScript (ESM): the bins load no TypeScript, so compile a `.ts` module first.
 * The default export is a `HostAction[]`; a function of `{ workspace }` returning one
 * (sync or async) works too, as does a named `tools` export.
 */
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
	{
		name: "word_count",
		kind: "read",
		inputs: { text: "string" },
		outputs: { count: "number" },
		replay: "safe",
		async execute({ text }) {
			const words = String(text).trim().split(/\s+/).filter(Boolean);
			return { ok: true, outputs: { count: words.length } };
		},
	},
];
