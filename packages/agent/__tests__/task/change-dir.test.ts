/**
 * One change, one folder: `agentscript-change draft` under a config whose `changesDir`
 * is not `openspec/changes` writes the intent, the drafts and the review lines under
 * it, and finds the waiting review there again.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../src/bin/agentscript-change.js";
import type { SpecStage } from "../../src/task/spec-stage.js";
import { setup } from "../durable/helpers.js";
import { cleanTemps, temp } from "./helpers.js";
import { STAGE_SCRIPT, draft } from "./spec-helpers.js";

afterEach(cleanTemps);

const CHANGE = "add-plan-export";
const PROPOSAL = "## Why\n\nPlans leave the tool.\n";

const proposal: SpecStage = { name: "proposal", owns: ["proposal.md"], script: { text: STAGE_SCRIPT }, gate: () => [] };
const design: SpecStage = { name: "design", owns: ["design.md"], after: ["proposal"], script: { text: STAGE_SCRIPT }, gate: () => [] };

describe("task/change-dir: a change lives under the config's changesDir", () => {
	it("drafts, reviews and finds the waiting review under specs/changes, never openspec/", async () => {
		const workspace = temp("change-dir-");
		writeFileSync(join(workspace, "agentscript.config.json"), JSON.stringify({ task: { changesDir: "specs/changes" } }));
		const env = setup();
		const run = async (argv: string[]) => {
			const out: string[] = [];
			const err: string[] = [];
			const code = await main([...argv, "--db", join(workspace, ".agentscript", "change.sqlite")], {
				cwd: workspace,
				env: { AGENTSCRIPT_PROVIDER: env.model.provider, AGENTSCRIPT_MODEL: env.model.modelId },
				models: () => env.models,
				stages: [proposal, design],
				out: (line) => out.push(line),
				err: (line) => err.push(line),
			});
			return { code, out, err };
		};

		env.faux.setResponses([draft(`=== proposal.md\n${PROPOSAL}`)]);
		const first = await run(["draft", CHANGE, "--intent", "Export a plan"]);
		expect(first.code).toBe(0);
		const changeDir = join(workspace, "specs", "changes", CHANGE);
		expect(readFileSync(join(changeDir, "intent.md"), "utf8")).toBe("Export a plan");
		expect(readFileSync(join(changeDir, "proposal.md"), "utf8")).toBe(PROPOSAL);
		expect(existsSync(join(workspace, "openspec"))).toBe(false);
		expect(first.out).toContain(`Review specs/changes/${CHANGE}/proposal.md, then:`);

		const requests = env.requests.length;
		const again = await run(["draft", CHANGE]);
		expect(again.code).toBe(0);
		expect(again.out).toContain(`Review specs/changes/${CHANGE}/proposal.md, then:`);
		expect(again.err.some((line) => line.startsWith("draft loop "))).toBe(false);
		expect(env.requests.length).toBe(requests);
		expect(existsSync(join(workspace, "openspec"))).toBe(false);
	});
});
