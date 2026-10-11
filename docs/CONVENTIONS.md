# Conventions

## One concept, one file

- A concept is a type, a step, a loop or a state machine from the model. Its file is `<id>.md`, where `id` is kebab-case and unique across all of `docs/`.
- Steps take the suffix `-step` (`design-step`), so they never collide with a noun of the same name (`design`).
- Every concept appears exactly once in [README.md](README.md), in its area's table, linked by its path.

## Front matter

Every concept page starts with:

```yaml
---
id: task-link                 # = the file name without .md
name: TaskLink                # the type's name as the model spells it
kind: type                    # type | step | loop | state-machine
area: taxonomy                # taxonomy | process | loops | evidence
spec:                         # the requirement(s) this page restates
  - "openspec/model: A task links to requirements and scenarios by inference"
related: [task, link-basis, requirement-ref, scenario-ref]   # ids of other concept pages
status: modelled              # modelled | implemented
---
```

`spec` entries are `<capability>: <exact requirement name>`. `related` entries must be ids that exist.

## Sections, in this order

1. **`# <name>`**, then one sentence: what it is.
2. **Definition:** the shape, in the model's notation (a fenced block).
3. **Fields:** a table of field, type and meaning. For a step, the input, output and actor instead. Omit for a pure union.
4. **Invariants:** the rules that must always hold, as a bullet list. Write "None." when there are none.
5. **Relations:** how it connects to other concepts, each as a link (`[Task](../taxonomy/task.md)`).
6. **Example:** a concrete instance, from this repo when possible (task `2.4` of `baseline-agentscript-durable`, capability `["durable", "run-task"]`).
7. **Spec:** the requirement(s) restated, as a list.

## Keeping it honest

`pnpm docs:check` fails when:
- a concept page has missing or malformed front matter, or `id` does not match its file name;
- two pages share an `id`, or `related` names an id with no page;
- a page is missing from README, README lists a path with no page, or lists one twice;
- a `spec` entry names a requirement that does not exist in the ontology change or in `openspec/specs/`.

README, overview and this file are not concept pages.
