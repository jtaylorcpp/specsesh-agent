// Hold a release tag to both package versions before anything publishes.
//   node scripts/release-check.mjs <tag> [--packed <specsesh.tgz>]
// Exit 0 prints the dist-tag (latest or next) on stdout; exit 1 prints one stderr line
// per problem, all of them collected first; exit 2 is usage. Manifests are read under
// RELEASE_CHECK_ROOT when set (the tests point it at fixture trees), else the repo root.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = "usage: node scripts/release-check.mjs <tag> [--packed <specsesh.tgz>]";
const MIN_NPM = "11.5.1";
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const usage = () => {
	console.error(USAGE);
	process.exit(2);
};

let tag;
let packed;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
	const arg = args[i];
	if (arg === "--packed") {
		packed = args[++i];
		if (packed === undefined || packed === "") usage();
	} else if (arg.startsWith("-") || tag !== undefined) {
		usage();
	} else {
		tag = arg;
	}
}
if (tag === undefined) usage();

const root = process.env.RELEASE_CHECK_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

const readManifest = (dir) => {
	const path = join(root, "packages", dir, "package.json");
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		problems.push(`cannot read ${path}: ${error.message}`);
		return undefined;
	}
};
const agent = readManifest("agent");
const cli = readManifest("specsesh");

const valid = (manifest, name) => {
	if (manifest === undefined) return false;
	if (typeof manifest.version !== "string" || !SEMVER.test(manifest.version)) {
		problems.push(`${name} version ${JSON.stringify(manifest.version)} is not semver`);
		return false;
	}
	return true;
};
const agentValid = valid(agent, "@specsesh/agent");
const cliValid = valid(cli, "specsesh");

let version;
if (agent !== undefined && cli !== undefined) {
	if (agent.version !== cli.version) {
		problems.push(`@specsesh/agent is ${agent.version} but specsesh is ${cli.version}`);
	} else {
		version = agent.version;
		if (tag !== `v${version}`) problems.push(`tag ${tag} does not match version ${version} (expected v${version})`);
	}
}

const triple = (v) => {
	const match = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
	return match ? match.slice(1, 4).map(Number) : undefined;
};
const older = (a, b) => {
	for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
	return false;
};
let npm;
try {
	npm = execFileSync("npm", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
} catch (error) {
	problems.push(`cannot run npm --version: ${error.message}`);
}
if (npm !== undefined) {
	const found = triple(npm);
	if (found === undefined) problems.push(`npm version ${JSON.stringify(npm)} cannot be parsed`);
	else if (older(found, triple(MIN_NPM))) problems.push(`npm ${npm} is older than ${MIN_NPM}`);
}

if (packed !== undefined && version !== undefined && agentValid && cliValid) {
	let manifest;
	try {
		manifest = JSON.parse(
			execFileSync("tar", ["-xzOf", packed, "package/package.json"], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			}),
		);
	} catch (error) {
		problems.push(`cannot read package/package.json from ${packed}: ${error.message.split("\n")[0]}`);
	}
	if (manifest !== undefined) {
		const dep = manifest.dependencies?.["@specsesh/agent"];
		if (dep !== version) {
			const found = dep === undefined ? "missing" : JSON.stringify(dep);
			problems.push(`packed specsesh depends on @specsesh/agent ${found}, expected "${version}"`);
		}
	}
}

if (problems.length > 0) {
	for (const problem of problems) console.error(problem);
	process.exit(1);
}
console.log(version.includes("-") ? "next" : "latest");
