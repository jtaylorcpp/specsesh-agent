import { describe, expect, it } from "vitest";
import { PROPOSAL_SECTIONS, proposalSections, readProposalCapabilities } from "../../../src/task/stages/proposal-md.js";

function proposal(capabilities: string, sections: readonly string[] = PROPOSAL_SECTIONS): string {
	return sections.map((heading) => `## ${heading}\n\n${heading === "Capabilities" ? capabilities : `${heading} text.`}\n`).join("\n");
}

describe("task/stages/proposal-md: scenarios", () => {
	it("Scenario: Capabilities in nested bullets", () => {
		const text = proposal("- **Modified:**\n  - `task/cli`;\n  - `task/headless`.\n");
		expect(readProposalCapabilities(text)).toEqual({ new: [], modified: ["task/cli", "task/headless"] });
	});
});

describe("task/stages/proposal-md: proposalSections", () => {
	it("returns the five sections in document order", () => {
		const sections = proposalSections(proposal("- **New:** `spec/stages`."));
		expect(sections.map((s) => s.heading)).toEqual([...PROPOSAL_SECTIONS]);
		expect(sections.map((s) => s.line)).toEqual([1, 5, 9, 13, 17]);
		expect(sections[0]?.body).toBe("\nWhy text.\n\n");
		expect(sections[4]?.body).toBe("\nImpact text.\n");
	});

	it("leaves out a missing Out of scope section", () => {
		const sections = proposalSections(proposal("", PROPOSAL_SECTIONS.filter((s) => s !== "Out of scope")));
		expect(sections.map((s) => s.heading)).toEqual(["Why", "What Changes", "Capabilities", "Impact"]);
	});

	it("does not count a heading inside a code fence", () => {
		const text = "## Why\n\n```markdown\n## X\n```\n\n## Impact\r\nnone\n";
		const sections = proposalSections(text);
		expect(sections.map((s) => [s.heading, s.line])).toEqual([
			["Why", 1],
			["Impact", 7],
		]);
		expect(sections[0]?.body).toBe("\n```markdown\n## X\n```\n\n");
	});
});

describe("task/stages/proposal-md: readProposalCapabilities", () => {
	it("reads an inline New path", () => {
		expect(readProposalCapabilities(proposal("- **New:** `spec/stages`."))).toEqual({ new: ["spec/stages"], modified: [] });
	});

	it("ends each list at the next label, inline and nested", () => {
		const text = proposal(
			[
				"Intro mentioning `ignored/before-label`.",
				"- **New:** `spec/stages`, `spec/stages` again.",
				"  - `spec/gates`",
				"- **Modified:** `task/cli`",
				"  - `task/headless`, not a path: `pnpm task`, `A/B`.",
				"",
			].join("\n"),
		);
		expect(readProposalCapabilities(text)).toEqual({ new: ["spec/stages", "spec/gates"], modified: ["task/cli", "task/headless"] });
	});

	it("reads no paths without a section or without labels", () => {
		const none = { new: [], modified: [] };
		expect(readProposalCapabilities(proposal("", ["Why", "Impact"]))).toEqual(none);
		expect(readProposalCapabilities(proposal("Touches `task/cli`."))).toEqual(none);
		// Paths after the Capabilities section are not its own.
		expect(readProposalCapabilities("## Capabilities\n- **New:** `a/b`\n## Impact\n- `c/d`\n")).toEqual({ new: ["a/b"], modified: [] });
	});

	it("counts one new and two modified paths as three", () => {
		const read = readProposalCapabilities(proposal("- **New:** `spec/stages`.\n- **Modified:**\n  - `task/cli`;\n  - `task/headless`.\n"));
		expect(read.new.length + read.modified.length).toBe(3);
	});
});
