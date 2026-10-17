# Example session once add-specsesh-package lands. Output is illustrative.

$ npx specsesh --version
specsesh 0.1.0

$ npx specsesh --help            # stdout, exit 0
usage:
  specsesh change <draft|approve|build|close> <change> [options]
  specsesh task <change> <task-id>|<group>|--next|--next-group [options]
  specsesh task <run|spec|resume|answer|status> [options]
  specsesh durable <run|resume> [options]
  specsesh agent <run|models> [options]
  specsesh --version
  specsesh --help
Run a command with no arguments for its own usage.

$ npx specsesh frobnicate        # stderr, exit 2
usage:
  ...

# Each subcommand is the bin it wraps, arguments unchanged:
$ npx specsesh change draft add-plan-export --intent "Export a plan as JSON"
$ npx specsesh change approve add-plan-export
$ npx specsesh change build add-plan-export
$ npx specsesh change close add-plan-export

# task implies run, as `pnpm task` does:
$ npx specsesh task add-plan-export 1.1          # = agentscript-task run add-plan-export 1.1
$ npx specsesh task add-plan-export --next-group # = agentscript-task run add-plan-export --next-group
$ npx specsesh task status

$ npx specsesh durable run hello.agent --db runs.sqlite --provider claude-code
$ npx specsesh agent models anthropic

# Until name-specsesh-in-change-output lands, the sub-CLIs still print their old names:
$ npx specsesh change
usage:
  agentscript-change draft <change> [<feedback>] [--intent <words>|--intent-file <path>] [--db <path>]
  ...
