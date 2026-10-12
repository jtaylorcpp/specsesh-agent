import { describe, expect, it } from "vitest";
import type { ActionResult } from "../../src/interpreter/index.js";
import {
	DEFAULT_SEARCH_LIMIT,
	WorkspaceError,
	globToRegExp,
	matchGlob,
	searchActions,
	type ExecutedHostAction,
	type SearchMatch,
	type Workspace,
} from "../../src/durable/index.js";

/** An in-memory workspace over `files`, listing and searching with `matchGlob` unless told not to. */
function memory(files: Record<string, string>, options: { list?: boolean; search?: boolean } = {}): Workspace {
	const paths = () => Object.keys(files).sort();
	return {
		root: "memory",
		async read(path) {
			const content = files[path];
			if (content === undefined) throw new WorkspaceError("no such file", path);
			return content;
		},
		async write(path, content) {
			files[path] = content;
		},
		...(options.list === false ? {} : { list: async (glob: string) => paths().filter((path) => matchGlob(glob, path)) }),
		...(options.search === false
			? {}
			: {
					async search(pattern: string, opts: { glob?: string; limit?: number } = {}): Promise<SearchMatch[]> {
						const re = new RegExp(pattern);
						const limit = opts.limit ?? DEFAULT_SEARCH_LIMIT;
						const out: SearchMatch[] = [];
						for (const path of paths().filter((p) => matchGlob(opts.glob ?? "**/*", p))) {
							for (const [i, text] of files[path]!.split("\n").entries()) {
								if (out.length >= limit) return out;
								if (re.test(text)) out.push({ path, line: i + 1, text });
							}
						}
						return out;
					},
				}),
	};
}

const FILES = {
	"README.md": "# readme\nconst a in prose\n",
	"src/a.ts": "// a\n\nexport const a = 1;\n",
	"src/x/b.ts": "export const b = 2;\n",
	"src/a.js": "export const a = 1;\n",
};

function byName(actions: ExecutedHostAction[]): Record<string, ExecutedHostAction> {
	return Object.fromEntries(actions.map((action) => [action.name, action]));
}

function run(action: ExecutedHostAction | undefined, inputs: Record<string, string>): Promise<ActionResult> {
	if (action === undefined) throw new Error("no such action");
	return action.execute(inputs, { workspace: "memory" });
}

describe("globToRegExp / matchGlob", () => {
	it("src/**/*.ts matches at any depth under src, .ts only", () => {
		expect(matchGlob("src/**/*.ts", "src/a.ts")).toBe(true);
		expect(matchGlob("src/**/*.ts", "src/x/y/b.ts")).toBe(true);
		expect(matchGlob("src/**/*.ts", "src/a.js")).toBe(false);
		expect(matchGlob("src/**/*.ts", "lib/a.ts")).toBe(false);
	});

	it("* stays within a segment", () => {
		expect(matchGlob("*.ts", "a.ts")).toBe(true);
		expect(matchGlob("*.ts", "src/a.ts")).toBe(false);
	});

	it("? matches exactly one character, never /", () => {
		expect(matchGlob("a?.ts", "ab.ts")).toBe(true);
		expect(matchGlob("a?.ts", "a.ts")).toBe(false);
		expect(matchGlob("a?.ts", "abc.ts")).toBe(false);
		expect(matchGlob("a?b", "a/b")).toBe(false);
	});

	it("{a,b} is either alternative, nesting allowed", () => {
		expect(matchGlob("{a,b}.ts", "a.ts")).toBe(true);
		expect(matchGlob("{a,b}.ts", "b.ts")).toBe(true);
		expect(matchGlob("{a,b}.ts", "c.ts")).toBe(false);
		expect(matchGlob("src/*.{ts,{js,mjs}}", "src/a.mjs")).toBe(true);
		expect(matchGlob("src/*.{ts,{js,mjs}}", "src/a.cjs")).toBe(false);
	});

	it("**/* matches a root file, and a trailing ** anything below", () => {
		expect(matchGlob("**/*", "a.ts")).toBe(true);
		expect(matchGlob("**/*", "x/y/a.ts")).toBe(true);
		expect(matchGlob("src/**", "src/x/y")).toBe(true);
		expect(matchGlob("src/**", "lib/x")).toBe(false);
	});

	it("regex metacharacters are literal", () => {
		expect(matchGlob("a.(b)+.ts", "a.(b)+.ts")).toBe(true);
		expect(matchGlob("a.ts", "abts")).toBe(false);
		expect(globToRegExp("{a").test("{a")).toBe(true);
	});
});

describe("actions/workspace: list_files and search_files are built-ins over list and search", () => {
	it("Scenario: search_files formats matches", async () => {
		const actions = byName(searchActions(memory({ ...FILES })));
		expect(await run(actions["search_files"], { pattern: "const a", glob: "src/**/*.ts" })).toEqual({
			ok: true,
			outputs: { matches: "src/a.ts:3: export const a = 1;" },
		});
	});

	it("Scenario: Search needs a searchable workspace", async () => {
		const result = await run(byName(searchActions(memory({ ...FILES }, { search: false })))["search_files"], { pattern: "a", glob: "" });
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.message).toContain("cannot search files");
	});

	it("list_files needs a listable workspace", async () => {
		const result = await run(byName(searchActions(memory({ ...FILES }, { list: false })))["list_files"], { glob: "**/*" });
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.message).toContain("this workspace cannot list files");
	});

	it("list_files answers the sorted paths, newline-joined; an empty glob is **/*", async () => {
		const actions = byName(searchActions(memory({ ...FILES })));
		expect(await run(actions["list_files"], { glob: "src/**/*.ts" })).toEqual({ ok: true, outputs: { paths: "src/a.ts\nsrc/x/b.ts" } });
		expect(await run(actions["list_files"], { glob: "" })).toEqual({
			ok: true,
			outputs: { paths: "README.md\nsrc/a.js\nsrc/a.ts\nsrc/x/b.ts" },
		});
	});

	it("an invalid regular expression is answered, not thrown", async () => {
		const result = await run(byName(searchActions(memory({ ...FILES })))["search_files"], { pattern: "(", glob: "" });
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.message).toContain("not a regular expression");
	});

	it("both are reads, safe to replay, recording no Action", async () => {
		const actions = searchActions(memory({ ...FILES }));
		expect(actions.map((a) => [a.name, a.kind, a.replay])).toEqual([
			["list_files", "read", "safe"],
			["search_files", "read", "safe"],
		]);
		const named = byName(actions);
		for (const result of [
			await run(named["list_files"], { glob: "**/*" }),
			await run(named["search_files"], { pattern: "const", glob: "**/*" }),
		]) {
			expect(result.ok).toBe(true);
			expect("record" in result).toBe(false);
		}
	});
});
