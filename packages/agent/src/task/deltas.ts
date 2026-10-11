/** A spec delta's text with the capability it changes. */
export interface Delta {
	readonly capability: string;
	readonly text: string;
}

/** Every delta, in order, each under a `## <capability>` line, one blank line apart. */
export function concatDeltas(deltas: readonly Delta[]): string {
	return deltas.map((delta) => `## ${delta.capability}\n${delta.text.replace(/\n+$/, "")}\n`).join("\n");
}

/** A `{ path }` delta's capability: what lies between `specs/` and `/spec.md`, else the path itself. */
export function capabilityOfPath(path: string): string {
	const normalised = path.split("\\").join("/");
	const m = /(?:^|\/)specs\/(.+)\/spec\.md$/.exec(normalised);
	return m?.[1] ?? path;
}
