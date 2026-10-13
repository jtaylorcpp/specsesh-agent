// What delete_file answers. Every refusal is an { ok: false } result, never a throw.
import { deleteActions } from "@specsesh/agent/durable";
import { localWorkspace } from "@specsesh/agent/node";

const workspace = localWorkspace("/work/specsesh");
const [deleteFile] = deleteActions(workspace);

// deleteFile.name    === "delete_file"
// deleteFile.kind    === "edit"
// deleteFile.inputs  ≡ { path: "string" }
// deleteFile.outputs ≡ { ok: "boolean" }
// deleteFile.replay  === "unsafe"

const ctx = { workspace, signal: new AbortController().signal };

export async function demo() {
  // Retire a file the task owns.
  const done = await deleteFile.execute({ path: "src/legacy/old-runner.ts" }, ctx);
  // { ok: true, outputs: { ok: true }, record: Action { kind: "edit", refs: ["src/legacy/old-runner.ts"] }
  //                                          + DiffEvidence { path: "src/legacy/old-runner.ts", change: "deleted" } }
  console.log(JSON.stringify(done));

  const refusals = [
    "/etc/hosts",               // outside the workspace (absolute)
    "../outside.txt",           // outside the workspace (..)
    "link/passwd",              // outside the workspace (symlink to /etc)
    ".git/config",              // inside .git
    "src/legacy/old-runner.ts", // no such file: src/legacy/old-runner.ts (already deleted)
    "src/legacy",               // is a directory: src/legacy
  ];
  for (const path of refusals) {
    const r = await deleteFile.execute({ path }, ctx);
    // { ok: false, … } carrying the message above; nothing deleted, no Action recorded
    console.log(path, JSON.stringify(r));
  }
}

// The workspace operation underneath, for other actors:
export async function direct() {
  await workspace.remove?.("tmp/scratch.txt"); // rejects WorkspaceError on any of the refusals above
}
