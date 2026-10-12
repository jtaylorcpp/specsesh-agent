## ADDED Requirements

### Requirement: The harness registers search actions when its workspace can search
`createAgentHarness` SHALL add `searchActions(workspace)` to the registry, after the built-ins, when the workspace has both `list` and `search`, and SHALL pass its `models` and registry to every runner that validates grants against them.

#### Scenario: A local workspace gets list_files and search_files
- **GIVEN** a config with `workspace: () => localWorkspace(dir)`
- **WHEN** the harness is built
- **THEN** its `actions` SHALL hold `list_files` and `search_files`

#### Scenario: A workspace that cannot search gets neither
- **GIVEN** a workspace with no `search`
- **WHEN** the harness is built
- **THEN** its `actions` SHALL hold neither `list_files` nor `search_files`
