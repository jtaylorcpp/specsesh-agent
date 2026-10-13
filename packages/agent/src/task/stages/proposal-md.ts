/**
 * A proposal.md draft, read as text: its `## ` sections in document order and
 * the capability paths its `## Capabilities` section names. Pure string
 * parsing; whether a section is missing or a path is wrong is the gate's call.
 */

/** The sections a proposal holds, in the order it holds them. */
export const PROPOSAL_SECTIONS = ["Why", "What Changes", "Out of scope", "Capabilities", "Impact"] as const;

const HEADING = /^## (.+?)\s*$/;
const FENCE = /^\s*```/;
const CAPABILITY = /`([a-z0-9-]+\/[a-z0-9-]+)`/g;

export interface ProposalSection {
	/** The heading's text, trimmed, without `## `. */
	readonly heading: string;
	/** The heading's 1-based line number. */
	readonly line: number;
	/** Everything after the heading line, up to the next `## ` heading or the end. */
	readonly body: string;
}

/** Every level-2 heading outside a ``` fence, in document order, each with its body. */
export function proposalSections(markdown: string): ProposalSection[] {
	const lines = markdown.replace(/\r\n/g, "\n").split(/(?<=\n)/);
	const sections: { heading: string; line: number; body: string[] }[] = [];
	let fenced = false;
	lines.forEach((line, index) => {
		if (FENCE.test(line)) fenced = !fenced;
		const heading = fenced ? null : HEADING.exec(line.replace(/\n$/, ""));
		if (heading) sections.push({ heading: (heading[1] as string).trim(), line: index + 1, body: [] });
		else sections.at(-1)?.body.push(line);
	});
	return sections.map(({ heading, line, body }) => ({ heading, line, body: body.join("") }));
}

/**
 * The `area/name` paths after `**New:**` and `**Modified:**` in `## Capabilities`,
 * on the label's line and the nested bullets below it, until the next label.
 * Each list keeps first appearance order without duplicates; no section, or no label, is two empty lists.
 */
export function readProposalCapabilities(markdown: string): { new: string[]; modified: string[] } {
	const found = { new: new Set<string>(), modified: new Set<string>() };
	const section = proposalSections(markdown).find((s) => s.heading === "Capabilities");
	let label: keyof typeof found | undefined;
	for (const line of section?.body.split("\n") ?? []) {
		if (line.includes("**New:**")) label = "new";
		if (line.includes("**Modified:**")) label = "modified";
		if (label === undefined) continue;
		for (const m of line.matchAll(CAPABILITY)) found[label].add(m[1] as string);
	}
	return { new: [...found.new], modified: [...found.modified] };
}
