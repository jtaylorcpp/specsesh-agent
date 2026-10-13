import { describe, expect, it } from "vitest";
import { designGate, designReferences, referenceIssues, sectionCount } from "../../../src/task/stages/design-gate.js";

const DESIGN_MD = "## Context\n\nWhy.\n\n## Decisions\n\n- One.\n";
const MOCK = "<!doctype html>\n<html><head><style>body{}</style></head><body>mock</body></html>\n";

/** The passing design from the design doc: `add-plan-export`. */
const PLAN_EXPORT: Record<string, string> = {
	"design.md": [
		"## Context\n\nExport the plan.\n",
		"## The command\n\nSee [the mock](design/mock.html) and `design/examples/export.sh`.\n",
		"## Decisions\n\n- Read it with [read-plan](./design/examples/read-plan.ts).\n",
		"## Risks\n\n- None.\n",
	].join("\n"),
	"design/mock.html": `<!doctype html>\n<html><body><pre>$ specplan export --json</pre><script src="app.js"></script></body></html>\n`,
	"design/examples/export.sh": "specplan export --json > plan.json\n",
	"design/examples/read-plan.ts": 'const plan: PlanExport = JSON.parse(readFileSync("plan.json", "utf8"));\n',
};

const errorsFor = (files: Record<string, string>) => designGate({ files }).filter((issue) => issue.level === "ERROR");

describe("designGate", () => {
	it("passes the add-plan-export design", () => {
		expect(designGate({ files: PLAN_EXPORT })).toEqual([]);
	});

	it("Scenario: A design without a mock", () => {
		const errors = errorsFor({ "design.md": DESIGN_MD, "design/examples/a.ts": "a();\n" });
		expect(errors).toHaveLength(1);
		expect(errors[0]?.message).toMatch(/mock is needed/);
	});

	it("Scenario: A design without an example", () => {
		const errors = errorsFor({ "design.md": DESIGN_MD, "design/mock.html": MOCK });
		expect(errors).toHaveLength(1);
		expect(errors[0]?.message).toMatch(/example is needed/);
	});

	it("Scenario: A mock that loads a script from the network", () => {
		const mock = MOCK.replace("mock</body>", 'mock<script src="https://cdn.example.com/x.js"></script></body>');
		const errors = errorsFor({ ...PLAN_EXPORT, "design/mock.html": mock });
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ path: "design/mock.html" });
		expect(errors[0]?.message).toContain("design/mock.html");
		expect(errors[0]?.message).toContain("https://cdn.example.com/x.js");
	});

	it("flags protocol-relative and http: loads, one ERROR each, and not relative ones", () => {
		const mock = MOCK.replace("mock</body>", `<link href='//cdn.example.com/a.css'><img src=http://x/y.png><script src="app.js"></script></body>`);
		const errors = errorsFor({ ...PLAN_EXPORT, "design/mock.html": mock });
		expect(errors.map((issue) => issue.message)).toEqual([
			expect.stringContaining("//cdn.example.com/a.css"),
			expect.stringContaining("http://x/y.png"),
		]);
	});

	it("Scenario: A fragment is not a mock", () => {
		const errors = errorsFor({ ...PLAN_EXPORT, "design/mock.html": "<div>hi</div>" });
		expect(errors.length).toBeGreaterThan(0);
		for (const issue of errors) {
			expect(issue.path).toBe("design/mock.html");
			expect(issue.message).toContain("design/mock.html");
		}
	});

	it("accepts a doctype in any case after whitespace, and checks every .html under design/", () => {
		expect(errorsFor({ ...PLAN_EXPORT, "design/mock.html": `\n  <!DOCTYPE HTML>\n<HTML><body></body></HTML>` })).toEqual([]);
		const errors = errorsFor({ ...PLAN_EXPORT, "design/states/empty.HTML": "<p>empty</p></html>" });
		expect(errors).toHaveLength(1);
		expect(errors[0]?.path).toBe("design/states/empty.HTML");
	});
});

describe("sectionCount", () => {
	it("needs two ## sections, not counting ### or fenced ones", () => {
		expect(sectionCount(DESIGN_MD, 2)).toEqual([]);
		expect(sectionCount("## Context\n\n### Sub\n\n```md\n## Not a section\n```\n", 2)).toEqual([
			{ level: "ERROR", path: "design.md", message: expect.stringContaining("at least 2 ## sections") },
		]);
		expect(sectionCount(undefined, 2)).toHaveLength(1);
	});
});

describe("referenceIssues", () => {
	it("names each missing design/ path, linked or backticked, once", () => {
		const markdown = "See [x](design/examples/missing.ts), `design/examples/missing.ts` and `design/gone.html`.";
		expect(referenceIssues(markdown, { "design.md": markdown })).toEqual([
			{ level: "ERROR", path: "design.md", message: expect.stringContaining("design/examples/missing.ts") },
			{ level: "ERROR", path: "design.md", message: expect.stringContaining("design/gone.html") },
		]);
	});

	it("reads the paths design.md names, trailing punctuation trimmed", () => {
		expect(designReferences("[a](./design/a.ts#L1), `design/b.sh`, [c](design/c.md). `design.md` is not one.")).toEqual([
			"design/b.sh",
			"design/a.ts",
			"design/c.md",
		]);
	});

	it("counts a named directory as existing when a file is under it", () => {
		expect(referenceIssues("Everything under `design/examples/`.", { "design/examples/a.ts": "" })).toEqual([]);
		expect(referenceIssues("Everything under `design/examples/`.", {})).toHaveLength(1);
	});
});
