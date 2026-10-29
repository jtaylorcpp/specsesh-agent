## MODIFIED Requirements

### Requirement: specsesh llm providers and deploy print the shipped pages
`main(["llm", "providers"])` SHALL print `docs/providers/README.md`; `main(["llm", "providers", <name>])` SHALL print `docs/providers/<name>.md` for `api-keys`, `claude-code`, `gemini`, `ollama` or `workers-ai`; `main(["llm", "deploy", <target>])` SHALL print `docs/deploy/<target>.md` for `local` or `cloudflare`. Each SHALL return `0`, opening no database and calling no model. Any other name, or `deploy` with no target, SHALL print the llm usage to stderr and return `2`.

#### Scenario: providers prints the matrix
- **WHEN** `main(["llm", "providers"])` runs
- **THEN** it SHALL return `0` and stdout SHALL equal `docs/providers/README.md`

#### Scenario: A provider page prints by name
- **WHEN** `main(["llm", "providers", "ollama"])` runs
- **THEN** it SHALL return `0` and stdout SHALL equal `docs/providers/ollama.md`

#### Scenario: The gemini page prints by name
- **WHEN** `main(["llm", "providers", "gemini"])` runs
- **THEN** it SHALL return `0` and stdout SHALL equal `docs/providers/gemini.md`

#### Scenario: A deployment page prints by name
- **WHEN** `main(["llm", "deploy", "cloudflare"])` runs
- **THEN** it SHALL return `0` and stdout SHALL equal `docs/deploy/cloudflare.md`

#### Scenario: An unknown page prints usage
- **WHEN** `main(["llm", "providers", "nope"])` and `main(["llm", "deploy"])` run
- **THEN** each SHALL return `2` with stderr beginning `usage: specsesh llm`
