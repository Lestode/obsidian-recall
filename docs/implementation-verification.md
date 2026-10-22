# Implementation verification

Verification date: 2026-10-22

This checklist records the implementation pass against the authoritative
Markdown specifications. It covers authoring, agent-driven source preparation,
and the read-only inspection phase; the decisions explicitly listed as unresolved in
`review-workflow.md` and `synchronization-and-storage.md` remain out of scope.

## Authoring and grammar

- `_recall.md` roots are discovered, with the nearest ancestor winning for
  nested roots.
- `/question` writes `**Q:**`, an immediately adjacent generated UUID comment,
  and a blank answer area. Its temporary empty prompt parses as the same
  identified draft and can be undone atomically.
- The real editor transaction filter permits ordinary prompt typing while
  rejecting line breaks within the prompt and joins across either protected
  boundary. It also checks the resulting document and rejects any edit that
  would orphan a previously attached identity unless the whole question is
  removed.
- Numbered imports support optional `A:` answers and place each answer after the
  protected identity and its separating blank line.
- The shared structural parser ignores fenced code, retains level-three and
  deeper answer headings, and ends answers at questions or ATX/Setext
  level-one/two headings.
- A detached identity is rejected rather than silently associated with a
  question.
- Missing, duplicate, and orphaned identities are reported without rewriting
  Markdown. An orphaned identity blocks reconciliation rather than being
  mistaken for intentional deletion. Editor tests cover the protected identity
  and both adjacent newline boundaries.

## Source preparation

- The agent skill routes PDF or website reading through available source
  tools, applies the canonical question-writing checks, and uses the local
  writer rather than asking the user to convert a list or manage UUIDs.
- The writer creates one note in a new source folder under an existing Recall
  collection. It requires the user's prior-output declaration or confirmation
  of another independent copy; automatic source/version matching is not claimed.
- Fresh identities are generated and completed prompts and answers round-trip
  through the shared parser. Boundary-changing headings, extra questions,
  orphan identities, and unclosed fences are rejected before vault writes.
- The note is published as a complete file without replacement. Tests cover
  confirmed-copy naming, concurrent creation, occupied symlinks, preserved
  existing notes, PDF page references, and indexing through the real scanner.
- A live reading of Spinning Up's States and Observations section produced the
  five-question pilot draft. The helper created its note in a temporary Recall
  collection, and all five questions indexed into SQLite without diagnostics.
  Pilot content acceptance remains with the user; this is not full-course
  coverage or a test of every PDF extraction tool.
- The source skill validator, TypeScript check, and full 86-test suite passed.
  An initial suite run encountered an existing synchronization timeout; that
  test passed separately and the full rerun passed. No synchronization code
  was changed.

## Synchronization and storage

- Startup full scans and approximately 250 ms incremental edit bursts reconcile
  transactionally.
- Invalid files are quarantined independently, and transiently missing files
  require a second observation after a one-second grace period before archival.
- Recall-root markers use the same absence grace, while duplicate collisions are
  rechecked globally when either participating path changes, is edited, or
  disappears. Existing database collection paths extend marker grace across
  process restarts.
- Add, edit, archive, reorder, move, and rename behavior is UUID-based; source
  context and ordinals are rebuildable.
- Content hashing is shared through `packages/core`; source position is excluded
  from the hash.
- Immutable question versions, current review state, append-only review event
  fields, and stable session snapshot tables are present.
- Session reads preserve captured order and content. Reconciliation skips an
  archived pending item without reshuffling the session.
- Validation and transaction failures preserve the previous readable revision.
- The service starts its loopback API before scanning, so a startup validation
  error is inspectable and recoverable through manual rescan.

## Inspector

- Collection, relative folder, topic, section, ordinal, and complete source path
  are visible.
- Prompts and answers render sanitized Markdown and math.
- New, reviewed, changed, due, and archived states are represented; archived
  questions can be toggled on.
- Missing/duplicate identity diagnostics include source paths and line numbers
  when available.
- Successful incremental events identify dirty files and patch only those files
  in the displayed question list. Full reloads remain available for full scans
  and explicit scope/filter changes.
- A manual vault-rescan control is exposed.

## Automated evidence

The suite covers parser boundaries and identity adjacency, editor boundary
protection through the real transaction filter, parseable empty templates,
safe question/import placement, imports with answers, nested roots,
fence-aware source context, full and incremental scans, cross-file moves and
renames, duplicate identities, file quarantine, transient absence, confirmed
file and marker deletion, duplicate resolution across separate saves,
transaction rollback, archival, status derivation, file-targeted
queries, debounced edit bursts, persistent startup diagnostics, and stable
session snapshots.

The expected verification commands are:

```bash
npm run typecheck
npm test
npm run build
```

## Deliberately unresolved

No implementation decision was added for grading vocabulary, scheduling or
importance bands, cross-file pedagogical order, changed-content review policy,
progressive answer reveal, write access from the review interface, or
multi-device review-history synchronization.
