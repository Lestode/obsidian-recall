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
- Obsidian study controls with durable progress, explicit undo, and changed-content notices.
- Incremental, debounced reconciliation of changed Markdown files.
- A read-only local web inspector with rendered Markdown and math, diagnostics,
  archive visibility, source hierarchy, and targeted live updates.
- Agent-driven PDF/website preparation into a new Recall note with automatic
  identity and parser validation.

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

## Prepare questions from a source

With an agent working in this repository, ask it to use
[`source-preparation`](automation/source-preparation/SKILL.md), giving a PDF or
web page and a destination folder inside a Recall collection. For example:
“Prepare States and Observations from Spinning Up in my Reinforcement Learning
collection.” The agent reads the source, drafts and checks the questions, and
creates the note; no manual list conversion or UUID editing is needed.

The first implementation is an agent skill with a local writer, not an
unattended generator or an Obsidian command. A source-history question protects
against unintended copies. Existing notes and history are never overwritten.
The Spinning Up pilot draft is available in the skill's `examples/` directory;
its content still needs user review before expanding to the full source.

## Study questions in Obsidian

Run the companion service for your vault using the command above. In Obsidian
Recall settings, set **Study companion service** to its loopback address
(default `http://127.0.0.1:45871`). Each vault needs its own database; use
`--database /path/outside/the/vault/recall.sqlite` when switching vaults.

Open a Recall note in Live Preview or Reading view. All questions start **Not
studied**, including existing questions. Click **Mark studied →** or focus that
button and press Enter: **✓ Studied** is saved and focus advances to the next
question. **Next →** skips without marking; **Undo study** reverses a mark.
Editing keeps the studied mark and shows **Content changed**. The service must
remain running. **Study unavailable** means the connection needs attention; use
Retry after reconnecting. Progress is local SQLite data, not Markdown. See the
[backup procedure](docs/source-study-workflow.md#study-state-ownership).

For manual plugin testing, copy `manifest.json`, `main.js`, and
`styles.css` from `apps/obsidian-plugin/` into:

```text
<vault>/.obsidian/plugins/obsidian-recall/
```

Then reload Obsidian and enable **Obsidian Recall** under Community plugins.
