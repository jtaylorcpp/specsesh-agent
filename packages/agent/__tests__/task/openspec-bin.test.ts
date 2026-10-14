import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	OPENSPEC_MIN_VERSION,
	checkOpenspec,
	describeOpenspec,
	resetOpenspecCache,
	resolveOpenspec,
	runOpenspec,
} from "../../src/task/openspec-bin.js";

let root: string;
let savedPath: string | undefined;

/** A fake `openspec` in `dir` printing `version`; each `--version` appends its OPENSPEC_TELEMETRY as a line to `counter` when given. */
function fakeOpenspec(dir: string, version: string, counter?: string): string {
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "openspec");
	const count =
		counter === undefined
			? ""
			: `require("node:fs").appendFileSync(${JSON.stringify(counter)}, process.env.OPENSPEC_TELEMETRY + "\\n");`;
	writeFileSync(
		path,
		`#!/usr/bin/env node\nif (process.argv[2] === "--version") { ${count} console.log(${JSON.stringify(version)}); }\nelse { console.log(JSON.stringify({ args: process.argv.slice(2), telemetry: process.env.OPENSPEC_TELEMETRY })); process.exit(3); }\n`,
	);
	chmodSync(path, 0o755);
	return path;
}

beforeEach(() => {
	resetOpenspecCache();
	root = mkdtempSync(join(tmpdir(), "openspec-bin-"));
	savedPath = process.env.PATH;
});

afterEach(() => {
	process.env.PATH = savedPath;
	resetOpenspecCache();
	rmSync(root, { recursive: true, force: true });
});

/** PATH holds `dirs` plus node's own directory (after them), so the fakes' shebang still finds `node`. */
function setPath(...dirs: string[]): void {
	process.env.PATH = [...dirs, join(process.execPath, "..")].join(":");
}

// The temp `global` dir stands in for /usr/local/bin. The fakes are node scripts; the win32 `.cmd` shim is untested.
describe.skipIf(process.platform === "win32")("resolveOpenspec", () => {
	it("Scenario: The project copy wins over PATH", async () => {
		const workspace = join(root, "ws");
		const project = fakeOpenspec(join(workspace, "node_modules", ".bin"), "1.14.1");
		const counter = join(root, "global-calls");
		fakeOpenspec(join(root, "global"), "1.9.0", counter);
		setPath(join(root, "global"));
		const bin = await resolveOpenspec(workspace);
		expect(bin).toEqual({ path: join(workspace, "node_modules/.bin/openspec"), version: "1.14.1", source: "project" });
		expect(bin?.path).toBe(project);
		expect(isAbsolute(bin!.path)).toBe(true);
		expect(existsSync(counter)).toBe(false);
	});

	it("Scenario: PATH is used when the project has no copy, and resolved once", async () => {
		const workspace = join(root, "ws");
		mkdirSync(workspace);
		const counter = join(root, "global-calls");
		const global = fakeOpenspec(join(root, "global"), "1.9.0", counter);
		setPath(join(root, "global"));
		const expected = { path: global, version: "1.9.0", source: "path" };
		expect(await resolveOpenspec(workspace)).toEqual(expected);
		expect(await resolveOpenspec(workspace)).toEqual(expected);
		expect(readFileSync(counter, "utf8")).toBe("0\n");
		resetOpenspecCache();
		expect(await resolveOpenspec(workspace)).toEqual(expected);
		expect(readFileSync(counter, "utf8")).toBe("0\n0\n");
	});

	it("Scenario: The version is the first x.y.z", async () => {
		const workspace = join(root, "ws");
		fakeOpenspec(join(workspace, "node_modules", ".bin"), "openspec/1.14.1-rc.1 linux");
		setPath(join(root, "global"));
		expect((await resolveOpenspec(workspace))?.version).toBe("1.14.1");
	});

	it("a version without x.y.z is null", async () => {
		const path = fakeOpenspec(join(root, "global"), "openspec dev build");
		setPath(join(root, "global"));
		expect(await resolveOpenspec(root)).toEqual({ path, version: null, source: "path" });
	});

	it("an empty PATH entry is skipped", async () => {
		const workspace = join(root, "ws");
		mkdirSync(workspace);
		const global = fakeOpenspec(join(root, "global"), "1.9.0");
		setPath("", join(root, "global"));
		expect(await resolveOpenspec(workspace)).toEqual({ path: global, version: "1.9.0", source: "path" });
	});

	it("concurrent calls share one --version", async () => {
		const counter = join(root, "count");
		fakeOpenspec(join(root, "global"), "1.14.1", counter);
		setPath(join(root, "global"));
		const [first, second] = await Promise.all([resolveOpenspec(root), resolveOpenspec(root)]);
		expect(await resolveOpenspec(root)).toBe(first);
		expect(second).toBe(first);
		expect(readFileSync(counter, "utf8")).toBe("0\n");
	});

	it("nothing found is null", async () => {
		process.env.PATH = join(root, "empty");
		expect(await resolveOpenspec(root)).toBeNull();
	});
});

describe("checkOpenspec", () => {
	it("1.14.0 is below the minimum", async () => {
		const workspace = join(root, "ws");
		mkdirSync(workspace);
		// The temp bin dir stands in for /usr/local/bin, which a test cannot write.
		const binDir = join(root, "global");
		fakeOpenspec(binDir, "1.14.0");
		setPath(binDir);
		expect(OPENSPEC_MIN_VERSION).toBe("1.14.1");
		expect(await checkOpenspec(workspace)).toEqual({
			ok: false,
			message: `openspec 1.14.0 at ${binDir}/openspec is below the minimum supported version 1.14.1`,
		});
	});

	it("a suffix is ignored", async () => {
		const workspace = join(root, "ws");
		const project = fakeOpenspec(join(workspace, "node_modules", ".bin"), "1.14.1-rc.1");
		setPath(join(root, "global"));
		const checked = await checkOpenspec(workspace);
		expect(checked).toEqual({ ok: true, bin: { path: project, version: "1.14.1", source: "project" } });
	});

	it("an unknown version is refused", async () => {
		const path = fakeOpenspec(join(root, "global"), "dev");
		setPath(join(root, "global"));
		expect(await checkOpenspec(root)).toEqual({
			ok: false,
			message: `openspec (version unknown) at ${path} is below the minimum supported version ${OPENSPEC_MIN_VERSION}`,
		});
	});

	it("a missing openspec is not refused", async () => {
		// Not `setPath`: node's own directory may hold a global openspec.
		const workspace = join(root, "ws");
		mkdirSync(workspace);
		const empty = join(root, "empty");
		mkdirSync(empty);
		process.env.PATH = empty;
		await expect(checkOpenspec(workspace)).resolves.toEqual({ ok: true, bin: null });
	});
});

describe("describeOpenspec", () => {
	it("formats a known version, an unknown one and a missing openspec", () => {
		expect(describeOpenspec({ path: "/bin/openspec", version: "1.14.1", source: "path" })).toBe("openspec 1.14.1 at /bin/openspec");
		expect(describeOpenspec({ path: "/bin/openspec", version: null, source: "path" })).toBe("openspec (version unknown) at /bin/openspec");
		expect(describeOpenspec(null)).toBe("openspec not found");
	});
});

describe("runOpenspec", () => {
	it("runs the binary with telemetry off and collects its output", async () => {
		const path = fakeOpenspec(join(root, "global"), "1.14.1");
		setPath(join(root, "global"));
		const ran = await runOpenspec({ path, version: "1.14.1", source: "path" }, ["validate", "x"], { cwd: root });
		expect(ran.code).toBe(3);
		expect(JSON.parse(ran.stdout)).toEqual({ args: ["validate", "x"], telemetry: "0" });
	});

	it("a spawn error is code null, never a rejection", async () => {
		const ran = await runOpenspec({ path: join(root, "missing"), version: null, source: "path" }, [], { cwd: root });
		expect(ran.code).toBeNull();
		expect(ran.stderr).toContain("ENOENT");
	});
});
