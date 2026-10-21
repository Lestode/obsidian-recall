# Obsidian Recall

Obsidian Recall is a local-first system for authoring active-recall questions in
ordinary Obsidian Markdown and indexing them for review. The authoritative
product specification begins at [`docs/README.md`](docs/README.md).

The current implementation contains:

- `_recall.md` marks an active-recall root.
- `/enable-recall-folder` creates the marker.
- `/question` inserts a normal-sized `**Q:**` question and a hidden UUID.
- The parser extracts questions and applies the documented answer boundary.
- An inspection command reports missing and duplicated identities.
- A local service that scans Recall roots into SQLite.
- Immutable question versions and archival without deleting review history.
- Stable database snapshots for future review sessions.
- Incremental, debounced reconciliation of changed Markdown files.
- A read-only local web inspector with rendered Markdown and math, diagnostics,
  archive visibility, source hierarchy, and targeted live updates.

Scheduling, grading, and the interactive review workflow remain intentionally
unimplemented until their product decisions are resolved.

## Repository layout

```text
apps/obsidian-plugin  Obsidian authoring extension
apps/local-service    Vault watcher, SQLite owner, and local HTTP API
apps/review-web       Read-only collection inspector
packages/core         Shared Markdown parser and source-context logic
packages/database     SQLite schema and reconciliation
packages/scheduler    Reserved boundary for the unresolved scheduling policy
```

## Development

The SQLite service requires Node.js 22.5 or newer. The repository pins Node 22
and the test and start scripts invoke it explicitly when necessary.

```bash
npm install
npm test
npm run build
```

Run the local inspector against a vault with:

```bash
npm run start -- --vault "/absolute/path/to/vault"
```

Then open `http://127.0.0.1:45871`.

For manual plugin testing, copy `manifest.json`, `main.js`, and optionally
`styles.css` from `apps/obsidian-plugin/` into:

```text
<vault>/.obsidian/plugins/obsidian-recall/
```

Then reload Obsidian and enable **Obsidian Recall** under Community plugins.
