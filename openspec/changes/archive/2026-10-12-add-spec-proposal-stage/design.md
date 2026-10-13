## Context

A stage is a `SpecStage` (`add-spec-loop`): files it owns, a script, an optional `seed` and a gate. This change adds the first real one, plus the parsing its gate needs. The ontology has no Markdown parser, by rule, so parsing lives in the task layer beside `tasks-md.ts`.

## The proposal format

The shape this repo's proposals already have, made checkable:

```markdown
## Why
…
## What Changes
…
## Out of scope
…
## Capabilities

- **New:** `spec/stages`.
- **Modified:**
  - `task/cli`;
  - `task/headless`.

## Impact
…
```

`readProposalCapabilities(markdown)` collects the backticked `<area>/<name>` paths after each label, on its own line and on the nested bullets below it, until the next label or the end of the section.

## The stage

```ts
export const proposalStage: SpecStage = {
	name: "proposal",
	owns: ["proposal.md"],
	script: { path: fileURLToPath(BUNDLED_SCRIPTS.specProposal) },
	seed: async ({ workspace }) => ({ base: await capabilityLines(workspace) }),
	gate: async ({ workspace, files }) => [
		...sectionIssues(files["proposal.md"] ?? ""),
		...capabilityIssues(readProposalCapabilities(files["proposal.md"] ?? ""), await existingCapabilities(workspace)),
		...proposalSizeIssues(asProposal(files["proposal.md"] ?? "")),
	],
};
```

`capabilityLines` reads every `openspec/specs/<area>/<name>/spec.md`, taking its `## Purpose` paragraph:

```
actions/registry: Model-callable and deterministic actions for Agent Script runs…
core/authoring: Parsing and editing Agent Script documents…
…
```

## The script

[`design/examples/spec-proposal.agent`](design/examples/spec-proposal.agent) is the draft of the bundled script. One structured subagent reads the intent, the capabilities and the carried feedback, and returns `files` (one `=== proposal.md` section), `summary`, `next_action` and `question`. Its instructions carry the guidance:
- the smallest change that delivers something a user can see;
- at most two capabilities;
- reuse an existing capability path over inventing a near-duplicate;
- state what is out of scope;
- ask only when the intent can't be read two sensible ways without a decision.

## Decisions

- **The gate checks shape and facts, not quality.** Whether the Why is persuasive is the principal's call at review. Whether `task/cli` exists is a fact.
- **`base` is every capability, not a search.** This repo has about 30; one line each fits easily. A large repo may later want a filter; nothing here assumes there won't be one.

## Risks

- **The proposal format is now a rule.** Older proposals with different headings (`add-cloudflare-workspace` uses sub-bullets under New, which this parser accepts) aren't re-checked: the gate runs only on drafts.
