import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	capabilityLines,
	existingCapabilities,
	existingChanges,
	readPurpose,
} from "../../../src/task/stages/capabilities.js";

const roots: string[] = [];

function workspace(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "capabilities-"));
	roots.push(root);
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), text);
	}
	return root;
}

function spec(name: string, purpose: string): string {
	return `# ${name} Specification\n\n## Purpose\n${purpose}\n\n## Requirements\n\n### Requirement: X\nText.\n`;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("task/stages/capabilities: existingCapabilities", () => {
	it("lists every <area>/<name> with a spec.md, in path order", async () => {
		const root = workspace({
			"openspec/specs/task/cli/spec.md": spec("task/cli", "The task CLI."),
			"openspec/specs/core/subset/spec.md": spec("core/subset", "The supported subset."),
		});
		expect(await existingCapabilities(root)).toEqual(["core/subset", "task/cli"]);
	});

	it("ignores stray files, folders without a spec.md and deeper folders", async () => {
		const root = workspace({
			"openspec/specs/README.md": "# Specs\n",
			"openspec/specs/core/notes.md": "notes\n",
			"openspec/specs/core/empty/other.md": "x\n",
			"openspec/specs/core/subset/spec.md": spec("core/subset", "The supported subset."),
			"openspec/specs/core/subset/deeper/spec.md": spec("deeper", "Too deep."),
			"openspec/specs/a/b/c/spec.md": spec("a/b/c", "Too deep."),
		});
		expect(await existingCapabilities(root)).toEqual(["core/subset"]);
	});

	it("is empty when openspec/specs/ is missing", async () => {
		const root = workspace({});
		expect(await existingCapabilities(root)).toEqual([]);
		expect(await capabilityLines(root)).toBe("");
	});
});

describe("task/stages/capabilities: capabilityLines", () => {
	it("gives one <area>/<name>: <purpose> line per capability, in path order", async () => {
		const root = workspace({
			"openspec/specs/task/cli/spec.md": spec("task/cli", "The task CLI."),
			"openspec/specs/core/subset/spec.md": spec("core/subset", "The supported subset."),
		});
		expect(await capabilityLines(root)).toBe("core/subset: The supported subset.\ntask/cli: The task CLI.");
	});

	it("keeps the path of a spec with no Purpose", async () => {
		const root = workspace({ "openspec/specs/core/subset/spec.md": "# core/subset\n\n## Requirements\n" });
		expect(await capabilityLines(root)).toBe("core/subset:");
	});
});

describe("task/stages/capabilities: existingChanges", () => {
	it("lists active and archived change ids, dropping the archive's date prefix and stray files", async () => {
		const root = workspace({
			"openspec/changes/add-spec-loop/proposal.md": "# x\n",
			"openspec/changes/archive/2026-09-01-add-spec-cli-events/proposal.md": "# x\n",
			"openspec/changes/archive/undated-change/proposal.md": "# x\n",
			"openspec/changes/archive/README.md": "# Archive\n",
			"openspec/changes/.gitkeep": "",
		});
		expect(await existingChanges(root)).toEqual(new Set(["add-spec-loop", "add-spec-cli-events", "undated-change"]));
	});

	it("is empty when openspec/changes/ is missing", async () => {
		expect(await existingChanges(workspace({}))).toEqual(new Set());
	});

	it("lists only the active ids when there is no archive/", async () => {
		const root = workspace({ "openspec/changes/add-spec-loop/proposal.md": "# x\n" });
		expect(await existingChanges(root)).toEqual(new Set(["add-spec-loop"]));
	});
});

describe("task/stages/capabilities: readPurpose", () => {
	it("collapses a Purpose over several lines into one", () => {
		expect(readPurpose("## Purpose\n\nThe one   declaration\nof the subset,\r\n  scanned first.\n\nA second paragraph.\n")).toBe(
			"The one declaration of the subset, scanned first.",
		);
	});

	it("stops at the next heading", () => {
		expect(readPurpose("## Purpose\nShort.\n## Requirements\nNot this.\n")).toBe("Short.");
	});

	it("is empty with no Purpose heading, or nothing under it", () => {
		expect(readPurpose("# Title\n\n## Requirements\n")).toBe("");
		expect(readPurpose("## Purpose\n\n## Requirements\n")).toBe("");
	});
});
