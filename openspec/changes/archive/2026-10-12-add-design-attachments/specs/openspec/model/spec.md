## MODIFIED Requirements

### Requirement: A design is free-form sections
The model SHALL define `Design` as `{ sections: { heading: string, body: string }[], attachments?: DesignAttachment[] }`, sections in source order, and `DesignAttachment` as `{ path: string, kind: "mock" | "example" | "diagram" | "other" }`. A `path` SHALL be relative to the change directory and start with `design/`; an absolute path or one with a `..` segment MUST fail the check. The model MUST NOT require particular headings.

#### Scenario: A design with custom headings is valid
- **GIVEN** a design whose headings are `Context`, `Two halves` and `Risks and gaps`
- **WHEN** it is checked as a `Design`
- **THEN** the check SHALL pass

#### Scenario: A design lists its mock and examples
- **GIVEN** a design with attachments `design/walkthrough.html` of kind `"mock"` and `design/examples/cli.sh` of kind `"example"`
- **WHEN** it is checked as a `Design`
- **THEN** the check SHALL pass

#### Scenario: An attachment outside design/ is refused
- **WHEN** a design with an attachment path `proposal.md`, `/tmp/mock.html` or `design/../tasks.md` is checked
- **THEN** each check SHALL fail
