# Development from high level intent

Status: agreed working strategy. The shared documentation reviewer is active
through GitHub on the existing local Mac runner.

Obsidian Recall adopts the shared
[development strategy](https://github.com/Lestode/review-agents/blob/ceed975afad92e71e8ab40b33de5cb6c79a27464/WORKFLOW.md)
and [review procedure](https://github.com/Lestode/review-agents/blob/ceed975afad92e71e8ab40b33de5cb6c79a27464/documentation-review/SKILL.md)
from the version pinned in `.github/workflows/documentation-review.yml`.
Those documents define the general intent → proposal → consistency review →
human decision loop and the division of responsibility. Maintain shared methods
in `review-agents`; adopt updates explicitly through a pinned revision change.

This repository's [documentation index](README.md), `AGENTS.md`, and relevant
product documents remain authoritative for Recall behavior and implementation
boundaries. Record agreed behavior in the appropriate product document before
or alongside implementation. Do not silently settle unresolved product choices.

The reviewer is customized through
[project Markdown instructions](../automation/documentation-review/project.md),
selected by `.github/documentation-review.json`. Reference governing documents
there instead of maintaining another copy of their rules. The GitHub action
loads accepted instructions from an immutable default-branch checkout; proposed
instruction changes are reviewed using the currently accepted version.

Use a feature branch and pull request for a coherent change, and merge after
human acceptance. Once the user authorizes a scope, complete it without repeated
confirmation. Approval of documentation alone does not authorize implementation,
pushing, or merging. The reviewer reports and discusses findings; it does not
edit files or merge PRs.

See the [integration notes](../automation/documentation-review/README.md) for
invocation, runner settings, and activation. Execution stays on the existing
self-hosted Mac runner using local ChatGPT sign-in.
