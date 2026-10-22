---
name: source-preparation
description: Turn a supplied PDF or learning website into a new Recall note with source-grounded questions, answers, references, and automatic identity. Use when preparing study questions from a source, not for scheduling or recording study progress.
---

# Source preparation

Follow [the source workflow](../../docs/source-study-workflow.md) and
[question-writing guidance](../../docs/question-writing.md). Deliver an ordinary
Recall note, not a question list that the user must manually convert. The agent
handles reading, drafting, and the writer invocation within the user's request.

## Establish the source and destination

Use the supplied PDF or URL and the selected scope. If no narrower scope is
given, cover the whole PDF or single web page. A website index is not permission
to silently choose a subset or crawl an entire course: clarify the scope when
the intended set of pages is unclear. Obtain a destination parent inside an
existing Recall collection. Do not create a new collection without instruction.

Ask whether the source already has generated notes, including older versions,
unless the user has already answered. If it does, obtain confirmation before
creating an independent new copy. Bundle missing source, destination, scope,
and prior-output questions when possible. Do not make the user manage IDs,
JSON, commands, or intermediate conversion steps.

## Read and draft

Read the actual selected material with available website or PDF reading tools;
do not generate from the title, search snippets, or general subject knowledge.
Follow relevant links only within the selected scope. For PDFs, retain physical
page numbers and inspect diagrams, equations, and tables when text extraction
is insufficient. If reliable reading is unavailable, report the limitation and
ask for accessible material instead of claiming completion.

Outline substantive ideas in source order. Generate standalone prompts and
source-supported, editable answers using the canonical quality guidance.
Default to deep coverage, including relevant qualifications, derivations, and
code present in the source. Keep distinctions and explanations in manageable
questions; remove redundant prompts. Check each idea against the draft, noting
omissions or extraction gaps. Do not invent an answer where the source is unclear.

For the initial Spinning Up pilot, obtain content feedback on the representative
section before expanding it. That development pilot is not a mandatory approval
step for every later source or user.

## Write the note

Create an agent-owned temporary JSON draft using
[the pilot draft](examples/spinning-up.json) as the format example:

- `source`: `kind` (`website` or `pdf`), `title`, `location`, and `scope`.
  A website location is an HTTP(S) URL. A PDF location is an absolute local
  path or HTTP(S) URL. Do not copy or move the original PDF.
- `title`: the topic filename and level-one title. Sections contain `title` and
  a nonempty `questions` array in learning order.
- Each question has a single-line `prompt`, Markdown `answer`, and nonempty
  `references`. Website references have `url` and an optional `label`; PDF
  references have `page`, a one-based physical PDF page number.
- Do not supply IDs. Use level-three or deeper headings inside answers; close
  code fences. Math, lists, code, and paragraphs are preserved as Markdown.

Run from the repository root:

```bash
npm run prepare-source -- --draft /absolute/path/to/draft.json --parent "/vault/Recall parent" --prior-output none
```

`none` records the user's declaration of no prior output. Use
`confirmed-new-copy` only after confirmation for another copy; it permits a new
numbered source folder if the ordinary folder name is occupied. It never
overwrites an existing folder or reuses question identities. Do not retry with
copy confirmation merely to bypass a collision error.

`--draft /path/to/draft.json --preview` renders and validates without writing.
The helper validates the complete note with the shared Recall parser and
creates it inside a new source folder under the selected parent. Correct a
rejected draft before publishing. Structural validation does not establish
semantic fidelity, standalone meaning, or source coverage; those are the
agent's content checks above.

## Report the result

Return the new note path, question count, covered scope, and any actual content
limitations concisely. Provide a short coverage summary, with detailed mappings
available when useful. Report partial reading or failed writing explicitly;
an intermediate draft alone is not a completed note. No study status, review
events, scheduling policy, or existing history is written by this workflow.
