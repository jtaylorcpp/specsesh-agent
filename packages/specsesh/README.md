# specsesh

The command-line tool for [`@specsesh/agent`](https://www.npmjs.com/package/@specsesh/agent).
It runs pi agents, durable runs, and OpenSpec tasks and changes from any repository.

## Quick start

```bash
npx specsesh --help
```

## Install in a project

```bash
npm install --save-dev specsesh
```

The pi-ai, pi-durable and chord dependencies come with it, so there is nothing else to install.

## Commands

Run an agent script:

```bash
specsesh agent run <file.agent>
```

Run a durable script, which can be resumed after a crash:

```bash
specsesh durable run <file.agent> --db runs.sqlite
```

Run one task of an OpenSpec change:

```bash
specsesh task <change> <task-id>
```

Build an OpenSpec change:

```bash
specsesh change build <change>
```

Run a command with no arguments to see its usage. `specsesh --version` prints the version of
both packages, which are released together.

## Prerequisites

- Node 22.19 or later.
- `openspec` 1.14.1 or later in the project (`npm install -D @fission-ai/openspec`) for `change`.
- A model: `--provider claude-code` uses your own logged-in `claude` CLI. Any other pi provider
  needs its API key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …).

## Links

- Guides: https://github.com/jtaylorcpp/specsesh-agent/tree/main/guides
- Docs: https://github.com/jtaylorcpp/specsesh-agent/tree/main/docs
- For library use: [`@specsesh/agent`](https://www.npmjs.com/package/@specsesh/agent)

## License

Apache-2.0
