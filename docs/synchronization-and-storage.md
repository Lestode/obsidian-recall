# Synchronization, storage, and source ordering

Status: implementation baseline for the Markdown-to-SQLite read-only inspection
phase. Scheduling and grading decisions remain out of scope.

## Purpose

This document specifies how authored Recall questions will flow from an Obsidian
vault into the SQLite review store and local review interface. The design must
make ordinary Markdown editing feel immediate while preserving stable review
history and predictable review sessions.

## Repository and process boundaries

Obsidian Recall should live in a stable, dedicated repository rather than a
dated working directory or the installed Obsidian plugin directory. The target
layout is:

```text
Obsidian Recall/
├── apps/
│   ├── obsidian-plugin/
│   ├── local-service/
│   └── review-web/
├── packages/
│   ├── core/
│   ├── database/
│   └── scheduler/
└── docs/
```

The responsibilities are separated as follows:

- `obsidian-plugin` owns authoring commands and editor behaviour.
- `local-service` watches the vault, owns the SQLite connection, reconciles
  Markdown into the database, and exposes a loopback-only API.
- `review-web` presents indexed content and review sessions through that API.
- `core` contains the Markdown grammar, parser, shared types, and content
  hashing so the plugin and service interpret questions identically.
- `database` contains the schema, migrations, and reconciliation operations.
- `scheduler` will contain selection and scheduling policy after that policy is
  agreed.

The installed Obsidian plugin directory contains build artifacts only. It is
not an authoritative source directory.

## Data ownership

Markdown remains authoritative for:

- Recall roots and subject hierarchy;
- file and topic names;
- section headings;
- question order;
- question wording; and
- answers and supporting notes.

SQLite remains authoritative for:

- append-only review events;
- current scheduling state;
- the content version used during a review;
- archival state for questions absent from Markdown; and
- session snapshots.

SQLite may cache current Markdown content for efficient queries and rendering.
That cache must be completely rebuildable from the vault without changing
review history.

The live database must not be placed inside a cloud-synchronized Obsidian
vault. It belongs in the operating system's application-data directory and
will later need explicit backup and export behaviour.

## Indexed question position

Every indexed question records its current source context:

```text
collection_path
file_path
topic
section_path
question_ordinal
```

`question_ordinal` is the zero-based position of the question among Recall
questions in its current file. It is derived on every successful parse and is
not part of the authored Markdown syntax.

The Recall UUID, rather than file path or ordinal, owns review history.
Consequently:

- reordering a question changes its future presentation order without changing
  its history;
- moving a question to another file preserves its history and adopts its new
  file context and ordinal; and
- renaming or moving a file changes indexed context without creating new
  questions.

## Reconciliation lifecycle

### Startup

On startup, the local service performs a complete reconciliation:

1. Discover every `_recall.md` root.
2. Parse every Markdown file beneath those roots with the shared parser.
3. Validate missing, orphaned, and duplicated Recall identities per file.
4. Quarantine invalid or unreadable files at their previous database state.
5. Build the complete set of question IDs from valid files.
6. Apply valid index changes and quarantines in one transaction.
7. Archive previously indexed questions that were not observed in valid files,
   after absence has been confirmed as described below.

A validation failure must be reported with its file and location. It must not
partially commit an ambiguous index. The loopback server remains available when
the startup scan fails so the inspector can show those diagnostics and accept a
manual rescan after the Markdown is corrected.

Validation has file-level blast radius. An invalid file retains its last indexed
rows while valid files and collections continue reconciling. A duplicated UUID
quarantines every currently observed file participating in that collision.
Diagnostics remain visible until the affected file validates or is confirmed
deleted; an unrelated successful edit does not clear them.

### Incremental changes

During normal operation, the service watches create, modify, rename, and delete
events. Changed paths are accumulated for a short debounce window. Each new
event for the same editing burst restarts that window. When the user pauses,
all dirty files are parsed and reconciled together in one transaction.

The initial debounce should be approximately 250 milliseconds. This is an
operational default rather than authored or review data and may be tuned after
measurement.

Batching related paths is required. Moving a question between two files can
produce a removal event followed by an insertion event. Reconciling the whole
dirty batch lets the UUID be recognized as one question changing location
rather than a deletion followed by a new question.

A single missing-path observation is not sufficient evidence of deletion,
because cloud-backed files can disappear transiently during hydration or an
atomic save. The service retains the previous rows and checks the path again
after a short one-second grace period. Only a second absent observation after
that grace archives the file. Non-`ENOENT` stat or read failures are diagnostics
and never count as deletion.

The same grace applies when a `_recall.md` marker disappears: its entire
collection is retained until marker absence is confirmed. Resolving or removing
a duplicate identity schedules a complete identity recheck after every affected
successful reconcile so a question moved across separate saves, removed by
editing, or moved out of a quarantined file converges without requiring an
unrelated edit.

The normal incremental operation is proportional to the affected files, not
the size of the whole vault. A complete scan remains available as a startup,
recovery, and manual-resynchronization operation.

### Atomic visibility

One reconciliation batch is one SQLite transaction. It may:

- insert newly discovered questions;
- update current content and source positions;
- insert immutable content versions when hashes change;
- move or rename existing identities;
- archive identities absent after the complete dirty batch; and
- advance a monotonically increasing database revision.

Readers see either the state before that transaction or the state after it.
They must never observe partially refreshed ordinals or a mixture of old and
new file contents.

The local service is the only SQLite writer. SQLite should use WAL mode so the
review interface can continue reading while reconciliation writes.

## Content identity and versions

The current content hash is derived from a canonical representation of the
parsed question and answer. File path, headings, and ordinal are source context
and do not change the content hash.

When the content hash changes, reconciliation inserts an immutable version and
updates the rebuildable current-content index. It does not reset or rewrite
review history.

At minimum, the planned database separates:

| Store | Role |
|---|---|
| `questions` | Rebuildable current Markdown index and archive status |
| `question_versions` | Immutable prompt-and-answer versions by content hash |
| `review_events` | Append-only outcomes referencing the reviewed version |
| `review_state` | Cached current scheduling state for each UUID |
| `review_sessions` | Stable queue metadata and lifecycle |
| `review_session_items` | Ordered question IDs and content hashes for a session |

These stores and their initial columns are implemented in the database package.
Review events retain before-and-after scheduling fields, although the policy
that will populate them remains unresolved.

## Importance and source order

Question selection first determines recall importance. Questions with similar
importance are presented in the order in which they currently appear in the
source file.

Similarity must be expressed through explicit scheduler-defined importance
bands, not accidental equality between floating-point scores. Within a review
of the current file, the ordering contract is conceptually:

```text
importance_band ASC, question_ordinal ASC
```

A substantially more urgent question may therefore appear earlier, while
questions in the same importance band retain the pedagogical sequence of the
note. The precise bands remain part of the unresolved scheduling policy.

Cross-file ordering within a collection is not yet specified. File order must
not be inferred from unstable filesystem enumeration.

The read-only inspector uses alphabetical `file_path` order solely for a
deterministic library listing. This is not the future cross-file review order,
which remains unresolved.

## Stable review sessions

Starting a review creates an ordered session snapshot. Each item contains at
least:

```text
question_id
content_hash
session_position
```

The snapshot provides the following behaviour:

- adding a question updates the library immediately but does not insert it into
  a session already in progress;
- reordering or moving a question affects the next session, not the current
  session;
- editing content creates a new version, while an active session may finish
  with the version it captured;
- removing a not-yet-presented question archives it and causes the active
  session to skip that item safely; and
- the next session uses the latest successful reconciliation and source order.

An explicit command for rebuilding an active queue may be considered later.
Automatic mid-session reshuffling is not allowed.

The database now implements this snapshot contract independently of the future
review-selection policy: session creation captures the current revision,
ordered UUIDs, and content hashes; reads resolve prompt and answer from the
captured immutable versions; reconciliation marks newly archived session items
as skipped without changing positions or captured content.

## Interface updates

The local API returns the current database revision. After a successful
reconciliation, the service notifies the interface through server-sent events
or a WebSocket. The notification should identify the affected questions or
files so the interface can invalidate a small part of its state rather than
reload the entire collection.

The first interface milestone is a read-only inspector showing:

- collection, folder, topic, and section hierarchy;
- current question order and counts;
- rendered prompts and answers;
- source file locations;
- new, reviewed, changed, due, and archived status; and
- missing or duplicated identity diagnostics.

This inspector validates the complete Markdown-to-SQLite-to-interface path
before review outcomes or scheduling policy are implemented.

The inspector uses a native collapsed disclosure for answers so prompts remain
scannable while answers are still inspectable. This is inspector presentation,
not the progressive-reveal behavior of the future review screen, which remains
unresolved.

Incremental notifications include affected file paths. The inspector replaces
only those files in its in-memory question list; a full question reload is
reserved for startup, explicit full rescans, collection/filter changes, and
recovery events. Prompts and answers are rendered as sanitized Markdown with
math support. Validation diagnostics remain visible against the last successful
database revision.

Local PDF links in answers use a read-only source route scoped to the indexed
question. The service verifies that the requested file is an actual PDF linked
from that answer, and the inspector preserves its physical-page fragment.
Other filesystem paths are not exposed. This implements the source-reference
behavior in [source preparation](source-study-workflow.md) without changing
the Markdown or copying source files.

## Failure and recovery behaviour

- A parse or validation failure preserves the affected file's last successful
  rows, reports that file, and does not prevent valid files from advancing the
  database revision.
- A failed transaction exposes none of its partial changes.
- Watcher overflow or uncertainty schedules a complete reconciliation.
- Deleting the rebuildable index does not delete review events or review state.
- Deleting the entire database loses review history, so backup and restore must
  be designed before the review store becomes the sole durable history.

## First implementation acceptance criteria

The first implementation phase is complete when:

1. The repository has the documented stable layout.
2. The plugin and service use the same tested Markdown parser.
3. A full scan indexes a real Recall collection correctly.
4. Adding, editing, removing, reordering, moving, and renaming questions all
   reconcile without losing UUID-associated history.
5. The interface never observes a partially reconciled batch.
6. A read-only inspector reflects incremental changes without a full reload.
7. Automated tests cover moves between files, edit bursts, transaction failure,
   duplicated identity, archival, and stable session snapshots.

## Still unresolved

This document intentionally does not decide:

- review outcome vocabulary;
- the scheduling algorithm or exact importance bands;
- the interaction for changed content after it has been reviewed;
- whether the review interface may edit Markdown;
- cross-file ordering within a collection;
- progressive answer reveal; or
- multi-device synchronization of review history.

Those decisions belong to the review workflow and scheduler design and must be
agreed before their implementation.
