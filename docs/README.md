# Obsidian Recall documentation

Status: authoring layer plus the first Markdown-to-SQLite inspection slice

This directory is the authoritative source for Obsidian Recall's product behavior. Code must conform to these documents. When behavior changes, update the relevant document before or alongside the implementation.

Obsidian Recall supports broad, evolving active recall without turning note-taking into database administration. The user writes normal Markdown in Obsidian. The system infers structure where possible, adds machine identity automatically, and keeps review history separate from authored material.

## Design principles

1. Markdown remains readable and useful without the extension.
2. The user does not manually manage identifiers or repeat information already expressed by file structure.
3. Authored content and review state are separate. Editing content must not silently destroy review history.
4. The workflow is breadth-first and supports collecting many questions before requiring precise mastery.
5. Automation reduces ceremony without introducing behavior the user cannot understand.
6. The syntax remains small, explicit, and structurally parseable.

## Document map

| Document | Purpose | Read when working on |
|---|---|---|
| [`development-workflow.md`](development-workflow.md) | High-level intent, consistency review, human decisions, and the proposed PR loop | All documentation and code changes |
| [`authoring-workflow.md`](authoring-workflow.md) | User workflow and folder-derived knowledge structure | Obsidian commands, slash actions, collection discovery |
| [`markdown-grammar.md`](markdown-grammar.md) | Canonical question syntax, boundaries, identity, parsing | Parser, editor insertion, identity validation |
| [`question-writing.md`](question-writing.md) | Standalone prompts, question quality, source coverage, and fidelity | Writing questions, PDF or website question generation, content validation |
| [`source-study-workflow.md`](source-study-workflow.md) | Source preparation and persistent study status for later review | PDF or website question generation, studied status, study controls |
| [`architecture.md`](architecture.md) | Layer boundaries and data ownership | Synchronization, SQLite, web application |
| [`synchronization-and-storage.md`](synchronization-and-storage.md) | Incremental vault reconciliation, SQLite indexing, source order, stable sessions, and repository layout | Local service, database, scanner, session consistency, review interface |
| [`review-workflow.md`](review-workflow.md) | Current review concept and unresolved decisions | Review UI, scheduling, review events |
| [`implementation-verification.md`](implementation-verification.md) | Specification-to-code verification for the current phase | Release checks, regression review, implementation status |

## Current phase

The Obsidian authoring layer currently supports:

1. Discover recall roots through `_recall.md`.
2. Create recall roots through an authoring command.
3. Insert questions through `/question`.
4. Generate stable identity automatically.
5. Parse the documented Markdown grammar.
6. Detect missing or duplicated identity.
7. Import numbered question lists with optional `A:` answers.

An additional agent-driven source preparation workflow reads PDFs or websites
and creates a new, parser-validated Recall note with automatic identity. See
[`source-study-workflow.md`](source-study-workflow.md) and the
[source preparation skill](../automation/source-preparation/SKILL.md).

The current companion-service phase adds:

1. A shared parser used by the plugin and local service.
2. Full and incremental vault reconciliation into SQLite.
3. Immutable content versions and archival by Recall UUID.
4. Stable review-session snapshots at the database boundary.
5. A loopback-only API and read-only collection inspector with rendered
   Markdown/math, structured validation diagnostics, archive visibility,
   source hierarchy, manual recovery scans, and targeted incremental updates.

Scheduling, grading, and writable review workflows remain later phases.

The source preparation implementation and future first-study design are described in
[`source-study-workflow.md`](source-study-workflow.md). It records the agreed
per-question study action and the information to store before a review platform
exists, separately from proposals and open decisions. Study tracking is not
implemented; consuming study status for recall comes later.

## Change process

Follow the high-level-first strategy and approval process in
[`development-workflow.md`](development-workflow.md).

1. Discuss one interaction or ambiguity at a time.
2. Record the agreed behavior in the appropriate document.
3. Only then implement or change that behavior.
4. Treat implementation that contradicts these documents as a defect or a proposal requiring discussion.
