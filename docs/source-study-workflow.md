# Source preparation and first study

Status: high-level design for source preparation and study tracking. The
individual study interaction and the need to persist study status are agreed;
source preparation and storage details below are proposals. Review delivery is
a later phase. The current read-only implementation remains unchanged.

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

The proposed preparation workflow accepts a PDF or a website and produces notes
in the existing [Markdown grammar](markdown-grammar.md). A reusable agent skill
could coordinate source reading, question generation, and validation without
requiring a separate manual conversion of a pasted list.

The output should follow the source's learning sequence. Filenames supply
topics, folders supply broader context, and section titles group related
questions. Level-one and level-two headings separate question groups;
level-three and deeper headings remain inside answers, as the grammar specifies.

Questions should cover meaningful concepts, explanations, and applications in
manageable pieces. Suggested answers should be grounded in the source and
remain editable as ordinary notes. Source links should point to the relevant
web section or identify the PDF and page, so the user can return to the original
explanation. Unclear extraction or missing source material needs to be surfaced
rather than filled with invented answers.

For the first milestone, each preparation run produces one Markdown note for
the agreed source scope, with sections and questions in source order. Splitting
the output across multiple topic files is deferred. The user selects a parent
folder within an existing Recall collection. Generation creates a folder for
the source beneath that parent and places the new note inside it. Existing
notes must not be overwritten or modified.

If the source already has generated notes, generation must stop and ask the
user before creating another copy. It must not silently duplicate the output.
How prior output is recognized remains to be designed.

Identity must be generated and checked automatically; users should not write
UUIDs or repeat folder structure as metadata. The exact integration between the
skill and Recall tooling remains to be designed.

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

New questions in this workflow begin as **Not studied**. Importing a question,
opening a note, or revealing an answer does not mark it studied.

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

The study interaction focuses one question at a time while retaining its topic
and section context. It must be available independently of the future review
platform; its exact interface location remains open. After covering that
question's material, the user presses
**Enter** or clicks the corresponding study control. The interaction:

1. Marks only the focused question as studied and persists that status.
2. Shows a persistent **✓ Studied** marker beside that question.
3. Moves focus to the next question.

This makes a study pass possible with one deliberate keypress per question.
There is no requirement to select a range or mark an entire section. Marking
one question never silently activates earlier questions.

The marker remains visible on return so the user can distinguish covered and
upcoming material. Enter applies to the study control; ordinary note editing
keeps its own keyboard behavior. Navigation, correction of accidental marks,
and the precise layout still need interaction design.

## Example with Spinning Up

For [Spinning Up's Key Concepts introduction](https://spinningup.openai.com/en/latest/spinningup/rl_intro.html),
the proposed output could be a topic note with sections such as States and
Observations, Policies, and Value Functions, each linked to its source section.
An example question is: “In reinforcement learning, how does an agent's
observation differ from the environment state?”

The user reads the relevant explanation, returns to the focused question, and
presses Enter. Its **✓ Studied** marker appears and focus advances. If the user
stops before covering value functions, the stored status distinguishes those
unstudied questions from the covered ones. A future review platform can use
that information to exclude them. Even within one section, each question needs
its own explicit study action.

## Proposed state ownership

Markdown continues to own authored content: hierarchy, titles, questions,
answers, and source references. SQLite would own study progress alongside
review information, attached to each question's stable Recall UUID. Study
progress would be stored independently of the rebuildable content index and
would not require review events to exist. This follows the existing
[architecture](architecture.md) and avoids introducing progress syntax into
otherwise portable notes.

Moving or renaming a question should retain its study progress through that
identity. Newly generated questions with new identities begin unstudied even
when inserted into a previously studied section. How edits to existing content
affect eligibility remains an explicit decision alongside the existing changed
content policy.

## Suggested delivery sequence

### First milestone proposed for review: source preparation

The first deliverable is one preparation workflow from an agreed PDF or website
scope to Recall Markdown ready for a collection. It should remove the separate
step of generating a list and manually converting that list into questions.
This is a feature proposal; no source reader, generation skill, or export
integration has been implemented or selected yet.

Acceptance of this milestone would require:

1. An initial Spinning Up pilot sample whose coverage and depth the user
   validates before generation extends to the full agreed scope. This validates
   the workflow during development; it is not a mandatory step for every user.
2. Generated notes that satisfy the [required content checks](#required-question-content-checks)
   and existing Markdown grammar, including titles, answers, and source
   references, with identity generated and validated automatically.
3. Explicit human decisions on remaining identity integration and recognition
   of prior output before implementation commits to them. The one-note,
   source-folder destination, new-note-only rule, fresh identities, and
   confirmation before duplicate generation above are agreed; preparing a
   sample does not authorize overwriting an existing collection.

Preparation does not confirm that the user has studied the generated material.
It must remain usable before study tracking or a review platform is available.

### Subsequent milestones

2. Agree the remaining persistence and interface decisions, then add durable
   per-question study state and the Enter/click interaction. This milestone
   stores what has been studied without requiring a review platform.
3. In a later review phase, consume the stored study status when selecting
   questions, while preserving the documented stable-session behavior.

This sequence fits a future phase. It does not expand the current inspection
slice into grading, scheduling, or Markdown edits from the web interface.

## Decisions still needed

- Where the study interaction lives before a review platform exists and how
  source reading and answers appear alongside the focused question.
- How users skip, revisit, and undo an accidental study mark, including focus
  behavior on an already studied question or the final question in a topic.
- How to initialize study status for existing collections and questions with
  prior review history.
- Whether and how users can return studied questions to the unstudied state.
  Effects on active review sessions belong to the later review phase.
- How content changes affect study status without discarding history.
- The source preparation skill's scope controls, identity integration, and
  recognition of prior output for the agreed duplicate-generation guard,
  including destination-name collisions.
- Persistence details, including backup and restoration of study progress
  alongside review history.

Scheduling, grading, cross-file review order, and progressive answer reveal
remain governed by their existing unresolved decisions.
