import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Opt-in (`pnpm test:bun`): needs Bun, from BUN or PATH. Bundles against the build in dist/.
const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUN = process.env["BUN"] ?? "bun";
const bunVersion = (() => {
	const r = spawnSync(BUN, ["--version"], { encoding: "utf8" });
	return r.status === 0 ? r.stdout.trim() : undefined;
})();

/** The consumer's repro (fix-bun-lazy-pi-ai): the claude-code provider beside ./task. */
const REPRO = `import { claudeCodeProvider, claudeCodeModel } from "@specsesh/agent/claude-code";
import { TASK_LOOP } from "@specsesh/agent/task";

const provider = claudeCodeProvider({ binary: "/usr/bin/false" });
try {
	const stream = provider.stream(claudeCodeModel("claude-haiku-5-5"), {
		messages: [{ role: "user", content: "hi", timestamp: 0 }],
	});
	console.log("stream ok", typeof stream, TASK_LOOP);
} catch (error) {
	console.log("stream threw:", String(error));
}
`;

describe("A Bun bundle of ./task streams through the claude-code provider", () => {
	it.skipIf(bunVersion === undefined)(`Scenario: A Bun bundle of ./task streams (bun ${bunVersion ?? "not found: set BUN or put bun on PATH"})`, () => {
		// Inside the package, so @specsesh/agent/* resolves to this build by self-reference.
		const dir = mkdtempSync(join(PKG_DIR, ".bun-bundle-"));
		try {
			writeFileSync(join(dir, "repro.ts"), REPRO);
			execFileSync(BUN, ["build", "repro.ts", "--target=bun", "--external", "@earendil-works/pi-ai/providers", "--outfile", "out.js"], { cwd: dir, stdio: "pipe" });
			const run = spawnSync(BUN, ["out.js"], { cwd: dir, encoding: "utf8" });

			expect(run.stdout, run.stderr).toContain("stream ok");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
