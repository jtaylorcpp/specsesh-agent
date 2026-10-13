import { describe, expect, it } from "vitest";
import { readBundle } from "../../src/task/spec-bundle.js";

const design = { name: "design", owns: ["design.md", "design/"] };
const proposal = { name: "proposal", owns: ["proposal.md"] };

describe("task/spec-bundle: readBundle", () => {
	it("returns each owned section with exactly its text", () => {
		const read = readBundle("=== design.md\n## Context\n\nWhy.\n=== design/mock.html\n<!doctype html>\n<p>hi</p>\n", design);
		expect(read.issues).toEqual([]);
		expect(read.files).toEqual({
			"design.md": "## Context\n\nWhy.\n",
			"design/mock.html": "<!doctype html>\n<p>hi</p>\n",
		});
	});

	it("keeps a last section without a trailing newline as it is", () => {
		expect(readBundle("=== design.md\nlast line", design).files).toEqual({ "design.md": "last line" });
	});

	it("leaves out an unowned section and names it in an ERROR", () => {
		const read = readBundle("=== proposal.md\n## Why\n=== tasks.md\n- [ ] 1.1 x\n", proposal);
		expect(read.files).toEqual({ "proposal.md": "## Why\n" });
		expect(read.issues).toHaveLength(1);
		expect(read.issues[0]).toMatchObject({ level: "ERROR", path: "tasks.md" });
		expect(read.issues[0]?.message).toContain("`tasks.md` is not owned by the proposal stage");
	});

	it("reports a bundle with no header as the stage writing no files", () => {
		expect(readBundle("I could not draft anything.\n", design)).toEqual({
			files: {},
			issues: [{ level: "ERROR", path: "files", message: "the design stage wrote no files" }],
		});
	});

	it("refuses absolute, .. and empty paths", () => {
		const read = readBundle("=== /etc/x\na\n=== design/../tasks.md\nb\n=== C:\\design.md\nc\n=== \nd\n=== design.md\ne\n", design);
		expect(read.files).toEqual({ "design.md": "e\n" });
		expect(read.issues).toEqual([
			{ level: "ERROR", path: "/etc/x", message: "absolute path is not allowed" },
			{ level: "ERROR", path: "design/../tasks.md", message: "path leaves the change directory" },
			{ level: "ERROR", path: "C:\\design.md", message: "absolute path is not allowed" },
			{ level: "ERROR", path: "files", message: "section has no path" },
		]);
	});

	it("ignores text before the first header", () => {
		expect(readBundle("Here is the draft:\n\n=== design.md\nbody\n", design).files).toEqual({ "design.md": "body\n" });
	});

	it("reads CRLF line endings as LF and trims the path", () => {
		expect(readBundle("=== design.md  \r\none\r\ntwo\r\n", design).files).toEqual({ "design.md": "one\ntwo\n" });
	});

	it("keeps the last section of a repeated path", () => {
		expect(readBundle("=== design.md\nfirst\n=== design.md\nsecond\n", design)).toEqual({ files: { "design.md": "second\n" }, issues: [] });
	});

	it("reads the same text to the same result every time", () => {
		const text = "=== design.md\nx\n=== tasks.md\ny\n";
		expect(readBundle(text, design)).toEqual(readBundle(text, design));
	});
});
