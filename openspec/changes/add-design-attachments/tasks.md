## 1. The type

- [x] 1.1 `packages/agent/src/openspec/model.ts`: `DesignAttachment` (`path` under `design/`, no `..`; `kind` one of four) and `Design.attachments` optional
- [x] 1.2 `packages/agent/__tests__/openspec/model.test.ts`: "A design lists its mock and examples" and "An attachment outside design/ is refused" (2); the custom-headings test still passes

## 2. Docs

- [ ] 2.1 `docs/taxonomy/design.md`: the definition and fields gain `attachments`, an invariant for the path rule, and the example directory layout

## 3. Verify

- [ ] 3.1 `pnpm check`, `pnpm test`, `pnpm spec:check` and `pnpm docs:check` pass
- [ ] 3.2 `pnpm spec:archive add-design-attachments`
