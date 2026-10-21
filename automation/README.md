# Project loops

Keep loop instructions, execution policy, and integration code here. The
[development strategy](../docs/development-workflow.md) defines the shared
purpose and division of responsibility.

Each loop must declare:

- Its review scope and authoritative instructions.
- Automatic events, eligible users, manual invocation, and events it skips.
- Input and runtime limits, and what happens when a check cannot finish.
- Where its result appears and how follow-up requests work.

Choose triggers separately for each loop. Adding an expensive reviewer does not
make it mandatory on every PR. Workflow configuration implements the declared
policy; it does not replace that policy with an implicit default.

Current loop: [documentation consistency and redundancy review](documentation-review/README.md).
