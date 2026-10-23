# Documentation review for Obsidian Recall

The shared reviewer lives in the private
[review-agents repository](https://github.com/Lestode/review-agents), with a local
checkout at `../review-agents` beside this project. The GitHub workflow pins an
immutable shared revision. The implementation, model identity, general working
agreement, and review procedure are maintained there rather than copied here.

This migration takes effect after its workflow and configuration are accepted
on the default branch. The prior bundled reviewer successfully published
[automatic reviews](https://github.com/Lestode/obsidian-recall/pull/4#issuecomment-6337271832)
and [follow-ups](https://github.com/Lestode/obsidian-recall/pull/2#issuecomment-6337493469).
Publication through the extracted action must be verified after activation.

## Project customization

- [project.md](project.md) contains Recall-specific Markdown instructions.
- `.github/documentation-review.json` selects that file, `docs/README.md`, the
  command, and the existing response marker.
- `.github/workflows/documentation-review.yml` selects the accepted project
  revision, pinned shared action, existing runner label, triggers, and permissions.
- [SKILL.md](SKILL.md) points interactive reviewers to the same shared procedure.

Change generic reviewer behavior in `review-agents`. Change Recall-specific
review focus here. The action loads configuration and project Markdown from
an immutable default-branch checkout, even when a PR targets a different branch.
A proposed customization cannot replace the instructions governing its own
review. The PR's source material remains visible to the reviewer.

## Invocation policy

The [loop policy convention](../README.md) applies:

| Event | Behavior |
|---|---|
| PR opened by a human collaborator with write access | Review automatically |
| Reopened or ready for review | Review if that revision lacks an automatic response |
| New Conversation comment beginning `/review-docs` | Review or discuss the supplied follow-up |
| Command on a closed or merged PR | Explain how to continue on an open follow-up PR; do not run Codex |
| Push, edited comment, or inline-thread reply | No automatic run |
| Public repository, bot, or collaborator without write access | Skip |

Post `/review-docs explain the second finding` in the PR's **Conversation** tab
to continue. Each request reads the latest proposal and prior discussion.
Agreement in discussion does not apply edits. Reports identify the automated
agent, purpose, engine, model, and reasoning effort; shared identity preserves
GPT-6.1 Sol with high reasoning. Retaining `recall-documentation-review` as the
response marker recognizes earlier replies when requests are rerun.

## Execution and setup

The repository is private. The existing `obsidian-recall-mac` runner uses the
`obsidian-recall` label and local Codex ChatGPT sign-in. The agent
process runs locally; model inference uses OpenAI. The action's source is
downloaded from GitHub and runs on that same Mac using subscription authentication.

Allow the private `review-agents` repository to share its action with private
repositories owned by `Lestode`. No additional repository credential is stored
here. The job token keeps content-read and PR-write access and is not passed to
Codex. No proposed PR code is executed. Runtime bounds, context collection,
tool restrictions, credential isolation, summary fallback, and failure reporting
are defined in the pinned
[shared integration guide](https://github.com/Lestode/review-agents/blob/ceed975afad92e71e8ab40b33de5cb6c79a27464/README.md).
The accepted collector's 512,000-byte complete-prompt budget and compressed
snapshot/diff input are preserved.

The runner must be online. Merge this migration through normal acceptance,
then open or reopen a PR and verify a review plus a successful Actions job.
Continue with `/review-docs`. Until activation, existing PRs use the bundled
default-branch reviewer. Failed publication retains the report in the Actions
job summary when available.

For upgrades, test shared changes in `review-agents`, update the action SHA and
the pinned links in this directory and `docs/development-workflow.md` together,
and review the consumer change. Local uncommitted agent edits do not affect
GitHub runs. Run this project's required `npm test` and `npm run build` as well
as the shared repository's checks.
