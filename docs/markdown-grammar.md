# Markdown grammar

## Question marker

A recall question is an ordinary Markdown paragraph beginning with the exact emphasized marker `**Q:**`.

```markdown
**Q:** Why can multicollinearity destabilize coefficients without harming prediction?
<!-- recall:id=123e4567-e89b-42d3-a456-426614174000 -->

The answer and evolving notes go here.

### Geometric interpretation

Supporting structure remains normal Markdown.
```

This renders at normal text size and does not incorrectly make every question a major document section.
The identity comment is placed on the immediately following line. The blank line
after it marks the beginning of the answer; there is no authoring space between
the question and its identity.

Immediately after `/question` inserts a template, the prompt may temporarily be
empty while the cursor is positioned after `**Q:**`. This empty draft is still
structurally parseable and owns its generated identity; typing the prompt fills
the same question rather than creating a second state.

## Answer boundary

An answer begins after the question marker and generated identity comment. It ends immediately before:

- the next recall question;
- the next level-one heading;
- the next level-two heading; or
- the end of the file.

Level-three and deeper headings remain part of the answer.

## Identity

Every question has a stable UUID represented by an adjacent hidden HTML comment:

```html
<!-- recall:id=<UUID> -->
```

The extension inserts and manages this comment. The user never assigns or memorizes it.

In Obsidian's editor, the extension hides the comment line and displays a small
locked `Recall` indicator beside its question. The identity is an atomic,
protected editor range: ordinary cursor movement and edits cannot enter or
partially overwrite it. The newlines immediately before and after the identity
are protected as part of the same boundary, so Enter, Backspace, or Delete
cannot detach the identity or join it to visible content. Selecting and deleting
the entire question remains possible, including undoing a newly inserted empty
template. The underlying Markdown remains present on disk and portable to other
Markdown tools.

The prompt itself remains a single Markdown line. Enter or a multi-line paste
anywhere inside that line, and Backspace that would join it to the preceding
line, are rejected; ordinary prompt typing and replacement remain available.
More generally, an edit that would turn any attached identity into an orphan is
rejected unless that edit removes the whole question and its identity together.
This includes damaging the marker or consuming the blank paragraph boundary
above a question.

Only a structurally attached identity is hidden and protected. An orphaned
identity or an identity example inside fenced code remains visible and editable
so it can be repaired or removed.

Stable identity lets review history survive:

- edits to the question wording;
- edits to the answer;
- reordering within a file;
- movement to another topic file; and
- renaming or movement of the containing file.

If a question is duplicated, the extension detects the duplicate identity. Automatic reassignment behavior is not part of the current MVP. If a question is deleted, later storage layers should archive its history rather than erase it immediately.

## Structural parsing

The extension parses Markdown structure rather than searching unqualified raw text. In particular:

- question-like text inside fenced code blocks is ignored;
- YAML front matter is not treated as question or heading content;
- a question marker must occupy its own paragraph;
- both ATX and Setext level-one and level-two headings terminate answers;
- ordinary Markdown inside an answer is preserved.
