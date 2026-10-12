import { describe, expect, it } from "vitest";
import { artifactsSandboxWorkspace } from "../../src/cloudflare/artifacts.js";
import { sandboxWorkspace } from "../../src/cloudflare/sandbox-workspace.js";

// Checked by tsc (`pnpm check`): the entry's exports, without loading cloudflare:workers.
type Entry = typeof import("../../src/cloudflare/index.js");
type SandboxLike = import("../../src/cloudflare/index.js").SandboxLike;
type ArtifactsLike = import("../../src/cloudflare/index.js").ArtifactsLike;
const entrySandboxWorkspace: Entry["sandboxWorkspace"] = sandboxWorkspace;
const entryArtifactsSandboxWorkspace: Entry["artifactsSandboxWorkspace"] = artifactsSandboxWorkspace;

const fakeSandbox: SandboxLike = {
	exec: async () => ({ success: true, stdout: "", stderr: "", exitCode: 0 }),
	readFile: async () => ({ content: "" }),
	writeFile: async () => undefined,
	mkdir: async () => undefined,
};
const stubArtifacts = { get: async () => null } satisfies ArtifactsLike;
void stubArtifacts;

describe("cloudflare/sandbox-workspace: The cloudflare entry exports the sandbox workspace", () => {
	it("sandboxWorkspace and artifactsSandboxWorkspace are functions", () => {
		expect(typeof entrySandboxWorkspace).toBe("function");
		expect(typeof entryArtifactsSandboxWorkspace).toBe("function");
	});

	it("a local fake typed as the entry's SandboxLike builds a workspace", () => {
		expect(entrySandboxWorkspace(fakeSandbox, { dir: "/work" })).toBeDefined();
	});
});
