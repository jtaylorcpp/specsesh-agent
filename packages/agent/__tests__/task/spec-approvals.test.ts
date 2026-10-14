import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalsFileError } from "../../src/task/errors.js";
import { approvedStages } from "../../src/task/change-state.js";
import {
	hashOwnedFiles,
	listStaleApprovedFiles,
	readApprovals,
	recordApproval,
	recordSpecAmendment,
	staleApprovals,
	staleFilesOfStage,
} from "../../src/task/spec-approvals.js";
import { SPEC_STAGES } from "../../src/task/spec-stages.js";

const proposal = { name: "proposal", owns: ["proposal.md"] };
const design = { name: "design", owns: ["design.md", "design/"], after: ["proposal"] };
const tasks = { name: "tasks", owns: ["tasks.md"], after: ["design"] };
const stages = [proposal, design, tasks];
const by = { principal: "jesse", notes: "", at: "2026-10-12T17:04:11.000Z" };

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function changeDir(files: Record<string, string | Buffer> = {}): string {
	const root = mkdtempSync(join(tmpdir(), "spec-approvals-"));
	dirs.push(root);
	const dir = join(root, "add-plan-export");
	mkdirSync(dir);
	for (const [path, text] of Object.entries(files)) write(dir, path, text);
	return dir;
}

function write(dir: string, path: string, text: string | Buffer): void {
	mkdirSync(dirname(join(dir, path)), { recursive: true });
	writeFileSync(join(dir, path), text);
}

const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

describe("task/spec-approvals: readApprovals", () => {
	it("reads a missing approvals.json as no approvals", () => {
		expect(readApprovals(changeDir())).toEqual({ approvals: [] });
	});

	it("refuses an entry by an agent, naming approvals.json and the field", () => {
		const dir = changeDir({
			"approvals.json": JSON.stringify({
				approvals: [{ stage: "proposal", approved: true, by: "agent", principal: "bot", notes: "", at: by.at, files: {} }],
			}),
		});
		expect(() => readApprovals(dir)).toThrow(ApprovalsFileError);
		expect(() => readApprovals(dir)).toThrow(/^approvals\.json is not valid: \/approvals\/0\/by: /);
	});

	it("refuses a file that is not JSON, a bad hash, a bad date and an unknown key", () => {
		const entry = { stage: "proposal", approved: true, by: "principal", principal: "jesse", notes: "", at: by.at, files: {} };
		for (const text of [
			"{",
			JSON.stringify({ approvals: [{ ...entry, files: { "proposal.md": "abc" } }] }),
			JSON.stringify({ approvals: [{ ...entry, at: "yesterday" }] }),
			JSON.stringify({ approvals: [{ ...entry, extra: 1 }] }),
			JSON.stringify({ approvals: [{ ...entry, principal: "" }] }),
		]) {
			expect(() => readApprovals(changeDir({ "approvals.json": text }))).toThrow(/^approvals\.json /);
		}
		expect(readApprovals(changeDir({ "approvals.json": JSON.stringify({ approvals: [entry] }) }))).toEqual({ approvals: [entry] });
	});
});

describe("task/spec-approvals: hashOwnedFiles", () => {
	it("hashes an owned file and every file under an owned directory, in path order", () => {
		const image = Buffer.from([0xff, 0xfe, 0x00, 0x80]);
		const dir = changeDir({
			"design.md": "## Context\n",
			"design/examples/b.ts": "b\n",
			"design/a.png": image,
			"tasks.md": "- [ ] 1.1 x\n",
		});
		const hashes = hashOwnedFiles(design, dir);
		expect(Object.keys(hashes)).toEqual(["design.md", "design/a.png", "design/examples/b.ts"]);
		expect(hashes["design.md"]).toBe(sha256("## Context\n"));
		expect(hashes["design/a.png"]).toBe(sha256(image));
	});

	it("leaves out owned files that do not exist", () => {
		expect(hashOwnedFiles(design, changeDir({ "design.md": "x" }))).toEqual({ "design.md": sha256("x") });
		expect(hashOwnedFiles(proposal, changeDir())).toEqual({});
	});
});

describe("task/spec-approvals: recordApproval", () => {
	it("records the principal's approval with the sha256 of each owned file", () => {
		const dir = changeDir({ "proposal.md": "## Why\n" });
		const entry = recordApproval(dir, proposal, by, stages);
		expect(entry).toEqual({
			stage: "proposal",
			approved: true,
			by: "principal",
			principal: "jesse",
			notes: "",
			at: by.at,
			files: { "proposal.md": sha256("## Why\n") },
		});
		expect(readApprovals(dir)).toEqual({ approvals: [entry] });
	});

	it("replaces the stage's entry in place and drops every stage that follows it, transitively", () => {
		const dir = changeDir({ "proposal.md": "v1\n", "design.md": "d\n", "tasks.md": "t\n" });
		recordApproval(dir, proposal, by, stages);
		recordApproval(dir, design, by, stages);
		recordApproval(dir, tasks, by, stages);
		expect(readApprovals(dir).approvals.map((entry) => entry.stage)).toEqual(["proposal", "design", "tasks"]);

		write(dir, "proposal.md", "v2\n");
		recordApproval(dir, proposal, { ...by, at: "2026-10-12T18:00:00.000Z" }, stages);
		const { approvals } = readApprovals(dir);
		expect(approvals).toHaveLength(1);
		expect(approvals[0]).toMatchObject({ stage: "proposal", at: "2026-10-12T18:00:00.000Z", files: { "proposal.md": sha256("v2\n") } });
	});

	it("keeps entries for stages that do not follow it, and its own place in the file", () => {
		const other = { name: "other", owns: ["other.md"] };
		const dir = changeDir({ "proposal.md": "p\n", "other.md": "o\n", "design.md": "d\n" });
		recordApproval(dir, proposal, by, [...stages, other]);
		recordApproval(dir, other, by, [...stages, other]);
		recordApproval(dir, design, by, [...stages, other]);
		recordApproval(dir, proposal, by, [...stages, other]);
		expect(readApprovals(dir).approvals.map((entry) => entry.stage)).toEqual(["proposal", "other"]);
	});

	it("ends on a cycle in after", () => {
		const a = { name: "a", owns: ["a.md"], after: ["b"] };
		const b = { name: "b", owns: ["b.md"], after: ["a"] };
		const dir = changeDir({ "a.md": "a\n", "b.md": "b\n" });
		recordApproval(dir, b, by, [a, b]);
		recordApproval(dir, a, by, [a, b]);
		expect(readApprovals(dir).approvals.map((entry) => entry.stage)).toEqual(["a"]);
	});

	it("writes the same bytes when run twice with the same inputs", () => {
		const dir = changeDir({ "proposal.md": "## Why\n" });
		recordApproval(dir, proposal, by, stages);
		const first = readFileSync(join(dir, "approvals.json"));
		recordApproval(dir, proposal, by, stages);
		expect(readFileSync(join(dir, "approvals.json")).equals(first)).toBe(true);
		expect(first.toString("utf8").endsWith("}\n")).toBe(true);
	});

	it("refuses to write over a malformed approvals.json", () => {
		const dir = changeDir({ "proposal.md": "p\n", "approvals.json": "not json" });
		expect(() => recordApproval(dir, proposal, by, stages)).toThrow(ApprovalsFileError);
		expect(readFileSync(join(dir, "approvals.json"), "utf8")).toBe("not json");
	});
});

describe("task/spec-approvals: staleApprovals", () => {
	it("names a stage in after that has no approval", () => {
		expect(staleApprovals(design, changeDir())).toEqual([
			{ stage: "proposal", message: "the proposal stage of add-plan-export is not approved; run it and approve it first" },
		]);
	});

	it("names a file edited since its stage was approved", () => {
		const dir = changeDir({ "proposal.md": "## Why\n" });
		recordApproval(dir, proposal, by, stages);
		write(dir, "proposal.md", "## Why\nEdited.\n");
		expect(staleApprovals(design, dir)).toEqual([
			{ stage: "proposal", file: "proposal.md", message: "proposal.md changed since the proposal stage was approved; review it again" },
		]);
	});

	it("names a file deleted since its stage was approved", () => {
		const dir = changeDir({ "design.md": "d\n", "design/a.ts": "a\n" });
		recordApproval(dir, design, by, stages);
		rmSync(join(dir, "design/a.ts"));
		expect(staleApprovals(tasks, dir)).toEqual([
			{ stage: "design", file: "design/a.ts", message: "design/a.ts changed since the design stage was approved; review it again" },
		]);
	});

	it("is empty when every stage in after is approved and unchanged, or there are none", () => {
		const dir = changeDir({ "proposal.md": "## Why\n" });
		recordApproval(dir, proposal, by, stages);
		expect(staleApprovals(design, dir)).toEqual([]);
		expect(staleApprovals(proposal, changeDir())).toEqual([]);
	});

	it("throws on a malformed approvals.json", () => {
		expect(() => staleApprovals(design, changeDir({ "approvals.json": "{}" }))).toThrow(/^approvals\.json is not valid: /);
	});
});

describe("task/spec-approvals: listStaleApprovedFiles", () => {
	/** A change with every spec stage approved, through the stages a draft runs. */
	function approvedChange(): string {
		const dir = changeDir({
			"proposal.md": "## Why\n",
			"design.md": "## Context\n",
			"specs/plan/export/spec.md": "## ADDED Requirements\n",
			"specs/plan/schema/spec.md": "## MODIFIED Requirements\n",
			"tasks.md": "- [ ] 1.1 x\n",
		});
		for (const stage of SPEC_STAGES) recordApproval(dir, stage, by, SPEC_STAGES);
		return dir;
	}

	/** The stage the draft would redraft first: the first without a current approval. */
	const redraftStage = (dir: string) => approvedStages(SPEC_STAGES, dir).next;

	it("is empty when every stage is approved and nothing was edited", () => {
		const dir = approvedChange();
		const before = readFileSync(join(dir, "approvals.json"));
		expect(listStaleApprovedFiles(dir)).toEqual([]);
		expect(redraftStage(dir)).toBeUndefined();
		expect(readFileSync(join(dir, "approvals.json")).equals(before)).toBe(true);
	});

	it("names one edited delta, relative to the change", () => {
		const dir = approvedChange();
		write(dir, "specs/plan/export/spec.md", "## ADDED Requirements\nEdited.\n");
		const stale = listStaleApprovedFiles(dir);
		expect(stale).toEqual([{ stage: "specs", path: "specs/plan/export/spec.md", state: "changed" }]);
		expect(redraftStage(dir)).toBe(stale[0]?.stage);
	});

	it("lists several stages in stage order, each in path order, a deleted file as missing", () => {
		const dir = approvedChange();
		write(dir, "specs/plan/export/spec.md", "edited\n");
		rmSync(join(dir, "specs/plan/schema/spec.md"));
		write(dir, "design.md", "edited\n");
		const stale = listStaleApprovedFiles(dir);
		expect(stale).toEqual([
			{ stage: "design", path: "design.md", state: "changed" },
			{ stage: "specs", path: "specs/plan/export/spec.md", state: "changed" },
			{ stage: "specs", path: "specs/plan/schema/spec.md", state: "missing" },
		]);
		expect(redraftStage(dir)).toBe(stale[0]?.stage);
	});

	it("names a changed tasks.md", () => {
		const dir = approvedChange();
		write(dir, "tasks.md", "- [ ] 1.1 y\n");
		const stale = listStaleApprovedFiles(dir);
		expect(stale).toEqual([{ stage: "tasks", path: "tasks.md", state: "changed" }]);
		expect(redraftStage(dir)).toBe(stale[0]?.stage);
	});

	it("reads ticked tasks as unticked, so ticking alone is not a change", () => {
		const dir = changeDir({ "tasks.md": "## 1. G\n\n- [ ] 1.1 a\n- [ ] 1.2 b\n  - [ ] note\n- [ ] 1.3 c\n" });
		recordApproval(dir, tasks, by, stages);
		write(dir, "tasks.md", "## 1. G\n\n- [x] 1.1 a\n- [x] 1.2 b\n  - [x] note\n- [ ] 1.3 c\n");
		expect(listStaleApprovedFiles(dir, readApprovals(dir), [tasks])).toEqual([]);
		expect(staleFilesOfStage(dir, readApprovals(dir).approvals, "tasks")).toEqual([]);
	});

	it("names tasks.md when ticking comes with an unrelated edit", () => {
		const dir = changeDir({ "tasks.md": "## 1. G\n\n- [ ] 1.1 a\n- [ ] 1.2 b\n" });
		recordApproval(dir, tasks, by, stages);
		write(dir, "tasks.md", "## 1. G\n\n- [x] 1.1 a\n- [x] 1.2 b, edited\n");
		expect(listStaleApprovedFiles(dir, readApprovals(dir), [tasks])).toEqual([{ stage: "tasks", path: "tasks.md", state: "changed" }]);
	});

	it("skips a stage with no approval, even when its files exist and others changed", () => {
		const dir = changeDir({ "proposal.md": "## Why\n", "design.md": "## Context\n", "tasks.md": "t\n" });
		recordApproval(dir, SPEC_STAGES[0]!, by, SPEC_STAGES);
		write(dir, "proposal.md", "edited\n");
		write(dir, "design.md", "edited\n");
		expect(listStaleApprovedFiles(dir)).toEqual([{ stage: "proposal", path: "proposal.md", state: "changed" }]);
		expect(staleFilesOfStage(dir, readApprovals(dir).approvals, "design")).toEqual([]);
	});

	it("uses the approvals it is given instead of reading approvals.json", () => {
		const dir = approvedChange();
		const approvals = readApprovals(dir);
		write(dir, "tasks.md", "edited\n");
		rmSync(join(dir, "approvals.json"));
		expect(listStaleApprovedFiles(dir, approvals)).toEqual([{ stage: "tasks", path: "tasks.md", state: "changed" }]);
		expect(listStaleApprovedFiles(dir)).toEqual([]);
	});
});

describe("task/spec-approvals: recordSpecAmendment", () => {
	const amended = "## ADDED Requirements\nAmended.\n";
	const amendment = { sha256: sha256(amended), principal: "sam", notes: "amendment-applied" };

	/** Four stages approved, two spec deltas, each approval with its own note. */
	function approvedChange(): string {
		const dir = changeDir({
			"proposal.md": "## Why\n",
			"design.md": "## Context\n",
			"specs/plan/export/spec.md": "## ADDED Requirements\n",
			"specs/plan/schema/spec.md": "## MODIFIED Requirements\n",
			"tasks.md": "- [ ] 1.1 x\n",
		});
		for (const stage of SPEC_STAGES) recordApproval(dir, stage, { ...by, notes: `${stage.name} ok` }, SPEC_STAGES);
		return dir;
	}

	const approvalsText = (dir: string) => readFileSync(join(dir, "approvals.json"), "utf8");
	const tmpFiles = (dir: string) => readdirSync(dir).filter((name) => name.endsWith(".tmp"));

	it("changes only the delta's sha256 and the specs approval's principal and notes", () => {
		const dir = approvedChange();
		const before = approvalsText(dir);
		const entry = recordSpecAmendment(dir, "specs/plan/export/spec.md", amendment);
		expect(entry).toMatchObject({ stage: "specs", principal: "sam", notes: "amendment-applied", at: by.at });

		const expected = before
			.replace(sha256("## ADDED Requirements\n"), amendment.sha256)
			.replace('"principal": "jesse",\n      "notes": "specs ok"', '"principal": "sam",\n      "notes": "amendment-applied"');
		expect(expected).not.toBe(before);
		expect(approvalsText(dir)).toBe(expected);
		expect(tmpFiles(dir)).toEqual([]);
	});

	it("makes the amended delta fresh to the staleness rule", () => {
		const dir = approvedChange();
		write(dir, "specs/plan/export/spec.md", amended);
		expect(listStaleApprovedFiles(dir)).toEqual([{ stage: "specs", path: "specs/plan/export/spec.md", state: "changed" }]);
		recordSpecAmendment(dir, "specs/plan/export/spec.md", amendment);
		expect(listStaleApprovedFiles(dir)).toEqual([]);
		expect(approvedStages(SPEC_STAGES, dir).next).toBeUndefined();
	});

	it("refuses a delta outside specs/**/spec.md, an unknown delta, and no specs approval, writing nothing", () => {
		const dir = approvedChange();
		const before = approvalsText(dir);
		for (const delta of ["design.md", "specs/spec.md", "specs/plan/export/notes.md", "specs/../specs/plan/export/spec.md", "/specs/plan/export/spec.md"]) {
			expect(() => recordSpecAmendment(dir, delta, amendment)).toThrow(/is not specs\/\*\*\/spec\.md$/);
		}
		expect(() => recordSpecAmendment(dir, "specs/plan/import/spec.md", amendment)).toThrow(/has no entry for specs\/plan\/import\/spec\.md$/);
		expect(approvalsText(dir)).toBe(before);

		const proposalOnly = changeDir({ "proposal.md": "## Why\n" });
		recordApproval(proposalOnly, SPEC_STAGES[0]!, by, SPEC_STAGES);
		const proposalText = approvalsText(proposalOnly);
		expect(() => recordSpecAmendment(proposalOnly, "specs/plan/export/spec.md", amendment)).toThrow(/specs stage has no approval/);
		expect(approvalsText(proposalOnly)).toBe(proposalText);

		const none = changeDir();
		expect(() => recordSpecAmendment(none, "specs/plan/export/spec.md", amendment)).toThrow(/specs stage has no approval/);
		expect(readdirSync(none)).toEqual([]);
	});

	it("refuses an approvals.json not as approve writes it, or not valid, writing nothing", () => {
		const dir = approvedChange();
		const compact = JSON.stringify(readApprovals(dir));
		write(dir, "approvals.json", compact);
		expect(() => recordSpecAmendment(dir, "specs/plan/export/spec.md", amendment)).toThrow(/not as approve writes it/);
		expect(approvalsText(dir)).toBe(compact);

		write(dir, "approvals.json", "{");
		expect(() => recordSpecAmendment(dir, "specs/plan/export/spec.md", amendment)).toThrow(/^approvals\.json is not valid JSON/);
		expect(approvalsText(dir)).toBe("{");
	});

	it("refuses an amendment that would not be valid, writing nothing", () => {
		const dir = approvedChange();
		const before = approvalsText(dir);
		expect(() => recordSpecAmendment(dir, "specs/plan/export/spec.md", { ...amendment, sha256: "abc" })).toThrow(/^approvals\.json would not be valid: /);
		expect(() => recordSpecAmendment(dir, "specs/plan/export/spec.md", { ...amendment, principal: "" })).toThrow(/^approvals\.json would not be valid: /);
		expect(approvalsText(dir)).toBe(before);
	});

	it.skipIf(process.getuid?.() === 0)("throws when approvals.json cannot be written, leaving it intact", () => {
		const dir = approvedChange();
		const before = approvalsText(dir);
		chmodSync(dir, 0o555);
		try {
			expect(() => recordSpecAmendment(dir, "specs/plan/export/spec.md", amendment)).toThrow(/EACCES/);
		} finally {
			chmodSync(dir, 0o755);
		}
		expect(approvalsText(dir)).toBe(before);
		expect(tmpFiles(dir)).toEqual([]);
	});
});
