# Review workflow

Status: first writable study and FSRS review milestone, authorized after the
[review intent discussion](review-intent-draft.md). Deadline forecasting and
RWKV are deferred. This document governs the implementation defaults below.

## Study and recall

Obsidian owns authored Markdown. SQLite owns study status and recall history.
First study is available in an Obsidian study panel and on the local website.
Only an explicit Enter/click action marks the focused question studied, displays
**✓ Studied**, and advances focus. Opening or revealing content does not count.
The two interfaces read the same database through the local service. No progress
syntax is written to Markdown. Study status survives moves, reindexing, and restart.
Existing questions without study records start unstudied; legacy review history
is preserved, but does not silently manufacture a study mark.

The website shows collections and folders with counts of unseen, ready for a
first recall, and due questions. Unseen material is included by default and can
be disabled. A study item shows its answer immediately. A recall item hides the
answer until Reveal, then offers the following assessments:

| Rating | Meaning |
|---|---|
| Again | Essential answer missing, a crucial error, or help was needed. |
| Hard | Essentials reconstructed independently, with substantial effort or doubt. |
| Good | Essentials reconstructed independently with reasonable effort. Minor omissions are fine. |
| Easy | Essentials reconstructed fluently with little effort. |

Sessions have no chosen duration or question limit. Stop pauses a durable session;
Resume continues it. Skip advances without marking studied or recording recall.
The library can mark/unmark study status to correct mistakes; unmarking does not
delete recall history and prevents future recall until studied again.

## Initial scheduling decisions

Use FSRS-6 via pinned `ts-fsrs` 5.4.2, default weights, desired retention 0.90,
learning steps 1m/10m and relearning step 10m. Disable fuzz for reproducible
interval previews. Persist the full FSRS card, engine version, before/after
state, rating, actual timestamp, and the content hash actually presented.
First study does not call FSRS or count as a successful recall.

The first queue policy is an explicit implementation default: due recall items
and studied questions with no recall history form the recall queue; unseen
questions form the study queue. Alternate one recall with one study item while
both queues have items. Within recall, overdue (before today), due today, and
first recall are separate priority bands; within each band use file path then
source ordinal. This alphabetical cross-file ordering is a deterministic first
release default, not a claim about pedagogical importance. Importance weighting
and deadline-specific balancing remain later work.

Each queue captures immutable content versions and order. Reconciliation never
reshuffles it. Archived pending items are skipped. On exhaustion, Continue starts
a fresh snapshot using current content and due times, including earlier items
that have become due. It does not force early repetition or end the user's work.

Edits preserve study marks and FSRS history. The UI flags changed content; a
captured recall may finish on its old version. For study, marking an outdated
version is rejected so the user can study the current version. No automatic
reset or acceleration is introduced for edits; advanced changed-content policy
remains deferred. Concurrent sessions cannot grade the same scheduling state
twice: stale attempts are rejected, and exact request retries are idempotent.

## Persistence and access

The service remains the only SQLite writer. Study/recall mutations are atomic.
Progress updates notify browser clients; the Obsidian panel refreshes periodically.
The service is loopback-only. Writes require JSON and a Recall-specific header;
foreign browser origins and non-loopback Host values are rejected.

Export database downloads a consistent SQLite backup including study state,
versions, scheduling and events. Restore requires stopping the service, keeping
a copy of the existing database, replacing it with the exported database, and
removing stale -wal/-shm sidecars before restarting against the same vault.
Never restore over a running database or place the live database in a sync folder.

## Deferred

Target-date workload forecasting, per-project intents beyond ordinary recall,
RWKV, automatic parameter fitting, semantic importance, multi-device sync,
progressive hints, and Markdown editing from the website are not in this milestone.

References: [Anki ratings](https://docs.ankiweb.net/manual/studying#answer-buttons),
[FSRS configuration](https://docs.ankiweb.net/manual/deck-options#fsrs).
