/**
 * The bundled delegate scripts, as source text so a Worker can use them too.
 *
 * Both keep the delegate contract: `instructions` (string) is seeded with the
 * call's; `ok` (boolean) and `summary` (string) are read back when the child
 * completes. One subagent, `work`, offers the workspace actions and finishes
 * with a structured result that sets `ok` and `summary`. Runtime-neutral: no
 * `node:` import.
 */

const DEFINITIONS = {
	read_file: `        read_file:
            description: "Read a file in the workspace"
            inputs:
                path: string
            outputs:
                content: string
            target: "mcpTool://read_file"
`,
	list_files: `        list_files:
            description: "List the workspace's files matching a glob"
            inputs:
                glob: string
            outputs:
                paths: string
            target: "mcpTool://list_files"
`,
	search_files: `        search_files:
            description: "Search the workspace's files matching a glob for a pattern"
            inputs:
                pattern: string
                glob: string
            outputs:
                matches: string
            target: "mcpTool://search_files"
`,
	edit_file: `        edit_file:
            description: "Replace a file's content in the workspace"
            inputs:
                path: string
                content: string
            outputs:
                ok: boolean
            target: "mcpTool://edit_file"
`,
	run_command: `        run_command:
            description: "Run an allowed command in the workspace"
            inputs:
                command: string
            outputs:
                exit_code: number
                output: string
            target: "mcpTool://run_command"
`,
} as const;

const OFFERS: Record<keyof typeof DEFINITIONS, string> = {
	read_file: `            read_file: @actions.read_file
                with path = ...
`,
	list_files: `            list_files: @actions.list_files
                with glob = ...
`,
	search_files: `            search_files: @actions.search_files
                with pattern = ...
                with glob = ...
`,
	edit_file: `            edit_file: @actions.edit_file
                with path = ...
                with content = ...
`,
	run_command: `            run_command: @actions.run_command
                with command = ...
`,
};

function delegateScript(name: string, role: string, actions: readonly (keyof typeof DEFINITIONS)[]): string {
	return `config:
    agent_name: "${name}"
    description: "A delegate that ${role} in the caller's workspace"

system:
    instructions: |
        You are a delegate: another agent handed you one piece of work in a real workspace.
        Use only the actions you are offered. Do what the instructions ask and nothing more.

variables:
    instructions: mutable string = ""
        description: "the caller's instructions"
    ok: mutable boolean = False
        description: "whether the work is done"
    summary: mutable string = ""
        description: "what was found or changed, for the caller"

subagent work:
    description: "Do the delegated work with the workspace actions"

    actions:
${actions.map((action) => DEFINITIONS[action]).join("")}
    reasoning:
        instructions: ->
            | Instructions:
            | {!@variables.instructions}
            | When you are done, answer ok (true only when the instructions are carried out) and summary (what you found or changed, first line a one-line answer).
            set @variables.ok = @outputs.ok
            set @variables.summary = @outputs.summary
        actions:
${actions.map((action) => OFFERS[action]).join("")}`;
}

/** Reads, lists and searches: for reviews and research. */
export const READ_AGENT: string = delegateScript("read-agent", "reads", ["read_file", "list_files", "search_files"]);

/** `READ_AGENT` plus `edit_file` and `run_command`. */
export const EDIT_AGENT: string = delegateScript("edit-agent", "reads, edits and runs commands", [
	"read_file",
	"list_files",
	"search_files",
	"edit_file",
	"run_command",
]);
