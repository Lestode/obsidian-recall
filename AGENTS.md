# Repository instructions

These instructions apply to the entire repository.

## Load the product context before changing documentation or code

1. Read [`docs/README.md`](docs/README.md).
2. Read [`docs/development-workflow.md`](docs/development-workflow.md) and follow its high-level-first strategy and approval process. Read every other document that the index marks as relevant to the area being changed.
3. Treat the documentation as the authoritative product specification.
4. If behavior changes, update the relevant documentation before or alongside the implementation.
5. Do not silently resolve a decision that the documentation labels unresolved. Discuss it first or record an explicit decision in the documentation.

## Current implementation boundary

The current phase is the Markdown-to-SQLite read-only inspection slice described
in [`docs/synchronization-and-storage.md`](docs/synchronization-and-storage.md).
Do not implement grading, scheduling policy, Markdown edits from the web
interface, or multi-device synchronization until their documented decisions are
resolved.

## Product constraints

- Markdown must remain readable and useful without the extension.
- Users must not manually manage identifiers or repeat structure as metadata.
- Folder and file structure should supply context wherever the documented grammar permits.
- Authored content and review state remain separate.
- Machine-generated syntax must be unobtrusive and documented.

## Verification

For all changes, run:

```bash
npm test
npm run build
```
