## ADDED Requirements

### Requirement: The repo config may name more models
A top-level `models` object SHALL map names to `{ provider, model }`, each resolved like the run's own provider and model, becoming `createAgentHarness` model factories beside `default` (the run's resolved provider and model). A name of `default`, an unknown provider, or an unknown key MUST exit `2` naming it.

#### Scenario: A named model reaches the harness
- **GIVEN** a config with `"models": { "reviewer": { "provider": "anthropic", "model": "claude-haiku-4-5" } }`
- **WHEN** `run` builds its harness
- **THEN** its `models` SHALL hold `default` and `reviewer`

#### Scenario: Redefining default is refused
- **GIVEN** a config with `"models": { "default": { "provider": "anthropic", "model": "x" } }`
- **WHEN** `run` starts
- **THEN** stderr SHALL name `default` and the exit code SHALL be `2`

### Requirement: An agent grant's script is a bundled name or a path
In the repo config, an agent grant's `script` of `read` or `edit` SHALL select `READ_AGENT` or `EDIT_AGENT`; any other value SHALL be a path resolved against the config file's directory and read once. A path that does not exist MUST exit `2` naming it.

#### Scenario: A bundled delegate script by name
- **GIVEN** a grant `{ "runner": "agent", "model": "reviewer", "script": "read" }`
- **WHEN** `run` builds its harness
- **THEN** the grant's script SHALL be `READ_AGENT`
