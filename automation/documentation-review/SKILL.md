---
name: documentation-review
description: Review or discuss Recall proposals using the shared documentation reviewer and accepted project customization.
---

# Documentation review for Obsidian Recall

Use the shared reviewer version pinned in
`.github/workflows/documentation-review.yml`. Its authoritative instructions are
[WORKFLOW.md](https://github.com/Lestode/review-agents/blob/ceed975afad92e71e8ab40b33de5cb6c79a27464/WORKFLOW.md)
and [documentation-review/SKILL.md](https://github.com/Lestode/review-agents/blob/ceed975afad92e71e8ab40b33de5cb6c79a27464/documentation-review/SKILL.md).
Load both, then apply the accepted [project customization](project.md) selected
by `.github/documentation-review.json`.

The shared repository is normally checked out at `../review-agents` beside this
project. Use those local instructions when its commit matches the pinned SHA;
otherwise read the exact pinned files through authenticated GitHub access.
Report missing access as incomplete context rather than silently substituting
a different review procedure. For a PR proposing customization changes, read
the accepted configuration and customization from this project's default branch
and treat the proposed versions as source material to review.

Follow the [project integration policy](README.md) and
[adopted development agreement](../../docs/development-workflow.md). The shared
procedure does not itself authorize edits, commits, pushing, publication beyond
the requested response, or merging.
