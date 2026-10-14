// How the gates and the change CLI find and run openspec.
import {
  OPENSPEC_MIN_VERSION,
  checkOpenspec,
  describeOpenspec,
  resolveOpenspec,
  runOpenspec,
} from "./openspec-bin.js";

// In agentscript-change, at the start of draft, approve, close and build --amend,
// before any model call or write:
export async function refuseOldOpenspec(workspace: string): Promise<number | null> {
  const check = await checkOpenspec(workspace); // runs `--version` once per process
  if (!check.ok) {
    // e.g. "openspec 1.9.0 at /usr/local/bin/openspec is below the minimum supported version 1.14.1"
    process.stderr.write(check.message + "\n");
    return 2;
  }
  return null;
}

// In the specs gate:
export async function showDeltas(workspace: string, change: string) {
  const bin = await resolveOpenspec(workspace); // memoised: { path, version, source }
  const args = ["show", change, "--json", "--deltas-only"];
  const res = await runOpenspec(bin, args, { cwd: workspace }); // OPENSPEC_TELEMETRY=0
  try {
    return { ok: true as const, json: JSON.parse(res.stdout) };
  } catch {
    return {
      ok: false as const,
      issue: {
        level: "ERROR",
        // "... printed no parseable JSON (openspec 1.14.1 at /repo/node_modules/.bin/openspec)"
        message: `\`openspec ${args.join(" ")}\` printed no parseable JSON (${describeOpenspec(bin)})`,
      },
    };
  }
}

// In close's trial fold: resolve against the repository, then run in the temp copy.
export async function trialArchive(workspace: string, tmpDir: string, change: string) {
  const bin = await resolveOpenspec(workspace); // not resolveOpenspec(tmpDir)
  return runOpenspec(bin, ["archive", change, "--yes"], { cwd: tmpDir });
}

console.log(`minimum supported openspec: ${OPENSPEC_MIN_VERSION}`); // 1.14.1