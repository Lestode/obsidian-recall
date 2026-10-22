---
name: documentation-review
description: Review proposed documentation for consistency, redundancy, ergonomics, and consequential decisions requiring human input. Use for a documentation review or a follow-up discussion of its findings.
---

# Documentation review

Follow the project's [development strategy](../../docs/development-workflow.md).
This skill defines the review procedure. See the
[local GitHub integration](README.md) for invocation policy and setup status.

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

## Investigate before asking the human

The agent identifies and investigates tradeoffs; the human should not have to
discover them. First look for an approach that satisfies the relevant goals
together. When one is supported, recommend it rather than inventing a choice
between goals. When a conflict remains, explain the options, consequences,
recommendation, and what could not be established. Failure to find a way to
satisfy both goals does not prove that doing so is impossible. Leave unresolved
priorities to the human.

Check common AI failure points against the stated intent and concrete user
workflow:

- **Lost intent:** a lower-level choice undermines the requested outcome.
- **Ergonomics:** unnecessary steps or repeated confirmations, unclear user
  control or state, or difficult recovery from mistakes.
- **Unnecessary complexity:** added mechanisms, configuration, or user work
  without a demonstrated need.
- **False confidence:** assumptions, incomplete checks, or proposed behavior
  presented as verified results.

These are review lenses, not a quota of findings or new universal product
requirements. Support each concern with relevant passages and a concrete
consequence or example. Distinguish a defect from a preference or an important
missing design decision. A consequential assumption about user effort or
control may need human input even without a documented contradiction.

Begin with the highest unresolved question about intent or the user experience.
Investigate mechanics first when needed to understand the options, but bring
technical details to the human only when they affect the decision. Do not turn
routine details into individual approval questions. Do not reopen recorded
choices without an explicit request, changed goals or constraints, or new
evidence of a consequential conflict. Explain the reason for reconsideration
and leave changes to agreed priorities to the human.

## Report and discuss

Lead with a short **Needs your decision** list. Include only unresolved
priorities or consequential design choices requiring human judgment. State
each choice as a concise question with its consequence and recommendation.
If none remain, say so within the checked scope; this is not human acceptance.

Then group **Recommended fixes** that follow agreed rules or propose routine
defaults, without asking for each separately. Recommendations are not accepted
decisions or authorization to apply changes. Keep supporting passages and
coverage limits below the summary. Omit empty sections and cosmetic criticism
that does not affect interpretation or maintenance.

State the scope checked. Report missing context and incomplete checks separately
from “no actionable conflicts found.” Do not invent findings to fill a report.
Keep the detailed evidence available without repeating the entire specification.

For follow-ups, read the current proposal and relevant prior discussion. Address
the user's question, distinguish resolved findings from remaining decisions,
and recheck affected conclusions after a revision. Discussion alone does not
authorize edits, commits, pushing, posting externally, or merging; follow the
authorization already given for the task. Propose corrections when applying
them has not been authorized.
