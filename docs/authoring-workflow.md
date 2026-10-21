# Authoring workflow

## Knowledge structure

An active-recall collection is an ordinary folder containing a marker file named `_recall.md`.

```text
Quant Research/
├── _recall.md
├── Regression/
│   └── Linear Regression.md
└── Probability/
    └── Conditional Probability.md
```

The structure means:

| Structure | Meaning |
|---|---|
| Folder containing `_recall.md` | Active-recall root or collection |
| Active-recall root folder name | Collection name |
| Descendant folders | Broader subject hierarchy |
| Markdown filename | Topic |
| Marked question inside the file | Recall item |
| Content associated with the question | Evolving answer and notes |

The marker travels with the folder, so the collection does not depend on an external path registry. It may later become a dashboard, but its presence alone marks the folder.

Files do not require frontmatter such as `question: true`, `topics`, or `question_type`. Those facts are inferred from structure or are not currently required.

## Workflow

### 1. Enable a folder

The user invokes `/enable-recall-folder` while working in a folder. The extension creates `_recall.md` there.

The marker file—not an extension setting—is the durable declaration that the folder participates in active recall.

### 2. Create topic files

The user creates and names Markdown files normally. The filename supplies the topic, while parent folders supply broader context.

### 3. Write ordinary notes

Topic files may contain any normal Markdown reference material. A file inside an active-recall root is not required to contain questions.

### 4. Insert a question

The user invokes `/question`. The extension inserts the canonical question structure, assigns stable machine identity, and places the cursor where the question should be written.

The slash command is a convenience. The resulting Markdown remains understandable without the extension.

### 5. Develop the answer freely

The user writes the answer as ordinary Markdown immediately below the generated
identity marker. In the editor the marker is represented by a locked `Recall`
indicator, so the answer is simply written on the next visible line. The answer
continues until the next recall question, level-one heading, level-two heading,
or end of file. Questions and answers are expected to evolve as understanding
improves.

### Import a numbered question list

The user may paste and select a numbered Markdown list, then run **Convert
numbered selection to recall questions**. The extension converts each numbered
item to the canonical question form and generates its identity. An answer that
begins with `A:` or `**A:**` is placed below the identity; without either marker,
the answer is left blank. Continuation lines after an answer marker remain part
of that answer. Markdown headings in the selection are normalized to level two so
they remain answer boundaries. A plain title before the first numbered item is
also treated as a level-two heading. The conversion is one editor operation and
can be undone normally.

The converter also removes copy/paste spacing entities, unescapes Markdown
underscores, normalizes `\(...\)` and `\[...\]` math delimiters to dollar
delimiters, and collapses wrapped question or answer lines into a single
Markdown paragraph. Structured multi-paragraph answers should therefore be
edited after import rather than expected to retain their pasted line wrapping.

### Future source preparation

For the future PDF or website preparation workflow, see
[`source-study-workflow.md`](source-study-workflow.md). It aims to produce
structured Recall notes directly, without a manual numbered-list conversion.
The numbered importer above remains the current implementation.

## Agreed extension actions

- `/enable-recall-folder` creates `_recall.md` in the current folder.
- `/question` inserts a canonical question and assigns identity automatically.

If the cursor is on the blank line immediately below existing prose, question
insertion preserves that blank paragraph boundary. If the cursor is inside a
non-empty line, the question is inserted as a new block after that line rather
than spliced into its text. Numbered import follows the same boundary rule.

Equivalent command-palette actions and keyboard shortcuts may coexist with the slash interface.

## Nested recall roots

Nested `_recall.md` roots are allowed. A file belongs to its nearest ancestor
root, so a nested collection takes precedence over a broader collection.
