# Obsidian Recall review instructions

Start at `docs/README.md`. Its document map identifies the governing and
dependent specifications for each area. `AGENTS.md` records product constraints,
implementation boundaries, and required verification. Use those accepted sources
as the authority; do not replace them with the proposal's preferred wording.

Apply the shared review method to Recall's concrete user workflow. Check that
changes preserve its documented approach to readable Markdown, inferred context,
automatic identity, and separation of authored material from review state.
Find the precise governing passages through the index rather than maintaining
another specification in these instructions.

Pay particular attention to unnecessary authoring steps, repeated metadata or
confirmations, hidden state changes, and recovery from mistakes. For review UI,
scheduling, grading, synchronization, and source preparation changes, read the
relevant documents before concluding that behavior is agreed or implemented.
Respect unresolved choices and the current implementation boundary in `AGENTS.md`.

For automation changes, consult `docs/development-workflow.md`,
`automation/README.md`, and `automation/documentation-review/README.md`.
Check that Recall uses its pinned shared reviewer with accepted project
customization and its declared invocation policy. Keep local execution and
subscription authentication explicit.

Lead with consequential unresolved human decisions and group fixes that follow
agreed rules. Support findings with passages and concrete consequences.
Distinguish an intentional proposed rule change, an implementation defect, an
unresolved product decision, and a reviewer preference. Discussion alone does
not authorize implementing, publishing, or merging a proposal.
