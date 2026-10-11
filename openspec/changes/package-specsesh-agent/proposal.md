## Why

The library is going to be used from other projects through npm, and today it can't be installed at all. It is four private workspace packages that export raw `.ts`, depend on each other through `workspace:*`, run their CLIs through `tsx`, and still carry the old `@coopcli/agentscript` name, including inside error messages a caller sees.

## What Changes

- **One package, `@specsesh/agent`, version `0.1.0`**, replacing `@coopcli/agentscript`, `agentscript-pi` and `agentscript-durable`. Its entry points:
  - `@specsesh/agent/authoring`, `@specsesh/agent/interpreter`: the core (no model client; runs on Node and Workers).
  - `@specsesh/agent/pi`: the pi-ai reasoning port and model helpers.
  - `@specsesh/agent/claude-code`: the claude-code port and pi provider (Node only).
  - `@specsesh/agent/durable`: the pi-durable extension and host functions.
  - `@specsesh/agent/cloudflare`: the `AgentScriptHost` Durable Object class, for a Worker to re-export.
- **Built output.** `dist/` holds compiled ESM, type declarations and source maps. The package publishes only `dist/`, `README.md` and `LICENSE`. Nothing at runtime needs `tsx`.
- **Two CLIs, unchanged in behaviour:** `agentscript-pi` and `agentscript-durable`, as compiled `bin` entries.
- **Dependencies.** The `@sf-agentscript/*` packages stay exact-pinned dependencies. pi-ai, pi-durable, chord and `agents` become optional peer dependencies: a consumer of the interpreter alone installs none of them.
- **Renamed wording.** The two user-facing messages that name `@coopcli/agentscript` (the subset refusal and `NoReasoningPortError`) name `@specsesh/agent`. Every spec requirement naming an old package or entry is modified to the new entry point.
- **Examples consume the package** the way an outside project would: `examples/hello-world` and a new `examples/cloudflare-worker` (the current Worker app, moved).
- **A pack check.** `pnpm pack:check` builds, runs `npm pack`, installs the tarball into an empty project and imports every entry point with plain Node.

## Out of scope

- Running `npm publish`. It needs an npm login that owns the `@specsesh` scope, and 2FA; that is a manual step after this change.
- Publishing automation (CI, trusted publishing) and versioning policy beyond `0.1.0`.
- Any behaviour change other than the renamed wording. The parked bugs stay parked.

## Open question

- **License.** A public package needs one. Proposed: MIT.

## Impact

- `packages/*` collapse into one package; tests move with their code and keep passing unchanged except for import paths and the renamed wording.
- New capability `package/distribution`. Modified: `core/*`, `pi/*`, `durable/*` requirements that name packages, entries or `tsx`.
- Depends on `baseline-pi-adapter` being archived first, so its requirements can be modified.
