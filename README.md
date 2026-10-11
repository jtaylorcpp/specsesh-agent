# @coopcli/agentscript

Agent Script as an **authoring format**, plus an **interpreter** over a declared
subset of it.

## Why this is a package and not a specsketch module

It is used by specsketch today and is meant to be reusable by anything else that
wants a prompt-workflow document with real syntax, linting and editor support.
Keeping it separate is also what keeps it honest: the interpreter cannot quietly
reach for a model client it does not own.

## What it does not do

**It never compiles.** Agent Script's compiler emits a Salesforce-internal
specification format that executes only on Salesforce infrastructure — the
runtime is not open source. Compiling from here would produce a build that can
never be run.

That is enforced structurally. The dependencies are
`@sf-agentscript/language` (analysis engine, lint passes, Language Service API)
and `@sf-agentscript/parser-javascript` (error-tolerant parser). The compiler
ships in `@sf-agentscript/agentforce`, which is deliberately **not** a
dependency of this package.

**It holds no credential and imports no model client.** Reasoning leaves through
an injected port whose only in-repo implementation is harness-backed. See
`src/interpreter/index.ts`.

## Drift travels one way

The Agent Script **language specification is closed to outside contribution** —
upstream's own words: *"we're not accepting changes to the language spec for
now. The spec needs to stay in sync with the runtime."* So we cannot propose a
change, and we cannot fork one either: a divergent dialect would be a language
nobody else's tooling reads.

Drift is therefore **absorbed, never upstreamed**. Every upstream dependency is
pinned to an exact version, and `scripts/check-subset-conformance.mjs` — run by
this package's own `test` script — parses one probe per supported construct and
fails naming any whose handling changed. A version bump cannot land while a
construct silently started meaning something else.

The supported constructs are declared once, in `src/interpreter/subset.ts`. The
conformance script, the refusal a caller gets, and the list below all read that
same declaration rather than keeping a copy of it.

## The supported subset

Anything outside this list is refused **before the run starts**, by name and
position, and worded as *unsupported by this runtime* — the document is very
likely valid Agent Script that Salesforce's runtime would execute; what is true
is that we do not implement it.

<!-- SUBSET:BEGIN — generated from renderSubsetMarkdown(); do not hand-edit -->
- `config` — the config block naming the agent
- `system.instructions` — standing instructions, as a multiline block
- `variables` — declared variables with a type and a literal default
- `variables.description` — a variable's description
- `subagent` — a named subagent with a description
- `subagent.reasoning` — a subagent's reasoning block
- `reasoning.prompt-line` — a prompt line, interpreted by the model
- `reasoning.interpolation` — a `{!@variables.x}` reference inside a prompt line
- `reasoning.logic-line` — a logic line, run deterministically every turn
- `reasoning.structured-output` — assigning a variable from a field of the step's structured result
<!-- SUBSET:END -->

`__tests__/subset-single-source.test.ts` fails if that block and the declaration
disagree, so the three restatements this requirement warns about cannot appear.

**This already caught something.** The vocabulary in Salesforce's own README
example is `topic`; the pinned dialect deprecates it — *"'topic' is deprecated:
Replace topic with subagent."* The subset uses `subagent`. Building on the
deprecated spelling would have been a decision nobody made.

## The interpreter runs the dialect's spelling, not a near-miss of it

A document this interpreter runs must be one an author could SAVE — the two
halves of this package parse the same text with the same dialect, and where
they disagreed, the authoring surface was right. Three spellings had drifted,
each runnable and each an error in the author's editor:

| the dialect | the near-miss it rejects |
|---|---|
| `approved: mutable boolean = True` | `true` — *"'true' is not a valid value in AgentScript. Did you mean 'True' (capitalized)?"* |
| `| Draft the {!@variables.stage}.` | `{@variables.stage}` — *"The '!' is required for template interpolation."* |
| `set @variables.verdict = @outputs.verdict` | `@output` — *"'@output' is not a recognized namespace"* |

`run()` now refuses any document carrying error-severity diagnostics, before it
scans and before it dispatches. That covers a fourth case the list above cannot:
the parser RECOVERS from a syntax error rather than throwing, so an unterminated
string used to execute to `completed` with a variable holding a value the
recovery invented. Every fixture the interpreter tests against is asserted
lint-clean by `__tests__/fixtures-lint.test.ts`, which is the seam that was
missing when all three drifted.

## Status

**Private to this repository, by decision.** Publishing is deferred to a later
date, so the manifest carries `"private": true` and the package does not appear
in `publish.yml`'s publish steps.

It is nonetheless built to a published package's discipline — no workspace
dependency, no model client, no import reaching outside its own `src/` — and
those are pinned by `__tests__/import-boundary.test.ts` rather than left to
intention. That is deliberate: the constraint is only cheap to hold while it is
being held. Publishing later becomes a one-line change of `private`; the
alternative, letting a workspace dependency in "because it isn't published yet",
would mean retrofitting the reasoning port at exactly the moment publishing
turned urgent.

When it does ship, the order matters: configure the npm trusted publisher, then
publish once **by hand** (OIDC cannot bootstrap a package npm has never seen),
and only then add it to the release workflow — every merge to `main` releases,
and a workflow step for an unbootstrapped package fails every one of them.

Built by `simplify-specsketch-workbench`.
