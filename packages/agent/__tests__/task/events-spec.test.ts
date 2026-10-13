/**
 * A spec loop's JSON Lines events through `main()`: a proposal's two drafts to
 * review, its approval, and a question, on a faux model running the bundled
 * `spec-proposal` stage in a temp git repository.
 */

import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cli, fauxModels, gitIn, gitRepo } from "./cli-helpers.js";
import { cleanTemps } from "./helpers.js";
import { draft } from "./spec-helpers.js";

afterEach(() => cleanTemps());

/** All five sections, in order, with `capabilities` as its `**New:**` list. */
const proposal = (capabilities: string[]) =>
	["Why", "What Changes", "Out of scope", "Capabilities", "Impact"]
		.map((heading) => `## ${heading}\n\n${heading === "Capabilities" ? `- **New:** ${capabilities.map((c) => `\`${c}\``).join(", ")}.` : `- ${heading} text.`}\n`)
		.join("\n");

/** Three capabilities: over the budget of two, so the gate warns. */
const OVER_BUDGET = `=== proposal.md\n${proposal(["plan/export", "plan/import", "plan/diff"])}`;
const CLEAN = `=== proposal.md\n${proposal(["plan/export"])}`;

const INTENT = "Export a plan as JSON so CI can read it";
const QUESTION = "Which command should get --quiet?";
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function reviewRepo(): string {
	const repo = gitRepo({ "openspec/specs/task/cli/spec.md": "## Purpose\nCLI purpose.\n\n## Requirements\n" });
	gitIn(repo, "config", "user.name", "jesse");
	return repo;
}

/** `<args> --db <db>` in `repo`, on a faux model answering `responses`. */
async function task(repo: string, args: string[], responses: ReturnType<typeof draft>[] = []) {
	const env = fauxModels();
	env.faux.setResponses(responses);
	const model = env.faux.getModel();
	return cli([...args, "--db", join(repo, ".agentscript", "spec.sqlite")], env, {
		cwd: repo,
		env: { AGENTSCRIPT_PROVIDER: model.provider, AGENTSCRIPT_MODEL: model.id, USER: "fallback" },
	});
}

type Event = { event: string; loop: number } & Record<string, unknown>;

/** The events after the resume hint, each with the same numeric `loop`. */
function events(err: string): Event[] {
	const lines = err.split("\n");
	const hint = lines.findIndex((line) => /^loop \d+ — resume with: /.test(line));
	expect(hint, err).toBeGreaterThanOrEqual(0);
	const parsed = lines
		.slice(hint + 1)
		.filter((line) => line.trim() !== "")
		.map((line) => JSON.parse(line) as Event);
	expect(parsed.length, err).toBeGreaterThan(0);
	for (const event of parsed) expect(typeof event.loop).toBe("number");
	expect(new Set(parsed.map((event) => event.loop)).size).toBe(1);
	return parsed;
}

/** `spec add-plan-export`, drafted over budget then clean: blocked for review. */
async function toReview(repo: string) {
	const r = await task(repo, ["spec", "add-plan-export", "--intent", INTENT], [draft(OVER_BUDGET), draft(CLEAN)]);
	const id = /^# spec loop (\d+) — blocked/.exec(r.out)?.[1];
	expect(id, `${r.out}\n${r.err}`).toBeDefined();
	return { ...r, id: id! };
}

describe("task/headless: A spec loop streams its own event kinds", () => {
	it("Scenario: A proposal's stream", async () => {
		const r = await toReview(reviewRepo());
		const stream = events(r.err);
		expect(stream.map((event) => event.event)).toEqual(["stage-started", "stage-draft", "stage-draft", "stage-review", "stage-ended"]);
		const [started, first, second, review, ended] = stream;

		expect(started).toMatchObject({ change: "add-plan-export", stage: "proposal", script: "spec-proposal" });
		expect(started!.at).toMatch(ISO);

		expect(first).toMatchObject({ draft: 1, written: expect.arrayContaining(["proposal.md"]) });
		const issues = first!.issues as { level: string; path: string; message: string }[];
		expect(issues).toContainEqual({ level: expect.stringMatching(/^(WARNING|ERROR)$/), path: "proposal.md", message: expect.any(String) });

		expect(second).toMatchObject({ draft: 2, issues: [] });

		expect(review).toMatchObject({ files: expect.arrayContaining(["proposal.md"]), question: expect.stringMatching(/\S/) });

		expect(ended).toMatchObject({ status: "blocked", drafts: 2, approved: false });
	});

	it("Scenario: An approval's stream", async () => {
		const repo = reviewRepo();
		const { id } = await toReview(repo);
		const r = await task(repo, ["answer", id, "--by", "principal", "--decision", "approve"]);
		expect(r.code, r.err).toBe(0);
		const stream = events(r.err);
		expect(stream.map((event) => event.event)).toEqual(["stage-started", "stage-ended"]);
		expect(stream[1]).toMatchObject({ status: "converged", drafts: 0, approved: true });
	});

	it("Scenario: A question is its own event", async () => {
		const r = await task(reviewRepo(), ["spec", "add-plan-export", "--intent", INTENT], [draft("", "ask", QUESTION)]);
		const stream = events(r.err);
		const questions = stream.filter((event) => event.event === "stage-question");
		expect(questions).toHaveLength(1);
		expect(questions[0]!.question).toBe(QUESTION);
		expect(stream.some((event) => event.event === "stage-review")).toBe(false);
		expect(stream.at(-1)!.event).toBe("stage-ended");
	});
});
