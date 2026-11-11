# Recall intent — draft for validation

- **Obsidian is the authoring home:** I write questions there and can study their material for the first time and mark them ready for recall there.
- **The local website is primarily for recall, with optional initial study:** I practise remembering eligible questions in a system similar in spirit to Anki but tailored to me. When I include unseen questions, I can also study them for the first time on the website.
- **The protocol manages repetition:** It uses my recall attempts to decide which eligible questions to show next and when they should reappear.
- **The database is the source of truth for study and review status:** Both interfaces should use the same stored progress. Markdown remains the source of truth for question and answer content.
- **Studying on either interface updates both:** When I explicitly mark a question studied on the website, that status should be saved in the database and reflected in Obsidian, without having to mark it again. A study mark made in Obsidian should likewise be reflected on the website. Initial study remains distinct from a successful recall attempt.
- **I choose the intent for each project or folder:** The selection and scheduling algorithm should adapt to that objective. The available intents and what “optimised” means for each remain to be defined.
- **Sessions are open-ended:** I keep working until I choose to stop; I do not need to set a duration or question count beforehand.
- **Show me where review is needed:** The website should show the projects or folders that need review. I choose one and start; I do not need to manually assemble a daily plan before practising.
- **Include unseen material by default, with an off switch:** Questions I have not yet studied are included by default; I can disable their inclusion to focus on recall of already studied material. Here, “unseen” or “not reviewed” means not yet marked studied through either interface, as recorded in the database, not merely never attempted in recall.

## Optional mode: work toward a target date

- **I choose a target date:** For example, I want to know “Quant Research Interview Essentials” relatively well in about a month and a half. This is one possible mode, not a requirement for every project.
- **The plan works backward from that date:** I want to see what investment would be needed to reach my objective, rather than only see where my current pace might take me.
- **The date determines the proposed daily workload:** The plan estimates how many unseen questions to introduce each day, alongside the returning questions that need recall practice. I do not have to choose an introduction rate independently of the deadline.
- **I preview the effort before accepting a plan:** While choosing the date, I see the expected initial-study and returning-review workload, with an estimated time range when enough information is available. Changing the date updates that estimate.
- **Pace tracking may help after I start:** Comparing my actual progress with the plan could be useful once I have chosen a date. It is a possible follow-up feature, not the purpose of the date-selection preview.
- **The plan remains editable:** I can change the target date later and see the revised expected workload. Estimates should use my progress and recall history, including last-recall dates, without resetting that history.
- **Balance coverage and returning reviews:** The goal is to know the whole selected scope well enough by the deadline. Neither unseen material nor returning reviews should automatically take all the available effort. Some material may matter more than other material; how that importance is expressed remains open.
- **Good enough is sufficient:** I want useful command of the material by the date, not perfect recall of every question. The target is at least one Good/Easy on current content after any later Again, plus sufficient predicted successful recall at the deadline.
- **Estimates should be honest:** Workload predictions are estimates, not guarantees. They should improve as the system learns about my pace and recall outcomes.

## Agreed recall criterion and proposed project-level evidence

- **Recall the essential answer independently:** Before revealing the answer, I can explain the central idea or reconstruct the essential reasoning or solution approach without hints.
- **Allow minor omissions:** Exact wording and secondary details need not be perfect, but missing a key condition or a step that changes the conclusion is a meaningful gap.
- **Use repeat attempts as evidence:** An immediate success after reading the answer is not enough to establish readiness. Later independent attempts should inform the estimate of how well I know the material.
- **Aim for broad coverage with stronger recall of important material:** Avoid treating perfect recall of a small subset as success for the whole project. The acceptable remaining gaps and the way importance is set still need agreement.

## Chosen direction: FSRS for the initial implementation

- **Use FSRS for now:** FSRS is the chosen scheduler for the initial implementation.
- **Defer RWKV-Instant:** A neural variant can be explored later; it is not required for the initial implementation, and choosing or switching between models is outside that scope.
- **Use estimated recall probabilities:** These estimates can help guide review decisions and planning. They are model predictions, not guarantees of recall or mastery.
- **Build the project plan around FSRS:** FSRS supplies review scheduling; balancing unseen material with returning reviews and estimating workload toward a target date still need application-level design and evaluation.

## Still to decide

- Further refinements to the initial-study interaction. The first implementation shares database status through the service and does not write progress into Markdown.
- Further calibration of forecast scenarios; the target criterion and first planner policy are specified in [review-workflow.md](review-workflow.md).
- How question importance is expressed and how it affects the balance between coverage and returning reviews.
- Time estimates once reliable duration data is available. The target-date planner currently forecasts question and review-attempt counts.
- How study status is represented in the database separately from recall history. The current `new` status means an active question has no `review_state` row; it does not reliably identify unseen material. Study tracking is now separate in `study_state`; it is not inferred from `new`.

This draft captures intent and the chosen model direction for validation. It does not fix model versions or scheduling policy, define assessment buttons, or change the current implementation scope.

The initial implementation is now authorized and specified in [review-workflow.md](review-workflow.md); target-date planning is now also authorized under its documented defaults.
