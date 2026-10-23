# Project loops

Keep project-specific loop policy and adapters here. The reusable documentation
reviewer and general working agreement live in the private `review-agents`
repository. The [development strategy](../docs/development-workflow.md) records
Recall's adoption, pinned version, and division of responsibility.

Each loop must declare:

- Its review scope and authoritative instructions.
- A visible agent name and purpose on every published response. Identify the
  engine and execution context; the posting account alone is not agent identity.
- Automatic events, eligible users, manual invocation, and events it skips.
- Input and runtime limits, and what happens when a check cannot finish.
- Where its result appears and how follow-up requests work.

Choose triggers separately for each loop. Adding an expensive reviewer does not
make it mandatory on every PR. Workflow configuration implements the declared
policy; it does not replace that policy with an implicit default.

Current loop: [documentation consistency and redundancy review](documentation-review/README.md).
