# Implementation verification

Verification date: 2026-10-22

This checklist records the implementation pass against the authoritative
Markdown specifications. It covers authoring, agent-driven source preparation,
the read-only inspection phase, and per-question study in Obsidian. The decisions
explicitly listed as unresolved in
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
- New templates, imports, and source notes put prose immediately after the
  visible `**A:**` label on the same line. Block-first lists, code, equations,
  headings, and tables retain the line breaks required by Markdown. The shared
  formatter is checked against rendered block types and parsed answer content.
  The parser removes only the leading presentation label from indexed answer
  content; inline labels, standalone labels, empty templates, rich Markdown,
  and unchanged content hashes are covered by tests. Legacy unlabelled answers
  remain supported. The inspector displays one **A:** beside the first line of
  expanded answers, with the first content block's top margin removed.
- The existing generated Spinning Up note was backed up and reformatted in
  place. All 179 questions present before that formatting retained the same
  UUIDs, prompts, parsed answers, content hashes, and progress records. The older
  independent note was untouched. A headless Chrome check of the real inspector
  verified the A: label and first answer text share a baseline at desktop and
  phone widths.
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
- The writer creates one or more notes in a new source folder under an existing Recall
  collection. A new preparation requires the user's prior-output declaration or confirmation
  of another independent copy; automatic source/version matching is not claimed.
- Fresh identities are generated and completed prompts and answers round-trip
  through the shared parser. Boundary-changing headings, extra questions,
  orphan identities, and unclosed fences are rejected before vault writes.
- Every note is published as a complete file without replacement. Tests cover
  confirmed-copy naming, concurrent creation, occupied symlinks, preserved
  existing notes, PDF page references, and indexing through the real scanner.
- A live reading of Spinning Up's States and Observations section produced the
  five-question pilot draft. The helper created its note in a temporary Recall
  collection, and all five questions indexed into SQLite without diagnostics.
  Pilot content acceptance remains with the user; this is not full-course
  coverage or a test of every PDF extraction tool.
- A source-reference follow-up found that the inspector's sanitizer removed
  local `file:` link destinations. Local PDF references now use a read-only
  service route after checking real Markdown links in the indexed answer and
  the source's PDF header. Requests for unlinked files, code examples, non-PDF
  content, remote file hosts, missing files, or unknown questions return 404.
- A headless Chrome check generated a three-page PDF fixture and both source
  notes in a temporary collection, started the real synchronizer and service,
  and verified all six questions in the rendered inspector. Clicking the PDF
  reference returned the unchanged original PDF with `#page=3` retained in the
  browser URL. Website section links, math, lists, and script sanitization also
  passed. This does not independently verify Obsidian's external-file handling
  or every PDF viewer's page positioning.
- The source skill validator, TypeScript check, full 94-test suite, and build
  passed. No synchronization code was changed.

### Pilot coverage evidence

The [five-question pilot](../automation/source-preparation/examples/spinning-up.json)
was checked against the live [States and Observations section](https://spinningup.openai.com/en/latest/spinningup/rl_intro.html#states-and-observations)
on 2026-10-22. The section's substantive ideas map to the draft as follows:

| Source idea | Pilot question | Fidelity check |
|---|---|---|
| Complete state versus potentially incomplete observation | 1 | Preserves the information distinction |
| Numerical representations in deep RL | 2 | Includes vectors, matrices, and higher-order tensors |
| Visual and robot examples | 3 | Retains RGB pixels and joint position/velocity examples |
| Full and partial observability | 4 | Distinguishes complete from partial information |
| State notation used when only observations are available | 5 | Preserves the notation caveat and actual conditioning |

No substantive idea in this bounded section was deliberately omitted. It has
no derivation or code example to cover. This is evidence for inspecting the
pilot, not human content acceptance or coverage of the full introduction.

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

## First study in Obsidian

Chapter preparation and completion extension (October 2026):

- Multi-note preparation validates the whole publication batch before writing,
  numbers chapter filenames, supports appendix subfolders, and retains
  the original single-note format. Tests cover scanner round-trips, fresh IDs
  across confirmed source copies, late invalid chapters, path/case/Unicode
  collisions, filesystem publication failure cleanup, and CLI previews.
- Explicit staged continuation adds only absent paths to the selected source
  folder. Tests cover preserved published bytes and identities, late occupied
  paths, case variants, symlink refusal, cleanup that retains existing files and
  directories, and the separate CLI destination mode.
- Note progress appears in Obsidian's file list and open-note header. It uses
  confirmed per-question marks, with empty notes hidden and changed-content
  notices retained. Whole-note disk/index checks prevent invalid or stale
  snapshots from appearing complete.
- An isolated Obsidian 1.14.4 profile verified zero/partial/full progress in both
  locations, undo, new questions, changed content, renaming, empty notes,
  offline/reconnection, app reload, one label per location, unchanged editable
  title text, no Markdown changes from study, and no renderer errors.
- The full 121-test suite, production build, and TypeScript check passed.
  These checks do not establish semantic coverage of any generated book notes.

- Existing and generated questions all start Not studied, even with review
  history. Only an explicit per-question action writes study state.
- Live Preview and Reading view display one small clickable text label per
  question: amber Not reviewed or green Reviewed, mapping to the existing
  Not studied / Studied data. Text and accessible names communicate the status
  alongside colour. Clicking toggles in place. Plain Enter with the text cursor on the question line toggles study
  state; marking Studied advances the text cursor within the note, while
  marking Not studied stays on the question. No Mark/Next/Undo buttons remain.
- Cursor targeting tests cover any position on a question line, answer and
  surrounding lines, selected text, multiple cursors, read-only editors,
  missing/duplicate identity, fenced examples, modifiers, and IME composition.
- The sole SQLite writer is the loopback service. Its study API verifies the
  vault path, question UUID, file, current disk/index content, and previous study
  revision. Browser form requests, other vaults, stale versions, invalid or
  archived questions, and conflicting writes cannot change progress.
- Study state survives file moves, reordering, reconciliation, archive/restore,
  service restart, and app reload. Edits preserve the studied timestamp/hash and
  show Content changed; reverting to the studied version clears that notice.
  Review events and session snapshots are unaffected.
- Controls share confirmed state, avoid optimistic success, and show Study
  unavailable when disconnected. A delayed read cannot erase a confirmed mark.
- Actual Obsidian v1.14.4 in an isolated profile/vault verified coloured text-label toggles,
  native button Enter, both directions of the question-line Enter shortcut,
  text-cursor advance only when marking Studied (including an off-screen
  question in a long note), no Markdown changes from study actions, ignored repeated Enter, normal answer newline insertion, changed
  notices, Reading view toggles, and persistence after reloading the app.
  Prior verification in v1.10.3 covered the underlying study service and long
  notes. The identity-line CSS overrides Obsidian's line display rule, keeping
  machine comments hidden in the editor. The label check verified visible text
  and different computed colours for Reviewed and Not reviewed.
- An offline/restart check in Obsidian verified Study unavailable, retry without
  marking or advancing, and recovery of the previously confirmed state.
- The installed private-vault build and connected service were checked without
  marking private content: all 180 questions in the generated Spinning Up note
  remained Not studied, and both that note and the older independent note
  retained their pre-installation hashes. Previous plugin artifacts/settings
  were backed up before installation. Activating the updated plugin requires
  reloading it in the already open private vault.
- The full 106-test suite, TypeScript check, and production build pass. A
  watcher deletion test timed out during concurrent build/UI checks and passed
  when the complete suite was rerun alone; no watcher behavior was changed. These
  checks do not claim grading, scheduling, multi-device progress, or automatic
  backups. The documented offline backup procedure remains manual.

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
