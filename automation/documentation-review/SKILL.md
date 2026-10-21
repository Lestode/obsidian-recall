---
name: documentation-review
description: Review proposed documentation changes for contradictions, missing requirements, ambiguity, and redundant authoritative definitions. Use for a documentation review or a follow-up discussion of its findings.
---

# Documentation review

Follow the project's [development strategy](../../docs/development-workflow.md).
This skill defines the review procedure; GitHub invocation is not yet configured.

## Establish the proposal and its context

Identify the requested outcome, proposed changes, and relevant discussion. For
a PR, inspect the current diff and read the relevant accepted requirements from
its base revision alongside the proposed versions. For local work, use the
available baseline or supplied proposal and state any comparison limits.

Start with the [documentation index](../../docs/README.md) and follow governing
and dependent documents relevant to the change. If the proposal changes a rule,
identify the intentional change and its consequences rather than assuming the
new wording already supersedes the accepted rule.

## Check consistency and redundancy

- **Consistency:** find contradictions, missing requirements, ambiguous behavior,
  or lower-level choices that fail a stated goal. Support each finding with
  specific passages and a concrete consequence or counterexample. Distinguish
  an actual conflict from an unresolved product choice or a reviewer preference.
- **Redundancy:** identify passages that independently define the same rule and
  would need to be maintained separately. Explain the overlap and recommend an
  authoritative location with references from other documents. Preserve useful
  summaries, reminders, and necessary local context; repetition alone is not a
  defect. Do not remove qualifications while proposing consolidation.

## Report and discuss

Return one concise summary, with consequential conflicts before maintenance
suggestions. For each actionable finding, identify the relevant rule and
passages, explain the effect, and propose a concrete resolution. Include
alternatives when the user's priorities determine the answer. Group related
findings and omit cosmetic criticism that does not affect interpretation or
maintenance.

State the scope checked. Report missing context and incomplete checks separately
from “no actionable conflicts found.” Do not invent findings to fill a report.
Keep the detailed evidence available without repeating the entire specification.

For follow-ups, read the current proposal and relevant prior discussion. Address
the user's question, distinguish resolved findings from remaining decisions,
and recheck affected conclusions after a revision. Discussion alone does not
authorize edits, commits, pushing, posting externally, or merging; follow the
authorization already given for the task. Propose corrections when applying
them has not been authorized.
