// scripts/release-check.mjs — sketch.
//   node scripts/release-check.mjs <tag> [--packed <specsesh.tgz>]
// exit 0: prints the dist-tag (latest|next); 1: one stderr line per problem; 2: usage.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MIN_NPM = "11.5.1";
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;
const root = process.env.RELEASE_CHECK_ROOT ?? fileURLToPath(new URL("..", import.meta.url));
const [tag, flag, packed] = process.argv.slice(2);
if (!tag || (flag !== undefined && (flag !== "--packed" || !packed))) {
	console.error("usage: release-check.mjs <tag> [--packed <specsesh.tgz>]");
	process.exit(2);
}
const read = (dir) => JSON.parse(readFileSync(join(root, "packages", dir, "package.json"), "utf8"));
const agent = read("agent");
const cli = read("specsesh");
const problems = [];
if (agent.version !== cli.version) problems.push(`@specsesh/agent is ${agent.version} but specsesh is ${cli.version}`);
if (!SEMVER.test(agent.version)) problems.push(`${agent.version} is not a semver version`);
if (tag !== `v${agent.version}`) problems.push(`tag ${tag} is not v${agent.version}`);
const npm = execFileSync("npm", ["--version"], { encoding: "utf8" }).trim();
const older = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };
if (older(npm, MIN_NPM)) problems.push(`npm ${npm} is older than ${MIN_NPM}, the minimum for trusted publishing`);
if (packed) {
	const manifest = JSON.parse(execFileSync("tar", ["-xzOf", packed, "package/package.json"], { encoding: "utf8" }));
	const dep = manifest.dependencies?.["@specsesh/agent"];
	if (dep !== agent.version) problems.push(`${packed} depends on @specsesh/agent ${dep}, not ${agent.version}`);
}
if (problems.length > 0) { for (const p of problems) console.error(p); process.exit(1); }
console.log(SEMVER.exec(agent.version)[4] ? "next" : "latest");
