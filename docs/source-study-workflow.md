# Source preparation and first study

Status: first implementation of agent-driven source preparation, with an
initial pilot awaiting content review. Per-question first-study controls are
implemented in Obsidian under the decisions below. Review delivery is a later phase. The web inspector remains read-only.

The workflow should let someone provide a PDF or a learning website, receive
structured Recall notes, study them at their own pace, and store which questions
they have covered. The immediate goal is to preserve the information a future
review platform will need to distinguish questions ready for recall from
material the user has not studied yet. There is currently no interactive review
platform; storing study progress must be useful before one exists.

## Workflow overview

1. Provide a source and choose the material to cover.
2. Generate ordinary Markdown notes containing titles, questions, suggested
   answers, and source references.
3. Place the notes in a Recall collection with machine identity supplied
   automatically.
4. Study the material and mark each covered question as studied.
5. Persist that status for each question so it remains available on return and
   can later be used by a review platform.

Question preparation can happen ahead of learning. Practising questions and
selecting review sessions come later; that future platform should use the
stored study status to exclude unstudied questions.

## Preparing questions from a source

The preparation workflow accepts a PDF or a website and produces notes in the
existing [Markdown grammar](markdown-grammar.md). The repository-local
[source preparation skill](../automation/source-preparation/SKILL.md)
coordinates source reading, question generation, and a validated note writer.
The user provides the source and destination in conversation; the agent handles
the intermediate draft and writing without a manual pasted-list conversion.
This requires an agent with access to the source and local file tools; it is
not an unattended PDF or website generation service or a new Obsidian button.

The output should follow the source's learning sequence. Filenames supply
topics, folders supply broader context, and section titles group related
questions. Level-one and level-two headings separate question groups;
level-three and deeper headings remain inside answers, as the grammar specifies.
Each generated prose answer starts immediately after **A:** on the same line.
Block-first answers retain the line break required by their Markdown syntax.

Questions should cover meaningful concepts, explanations, and applications in
manageable pieces. Suggested answers should be grounded in the source and
remain editable as ordinary notes. Source links should point to the relevant
web section or identify the PDF and page, so the user can return to the original
explanation. Unclear extraction or missing source material needs to be surfaced
rather than filled with invented answers.

Local PDF references remain ordinary `file:` links with physical page numbers
in Markdown. In the browser inspector, these links open the original PDF
through the local service while retaining the page fragment. The service only
reads local PDF files linked from that indexed question's answer; it does not
accept arbitrary filesystem paths or copy the source into the collection.
Missing or unreadable sources return an unavailable-source response. HTTP(S)
source links continue to open directly.

A preparation run produces one or more Markdown notes for the agreed source
scope, with files, sections, and questions in source order. Books default to
one note per chapter and one per substantive appendix. Keep major sections
inside their chapter note so completion beside that filename represents the
whole chapter. Splitting chapters into section files is deferred until combined
chapter/folder progress is supported. Short single-page sources may still
produce one note. Use numbered filenames to preserve the reading sequence and
retain useful section headings within each note.

The user selects a parent folder within an existing Recall collection.
Generation creates one folder for the source beneath that parent and places
all the new notes inside it. Check coverage across the complete agreed scope,
including the boundaries between files. Validate the complete publication batch
before writing; a failed publication must be reported as incomplete.
Existing notes must not be overwritten or modified. Source-history and copy
confirmation apply to the complete source, not separately to every chapter.

When the user requests early access, publish a checked batch of whole chapters
and identify the release as partial. Continue that same preparation by adding
only absent note paths to its existing source folder. Validate each entire batch
before writing, refuse occupied paths or symlink traversal, and preserve every
published question and identity. This explicit continuation is not another
independent copy or automatic recognition of a source version. Check coverage
over the complete set before reporting the book finished.

If the source already has generated notes, generation must stop and ask the
user before creating another copy. It must not silently duplicate the output.
For this first version, ask the user whether the source already has generated
notes, including older versions, unless that information is already supplied.
For a new preparation, the writer requires either a declaration of no prior output or confirmation
of a new independent copy. This is a user check, not automatic recognition of
URLs, renamed PDFs, or updated source versions. An existing destination folder
also blocks a new preparation without copy confirmation. Confirmed copies use a new
numbered folder when necessary; existing folders remain unchanged.

Identity must be generated and checked automatically; users should not write
UUIDs or repeat folder structure as metadata. The writer generates fresh UUIDs
and validates the completed Markdown with the shared Recall parser before
publishing a new file. It rejects content that would split or swallow answers,
or introduce extra questions or orphan identities. Existing root discovery and
indexing can consume the resulting note without a converter.

Every newly generated question receives a fresh Recall UUID, including copies
generated from a previously processed source after user confirmation. Generated
copies do not inherit another question's study status or review history; they
begin unstudied. Existing questions, identities, and history remain unchanged.

## Required question content checks

Source preparation must follow the [question-writing guidance](question-writing.md),
including its standalone prompt rule and source coverage checks. These are
content requirements for the proposed generation workflow.

Every question must be understandable and answerable independently of nearby
questions and the source's layout. Its prompt must name the subject, setting,
and necessary assumptions without relying on a heading, filename, breadcrumb,
or wording such as “the above result.” Include the minimum context needed to
disambiguate the task without giving away its answer. Titles help organize the
material; they do not carry essential meaning omitted from a prompt.

Before accepting a generated set:

1. Identify the substantive ideas in each source section and check that the
   questions cover the agreed scope.
2. Check every question on its own for a specific learning target and enough
   context to interpret its terms and symbols.
3. Verify that its expected answer is supported by the source and preserves
   relevant qualifiers; surface ambiguity instead of inventing assumptions.
4. Remove redundant prompts and retain the source's learning progression,
   useful section titles, and references to the relevant explanations.

Use the deep-coverage default in the question-writing guidance; the user can
review and prune the result. For the initial Spinning Up pilot, validate a
small representative section before generating the full agreed scope. Routine
use does not require each user to approve a sample. A successful Markdown parse
establishes syntax validity; it does not establish question quality or source
coverage.

## Study information to store

All questions, including existing collections and questions with prior review
history, begin as **Not studied** unless explicitly marked through the study
control. There is no inference or backfill from creation, importing, reading,
answer reveal, or reviews.

| Study status | Meaning | Intended use by a future review platform |
|---|---|---|
| Not studied | The user has not confirmed covering this question's material | Exclude from recall |
| Studied | The user has explicitly confirmed covering this question's material | May be selected for recall |

At minimum, persistent study information must identify the question by its
stable Recall UUID and distinguish these two states. A mark must survive
closing and reopening the application and remain associated with the question
when it moves or its file is renamed. Rebuilding the Markdown content index
must preserve this progress, just as it preserves review history.

Studied records initial exposure, not mastery or a successful recall attempt.
A user may mark a question studied even when they expect to need substantial
practice. A studied question may also have no recall attempts yet, so study
status must remain distinct from review history.

Recording study status must not depend on creating a review session, recording
a graded attempt, or having a scheduler. Later, it will supply a prerequisite
for question selection. It does not decide when a question is due, how an
attempt is graded, or which eligible question appears next. Those policies
remain unresolved in the
[review workflow](review-workflow.md).

## Agreed study interaction

Each identified question has one small clickable text label in Obsidian Live
Preview and Reading view: **Not reviewed** in amber or **Reviewed** in green.
These are the user-facing names for the existing Not studied / Studied states;
they record covering the material, not a graded recall attempt. Changing the
wording does not migrate, reset, or infer progress. Text carries the status as
well as colour. There is no circular icon or separate Mark, Next, or Undo button.
Clicking the label toggles only that question in place. Tooltips and accessible
labels name the status and action. An edited studied question also displays
**Content changed**, retaining its stored mark.

In the editor, pressing plain **Enter** with a single empty selection anywhere
on the question's `**Q:**` line toggles that question. Marking it studied advances
the text cursor to the next question in this note, preserving the one-keypress
study pass; returning it to Not studied leaves the cursor on the question.
The final question retains the cursor. Clicking a label, or activating that
focused label with Enter/Space, toggles in place so it can be clicked again.

Ordinary Enter in answers and other note text, modified Enter, selections,
multiple cursors, and IME composition keep their editing behavior. Missing or
duplicated identities are never toggled. Holding Enter cannot mark a series of
questions through key repeat. Navigation uses normal cursor movement and
scrolling; it never changes intervening questions or crosses files. If the user
moves the cursor or edits the document during a save, completion must not move
it back or steal focus.

The local companion service must be running for this vault. Plugin settings
provide its loopback address. An unavailable or unsynchronized state uses an
neutral **Unavailable**, **Loading…**, or **Syncing…** label and a descriptive
tooltip, never a Not reviewed label for unknown state. Clicking retries
synchronization. Saving must succeed before the label changes
or the cursor advances. A content/version conflict requires synchronization and
retry; it never marks a different version. Reviewed/recall outcomes remain a
separate future concept; these labels toggle the existing study state only.

## Chapter and note completion

In Obsidian's file list and beside an open note's title, show a small progress
label for notes containing Recall questions. This is derived from the same
per-question study states used by the Reviewed / Not reviewed controls:

- While any question is Not studied, show the studied count and total, such as
  **12/20**. At zero, show **0/20**.
- A note with at least one question is **✓ Completed** only when every current
  question is Studied. Include the count in its tooltip and accessible label.
- Adding an unstudied question or marking one Not studied makes the note
  incomplete again. Removing or moving questions recalculates each affected
  note from its current questions; archived questions are excluded.
- Notes with no questions have no completion label. Invalid or unsynchronized
  notes must never appear completed from retained index data. Show **Syncing…**
  while their current content cannot be confirmed, **Loading…** before the first
  read, and **Unavailable** when the service cannot be reached.
- Edits retain study marks and therefore completion, consistent with the
  existing question behavior. Show **Content changed** beside the aggregate
  progress when any studied question differs from its studied version.

The labels update after confirmed study saves and refresh when notes change or
the service reconnects. They are informational: they do not mark questions,
write Markdown/frontmatter, rename files, or store a separate completion flag.
Completion means covering all the questions, not mastery or a graded review.
Each chapter file has its own label. Combined folder/chapter totals and
splitting chapters into section files are deferred together.

## Example with Spinning Up

For [Spinning Up's Key Concepts introduction](https://spinningup.openai.com/en/latest/spinningup/rl_intro.html),
the proposed output could be a topic note with sections such as States and
Observations, Policies, and Value Functions, each linked to its source section.
An example question is: “In reinforcement learning, how does an agent's
observation differ from the environment state?”

The user reads the relevant explanation, returns to the focused question, and
presses Enter. Its label becomes Reviewed and the text cursor advances. If the user
stops before covering value functions, the stored status distinguishes those
unstudied questions from the covered ones. A future review platform can use
that information to exclude them. Even within one section, each question needs
its own explicit study action.

## Study state ownership

Markdown continues to own authored content: hierarchy, titles, questions,
answers, and source references. SQLite owns study progress alongside
review information, attached to each question's stable Recall UUID. Study
progress is stored independently of the rebuildable content index and
does not require review events to exist. This follows the existing
[architecture](architecture.md) and avoids introducing progress syntax into
otherwise portable notes.

Moving or renaming a question should retain its study progress through that
identity. Newly generated questions with new identities begin unstudied even
when inserted into a previously studied section. Edits retain the studied mark
and display **Content changed** when the current prompt/answer hash differs from the version marked studied. This is informational;
no scheduling or eligibility policy is introduced. Toggling to Not studied and
then Studied records the current version. Reverting exactly to the studied version
clears the notice. Changes to source location or headings do not trigger it.

The service is the sole SQLite writer. The database is bound to its vault path;
the plugin verifies the connected vault before reading or writing progress.
Study writes check the question UUID, file, content hash, and previous study
state, reject archived or invalid questions, and never create review events.
Study state survives reconciliation, moves, archival, and service restarts.
A rebuild means reconciliation of Markdown into the existing database, not
deleting that database.

Progress is local to this computer. For backup, stop the service cleanly and
copy the database at the path printed on startup to a separate backup location;
restore it with the service stopped, then restart against the same vault.
Do not copy a live WAL database or put the active database in iCloud. Losing
the database loses progress; Markdown alone cannot restore it. Automatic backup,
portable vault relocation, export, and multi-device progress remain later work.

## Suggested delivery sequence

### First milestone: source preparation

The first deliverable is one preparation workflow from an agreed PDF or website
scope to Recall Markdown ready for a collection. It should remove the separate
step of generating a list and manually converting that list into questions.
The agent skill supplies the source-reading and question-generation procedure;
the writer supplies automatic identity, structural validation, and creation of
notes in one source folder. Source access uses the agent's available reading
tools. The writer validates every note before publishing the source's set;
one note per chapter and appendix is the default for books. Inaccessible or
unreliable extraction must be reported, not presented as completed coverage.
A bounded Spinning Up draft is included for the pilot.

Acceptance of this milestone would require:

1. An initial Spinning Up pilot sample whose coverage and depth the user
   validates before generation extends to the full agreed scope. This validates
   the workflow during development; it is not a mandatory step for every user.
2. Generated notes that satisfy the [required content checks](#required-question-content-checks)
   and existing Markdown grammar, including titles, answers, and source
   references, with identity generated and validated automatically.
3. Writing only beneath a user-selected folder in an existing Recall
   collection, with the source-history check, confirmation before copies,
   automatic fresh identities, and no changes to existing notes or history.

Preparation does not confirm that the user has studied the generated material.
It must remain usable before study tracking or a review platform is available.

### Subsequent milestones

2. Implement the recorded Obsidian interaction and durable
   per-question study state and the Enter/click interaction. This milestone
   stores what has been studied without requiring a review platform.
3. In a later review phase, consume the stored study status when selecting
   questions, while preserving the documented stable-session behavior.

First study extends the authoring and storage layers. The web inspector stays
read-only; grading, scheduling, and Markdown edits from the web interface remain
outside this milestone.

## Decisions still needed

- Whether future source preparation should recognize prior output
  automatically instead of relying on the first version's user check.
- Automatic backups, portable restoration to a relocated vault, and export
  of study progress alongside review history.

Scheduling, grading, cross-file review order, and progressive answer reveal
remain governed by their existing unresolved decisions.
