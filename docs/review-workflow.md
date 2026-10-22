# Review workflow

Review is expected to occur in a local web interface built on top of the Markdown collection and SQLite history.

At a high level:

1. The application selects a question according to a user-controlled review mode.
2. It presents the current question from Markdown.
3. The user attempts to reconstruct an approach or answer.
4. The interface may progressively reveal the answer or notes.
5. The application records a review event in SQLite.
6. The user retains meaningful control over when or how the question reappears.

## First study before recall

The source preparation and study-tracking milestone must persist whether each
question has been studied, before an interactive review platform exists. Enter
or the matching click action marks only the focused question studied, stores
that status, displays **✓ Studied**, and advances focus to the next question.
Initial study is distinct from a recall attempt and does not establish mastery
or determine scheduling.

The later review platform will use this information to exclude unstudied
questions. Delivering recall sessions is separate from recording study progress.

The high-level design, proposed source preparation workflow, and remaining
study decisions are in
[`source-study-workflow.md`](source-study-workflow.md). Study tracking is implemented in Obsidian independently of the read-only web
inspector. It does not change review-session selection or grading.

## Explicitly unresolved

The following must be discussed before implementation commits to them:

1. The review screen and progressive-reveal behavior.
2. The vocabulary used to evaluate an attempt.
3. Scheduling and question-selection behavior.
4. Handling of questions changed since their last review.
5. Whether the review application may edit Markdown or remains read-only.

