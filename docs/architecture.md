# Architecture and data ownership

The planned system has three layers:

1. **Obsidian authoring extension** — discovers collections, inserts syntax, and parses questions.
2. **SQLite review store** — retains review state and append-only history.
3. **Local web interface** — presents review sessions and records outcomes.

The first layer and the read-only indexing path through the second and third
layers, plus per-question study controls and SQLite persistence, are
implemented. Review scheduling and graded review events are not yet implemented.

## Markdown owns authored knowledge

Obsidian Markdown is authoritative for:

- collection and subject hierarchy;
- topic name;
- question wording;
- answer and supporting notes; and
- links and other ordinary Obsidian content.

## SQLite owns review information

SQLite will be authoritative for:

- per-question study progress and the version marked studied;
- review events and attempt history;
- current review state;
- suggested or selected next review;
- the content version seen during a review;
- whether current content differs from last-reviewed content; and
- archival state for removed questions.

The database may index Markdown content for efficient presentation, but that index is not the authoritative copy of authored knowledge.

The incremental reconciliation, source-order, session-snapshot, and process
boundaries are specified in
[`synchronization-and-storage.md`](synchronization-and-storage.md).

## Editing after review

Changing a question or answer must not automatically reset its review history. The system should detect when current content differs from the version most recently reviewed.

The eventual interaction for keeping, accelerating, resetting, or splitting changed questions remains unresolved and belongs to the review workflow.
