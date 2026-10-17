# specsesh

Draft, approve, build and close OpenSpec changes with an agent that works each task until your
checks pass. Built on [`@specsesh/agent`](https://www.npmjs.com/package/@specsesh/agent).

```bash
npx specsesh --help
npm install --save-dev specsesh     # or pin it in a project
```

Needs Node 22.19 or later.

## Commands

- `specsesh change draft <change> --intent "…"`, then `approve`, `build`, `close`.
- `specsesh task <change> <task-id>`; `specsesh task status`, `resume`, `answer`.
- `specsesh durable run <file.agent> --db runs.sqlite`; `specsesh durable resume <id> --db …`.
- `specsesh agent run <file.agent>`; `specsesh agent models <provider>`.

`specsesh --version` prints the version of both packages (they release together).

## Before you start

- `openspec` 1.14.1 or later in the project (`npm install -D @fission-ai/openspec`) for `change`.
- A model: `--provider claude-code` runs on your own logged-in `claude`; any pi provider needs
  its key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …).
- An `agentscript.config.json` (see the guides).

## Guides

https://github.com/jtaylorcpp/specsesh-agent/tree/main/guides
