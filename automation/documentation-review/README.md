# Local documentation review through GitHub

Status: the private repository is published. Integration is being prepared on a
branch; runner registration and an end-to-end review remain to be verified.

GitHub holds the PR and its discussion. A self-hosted GitHub Actions runner on
the user's Mac runs Codex with ChatGPT subscription authentication, then returns
the review to the PR. The agent process is local; model inference uses OpenAI.
The [review skill](SKILL.md) defines what to check and how to report findings.

```mermaid
flowchart LR
    A[PR comment requesting review] --> B[GitHub Actions dispatch]
    B --> C[Local runner and Codex]
    C --> D[Response on the same PR]
    D --> A
```

## Using the loop

Comment `/review-docs` on an open PR to request a review. Include a question
after the command for a follow-up, such as `/review-docs explain the second
finding`. Each request reads the current proposal and prior discussion and
produces one response. Publishing changed files requires a commit and push;
discussion does not. The workflow does not run on every push.

The first loop reviews and proposes corrections. It does not edit files or
merge. Only repository collaborators with write access may invoke it. Keep the
repository private and the runner dedicated to this project.

## Execution and availability

The GitHub workflow lives in `.github/workflows/`; its review implementation
lives beside this file. Credentials stay on the local runner, outside the Git
repository. Subscription authentication and model use are distinct from GitHub
repository access. A future Claude adapter could use the same PR interface;
the first adapter uses Codex.

The runner must be online to accept work. Jobs wait when the Mac is asleep or
offline. Review scope and failures must be visible, rather than reported as a
successful clean review.

## Setup

1. Register a repository-level macOS self-hosted runner with the custom label
   `obsidian-recall`. Run it under the local account that holds Codex sign-in.
2. Make `codex` available to its service, or set `REVIEW_CODEX_BIN` in the runner
   environment. `REVIEW_CODEX_HOME` optionally selects a persistent auth home;
   otherwise the local account's `.codex` directory is used. Sign in with ChatGPT.
   The implementation requires the CLI's `--ignore-user-config` and
   `--ignore-rules` options; verify these when upgrading Codex.
3. Merge the approved workflow into the default branch. GitHub's `issue_comment`
   trigger reads that branch, so the setup PR alone does not activate it.
4. Request `/review-docs` on a PR and verify one response plus a completed Actions
   job. Reply with another command to continue the discussion.

The runner executes the accepted workflow, never code checked out from the PR.
Codex receives bounded Markdown snapshots, available diffs, and discussion as
input. It runs in a temporary directory with a read-only sandbox, tool access
disabled, and no inherited GitHub or API billing credentials. One registered
runner serializes jobs. A rerun of the same comment does not duplicate its reply.
Large or incomplete inputs produce an explicit incomplete result.

Official setup references:

- [OpenAI subscription authentication on self-hosted runners](https://learn.chatgpt.com/docs/auth/ci-cd-auth)
- [GitHub self-hosted runners](https://docs.github.com/en/actions/concepts/runners/self-hosted-runners)
- [Runner availability and queued jobs](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)
