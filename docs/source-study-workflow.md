# Source preparation and first study

Status: source preparation and first study are implemented. The Obsidian study
panel and local website both support explicit per-question study marks, stored
in SQLite and reflected in both interfaces. See [review-workflow.md](review-workflow.md)
for the governing implementation decisions and FSRS review behavior.

The user can prepare questions ahead of learning, then study in either interface.
Study status distinguishes unstudied material from material ready for recall.
The website includes initial-study items by default, with an option to disable
them. These items are not graded recall attempts.

## Workflow overview

1. Provide a source and choose the material to cover.
2. Generate ordinary Markdown notes containing titles, questions, suggested
   answers, and source references.
3. Place the notes in a Recall collection with machine identity supplied
   automatically.
4. Study the material and mark each covered question as studied.
5. Persist that status for each question so it remains available on return and
   is used by the review platform.

Question preparation can happen ahead of learning. Recall sessions use the stored study status to keep
initial-study items distinct from graded recall.

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
For this first version, ask the user whether the source already has generated
notes, including older versions, unless that information is already supplied.
The writer requires either a declaration of no prior output or confirmation
of a new independent copy. This is a user check, not automatic recognition of
URLs, renamed PDFs, or updated source versions. An existing destination folder
also blocks writing without copy confirmation. Confirmed copies use a new
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

New questions in this workflow begin as **Not studied**. Importing a question,
opening a note, or revealing an answer does not mark it studied.

| Study status | Meaning | Use by the review platform |
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
a graded attempt, or having a scheduler. It supplies a prerequisite
for recall selection. It does not decide when a question is due, how an
attempt is graded, or which eligible question appears next. The first implementation defaults
are defined in the
[review workflow](review-workflow.md).

## Agreed study interaction

The study interaction focuses one question at a time while retaining its topic
and section context. It must be available independently of graded recall; it is available in the Obsidian study panel and on the local website. After covering that
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
keeps its own keyboard behavior. The Obsidian panel provides question navigation and a correction action;
the website provides Skip and a library study toggle.

## Example with Spinning Up

For [Spinning Up's Key Concepts introduction](https://spinningup.openai.com/en/latest/spinningup/rl_intro.html),
the proposed output could be a topic note with sections such as States and
Observations, Policies, and Value Functions, each linked to its source section.
An example question is: “In reinforcement learning, how does an agent's
observation differ from the environment state?”

The user reads the relevant explanation, returns to the focused question, and
presses Enter. Its **✓ Studied** marker appears and focus advances. If the user
stops before covering value functions, the stored status distinguishes those
unstudied questions from the covered ones. The review platform uses
that information to distinguish initial study from recall. Even within one section, each question needs
its own explicit study action.

## State ownership

Markdown continues to own authored content: hierarchy, titles, questions,
answers, and source references. SQLite owns study progress alongside
review information, attached to each question's stable Recall UUID. Study
progress is stored independently of the rebuildable content index and
does not require review events to exist. This follows the existing
[architecture](architecture.md) and avoids introducing progress syntax into
otherwise portable notes.

Moving or renaming a question should retain its study progress through that
identity. Newly generated questions with new identities begin unstudied even
when inserted into a previously studied section. The initial implementation preserves study progress across edits;
advanced changed-content policies remain deferred.

## Delivery status and remaining decisions

Source preparation remains separate from study confirmation. Initial study in
either interface persists by UUID; moving a question retains progress, while
new UUIDs start unstudied. Existing imported questions start unstudied until the
user marks them. Study marks can be corrected without deleting review history.
The final question in an Obsidian study pass retains focus and its studied marker.
The website advances to its queue-complete screen when no items remain.

The initial milestone preserves progress and history across edits, shows changed
content, and rejects study marks against stale content. More advanced policies
for resetting or accelerating edited material remain deferred, as do automatic
source-copy recognition and deadline planning. See the review workflow for
backup/export and restore instructions.
