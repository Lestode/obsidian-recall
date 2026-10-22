# Question-writing guidance

## Purpose

Recall questions may be reviewed separately from the note in which they were
written. Each prompt should therefore contain enough semantic context for the
user to identify what knowledge it tests without first seeing the answer or
remembering the preceding question.

This guidance applies both to questions written by a person and to questions
generated automatically from notes.

## Classification comes from structure

A question does not need authored classification metadata. Its source already
provides a derived classification:

```text
collection / descendant folders / topic filename / section headings
```

For example, a question in
`Machine Learning/Supervised Learning/Nearest neighbours.md` belongs to the
`Machine Learning` collection, the `Supervised Learning` subject, and the
`Nearest neighbours` topic. Later indexing records that source context as the
collection path, file path, topic, and section path.

This context is useful for browsing, filtering, and presentation, but it is
supplemental. A prompt should not depend on a filename, heading, breadcrumb, or
adjacent question to supply its essential meaning. A review interface may show
source context, but that presentation remains a separate review-design
decision.

## Standalone prompt rule

Write the shortest prompt that remains unambiguous when read on its own. Name
the relevant method, object, or setting when a parameter or concept could
belong to several topics.

Prefer:

```markdown
**Q:** In k-nearest-neighbour regression, how do estimator bias and variance generally change as k increases?
```

over:

```markdown
**Q:** How do bias and variance change as k increases?
```

The shorter version is clear beside a `Nearest neighbours` heading, but is
under-specified when selected independently for review. The added phrase is
small and identifies the relationship being tested.

Likewise, prefer:

```markdown
**Q:** In k-nearest-neighbour regression with N training observations, what do the predictions become at k=1 and k=N?
```

over:

```markdown
**Q:** What happens when k=1 and k=N?
```

## Checks for written or generated questions

Before accepting a question, check that:

1. The prompt identifies the subject needed to interpret its terms and symbols.
2. It does not rely on phrases such as “this method,” “the above result,” or
   “what happens next?”
3. It tests a specific relationship, distinction, procedure, or explanation
   rather than asking for an unrestricted summary of a large topic.
4. Its expected answer can be judged from the authored answer and notes.
5. Necessary assumptions or qualifiers are present when omitting them would
   make more than one materially different answer correct.

Context should be repeated only where it disambiguates the prompt. There is no
need to copy the full folder hierarchy into every question or add tags that
duplicate it.

## Guidance for automatic generation

An automatic question writer should:

- derive candidate subject context from the topic filename and section path;
- incorporate the minimum necessary context into each prompt;
- treat every generated question as independently reviewable rather than as a
  turn in a conversation;
- preserve definitions and qualifiers from the source when they affect the
  answer; and
- emit the canonical Markdown syntax from
  [`markdown-grammar.md`](markdown-grammar.md) without adding classification
  fields to the authored question.

When the source does not contain enough information to make a prompt both
specific and answerable, generation should leave the ambiguity visible for the
author to resolve rather than inventing assumptions.

## Coverage and fidelity to the source

When generating questions from a PDF, website, or set of notes, start by
identifying what each section teaches: definitions, relationships, explanations,
equations, examples, and caveats. Use that outline to check coverage rather than
generating a generic question bank for the subject.

Before accepting a generated set, check that:

1. Each question is answerable from the selected source material and its
   expected answer preserves the source's definitions, assumptions, and
   qualifications.
2. Each substantive idea within the agreed scope has a corresponding question
   or an explicit reason for exclusion. Thorough coverage does not require one
   question per sentence.
3. Each question has a distinct learning purpose. Remove questions that merely
   rephrase the same target; retain complementary questions that test different
   aspects of an idea.
4. Questions follow the source's learning progression and are grouped under
   useful titles while still satisfying the standalone prompt rule.
5. Source references make the relevant explanation easy to find again, using
   web section links or PDF page references. A reference must not substitute
   for essential context in the prompt.

Within the selected source scope, default to deep coverage, including
derivations, code examples, and substantive details present in the source.
Users can review and delete unwanted questions afterward. This does not
justify redundant prompts or material unsupported by the source. For
mathematical material, distinguish explaining an equation from deriving it.

During initial workflow development, validate a small representative section
for prompt quality, source coverage, and depth before scaling up. This pilot
does not impose a sample-approval step on every user or every generation run.
The content checks above still apply to all output.
