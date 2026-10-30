# Review workflow

Status: first writable study and FSRS review milestone, authorized after the
[review intent discussion](review-intent-draft.md). Target-date planning is included; RWKV remains deferred. This document governs the implementation defaults below.

## Study and recall

Obsidian owns authored Markdown. SQLite owns study status and recall history.
First study is available through Obsidian inline study controls and on the local website.
Only an explicit Enter/click action marks the focused question studied, displays
the updated study label, and advances focus when marking studied. Opening or revealing content does not count.
The two interfaces read the same database through the local service. No progress
syntax is written to Markdown. Study status survives moves, reindexing, and restart.
Existing questions without study records start unstudied; legacy review history
is preserved, but does not silently manufacture a study mark.

The website uses a compact application layout: system fonts, a simple project/folder
list with aligned counts and a Review action, and an undecorated question screen.
It shows collections and folders with counts of unseen, ready for a
first recall, and due questions. Unseen material is included by default and can
be disabled. A study item shows its answer immediately. A recall item hides the
answer until Reveal, then offers the following assessments:

| Rating | Meaning |
|---|---|
| Again | Essential answer missing, a crucial error, or help was needed. |
| Hard | Essentials reconstructed independently, with substantial effort or doubt. |
| Good | Essentials reconstructed independently with reasonable effort. Minor omissions are fine. |
| Easy | Essentials reconstructed fluently with little effort. |

Sessions have no chosen duration or question limit. Each folder has one Review
action that creates a fresh queue from current study status and FSRS due dates.
Returning to Projects or reloading leaves the queue; there is no unfinished-session
list to manage. Saved attempts remain authoritative, so returning excludes
completed recall until due again and retains completed study. Unanswered and
skipped questions remain eligible. During active practice, immutable snapshots
still keep the question order and presented content stable.
Skip advances without marking studied or recording recall.
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
remains later work; target-date balancing is described below.

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

The service remains the only SQLite writer. Study/recall mutations are atomic. Both interfaces use `study_state`, including
revision checks to reject stale study writes. Website study confirmation checks
the current note on disk using the same safeguards as the plugin.
Practice loads independently of the Library; full question rendering waits until
the Library is opened. Dashboard counts use a single metadata query. Each visible
browser tab shares one update connection between Practice and Library and closes
it while hidden. Reloading the page does not request a vault scan.
Progress updates notify browser clients; Obsidian inline controls refresh periodically.
The service is loopback-only. Writes require JSON and a Recall-specific header;
foreign browser origins and non-loopback Host values are rejected.

Export database downloads a consistent SQLite backup including study state,
versions, scheduling and events. Restore requires stopping the service, keeping
a copy of the existing database, replacing it with the exported database, and
removing stale -wal/-shm sidecars before restarting against the same vault.
Never restore over a running database or place the live database in a sync folder.

## Deferred

Per-project intents beyond ordinary recall and target-date planning,
RWKV, automatic parameter fitting, semantic importance, multi-device sync,
progressive hints, and Markdown editing from the website are not in this milestone.

References: [Anki ratings](https://docs.ankiweb.net/manual/studying#answer-buttons),
[FSRS configuration](https://docs.ankiweb.net/manual/deck-options#fsrs).

## Target-date planning

Target-date planning is now authorized. Each collection/folder can save an optional
calendar date and a recall-probability threshold (default 90%, adjustable 80–97%).
The criterion is at least one Good/Easy on the current content after any later
Again, plus FSRS-predicted successful recall at the target date above the threshold.
This is not a probability of a Good rating or a guarantee of mastery.

Preview before saving shows introductions and review attempts per day, including
repeat attempts, with two illustrative scenarios: future Good answers and a
setback scenario using recent Again frequency (smoothed with a 20% prior). This
range is not a statistical confidence interval. Neither forecast writes attempts.
No minutes are invented: time estimates wait for reliable duration measurements.
All active questions in the selected scope count equally, including unseen ones.

The recommended introduction rate covers remaining unseen material while reserving
roughly the final 20% of days (at least one, at most seven) for recall. An optional
daily override is allowed; insufficient coverage and very short deadlines are
shown explicitly. The first recall of newly studied material is planned no earlier
than the following calendar day. Planning uses the service's local calendar days,
ends at the end of the selected day, and supports today through one year ahead.

Saving a plan affects Review for that scope and descendant folders in the same
collection; the most specific covering plan wins. Selecting a parent scope uses
that parent's plan, not a mixture of descendant plans. Review alternates due or
at-risk recall with today's remaining study allowance. It includes early review
when predicted recall falls below the plan threshold, and a final-day check for
missing Good/Easy evidence or insufficient deadline retention. It never changes
FSRS history just to satisfy the deadline. Repeated clicks do not replenish study
allowance; study on either interface counts. Turning unseen inclusion off still
works but leaves coverage work outstanding. The allowance is guidance, not a
session duration; all due review remains available.

Date/rate/threshold edits recalculate from current state without resetting history.
Removing a plan returns the scope to ordinary FSRS. Past plans are shown as expired
and do not constrain ordinary practice. Existing active queues keep their snapshot;
start Review again to apply a changed plan. Old-content Good evidence does not
certify revised content. Forecasts show how many questions still miss the criterion
in each scenario rather than promising success.
