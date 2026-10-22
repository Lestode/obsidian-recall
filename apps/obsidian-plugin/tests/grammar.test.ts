import assert from "node:assert/strict";
import test from "node:test";
import {
  duplicateQuestionIds,
  formatRecallAnswer,
  orphanRecallIdentities,
  parseRecallQuestions,
  questionTemplate,
} from "../src/grammar";
import { convertNumberedQuestions } from "../src/import-questions";
import { hashQuestionContent } from "@recall/core";

const ID_ONE = "123e4567-e89b-42d3-a456-426614174000";
const ID_TWO = "123e4567-e89b-42d3-a456-426614174001";

test("places identity directly beneath a newly inserted question", () => {
  assert.equal(
    questionTemplate(ID_ONE),
    `**Q:** \n<!-- recall:id=${ID_ONE} -->\n\n**A:** \n\n`,
  );
  const [question] = parseRecallQuestions(questionTemplate(ID_ONE));
  assert.equal(question?.id, ID_ONE);
  assert.equal(question?.prompt, "");
  assert.equal(question?.answer, "");
  assert.deepEqual(orphanRecallIdentities(questionTemplate(ID_ONE)), []);
});

test("converts a numbered selection into identified recall questions", () => {
  const ids = [ID_ONE, ID_TWO];
  const result = convertNumberedQuestions(
    `Core concepts\n\n1. What is OLS?\n2. Why use regularization?`,
    () => ids.shift() ?? "unexpected-id",
  );

  assert.equal(result?.questionCount, 2);
  assert.equal(
    result?.markdown,
    `## Core concepts\n\n**Q:** What is OLS?\n<!-- recall:id=${ID_ONE} -->\n\n**A:** \n\n**Q:** Why use regularization?\n<!-- recall:id=${ID_TWO} -->\n\n**A:** \n\n`,
  );
});

test("normalizes imported headings, multiline math, and spacing artifacts", () => {
  const result = convertNumberedQuestions(
    `"### Statistical decision theory\n\n25. Under squared-error loss, which function \\(f(x)\\) minimizes\n\n    \\[ \\mathbb E[(Y-f(X))^2]? \\]&#x20;"`,
    () => ID_ONE,
  );

  assert.equal(
    result?.markdown,
    `## Statistical decision theory\n\n**Q:** Under squared-error loss, which function $f(x)$ minimizes $\\mathbb E[(Y-f(X))^2]?$\n<!-- recall:id=${ID_ONE} -->\n\n**A:** \n\n`,
  );
});

test("imports A: answers beneath their protected question identities", () => {
  const ids = [ID_ONE, ID_TWO];
  const result = convertNumberedQuestions(
    `1. What is the OLS estimator?\nA: $\\hat\\beta=(X^\\top X)^{-1}X^\\top y$\n\n2. Why regularize?\n**A:** To reduce variance\nwhen data are limited.`,
    () => ids.shift() ?? "unexpected-id",
  );

  assert.equal(
    result?.markdown,
    `**Q:** What is the OLS estimator?\n<!-- recall:id=${ID_ONE} -->\n\n**A:** $\\hat\\beta=(X^\\top X)^{-1}X^\\top y$\n\n**Q:** Why regularize?\n<!-- recall:id=${ID_TWO} -->\n\n**A:** To reduce variance when data are limited.\n\n`,
  );
});

test("rejects a selection without numbered questions", () => {
  assert.equal(convertNumberedQuestions("Only ordinary prose."), null);
});

test("parses a question, identity, and answer", () => {
  const markdown = `**Q:** Why can predictions remain stable?\n<!-- recall:id=${ID_ONE} -->\n\nBecause fitted values may be well identified.\n`;
  const [question] = parseRecallQuestions(markdown);
  assert.equal(question?.id, ID_ONE);
  assert.equal(question?.prompt, "Why can predictions remain stable?");
  assert.equal(question?.answer, "Because fitted values may be well identified.");
});

test("leading answer labels preserve answer content, hashes, and literal labels inside answers", async () => {
  const body = "An explanation.\n\n- A list item.\n\n```md\n**A:** A literal code example.\n```\n\n**A:** A label inside the answer.";
  const hashes = [];
  for (const prefix of ["", "**A:** ", "**A:**\n\n"]) {
    const markdown = `**Q:** Explain it.\n<!-- recall:id=${ID_ONE} -->\n\n${prefix}${body}\n`;
    const [question] = parseRecallQuestions(markdown);
    assert.equal(question?.id, ID_ONE);
    assert.equal(question?.answer, body);
    assert.equal(question?.answerStartLine, prefix === "**A:**\n\n" ? 5 : 3);
    hashes.push(await hashQuestionContent(question!.prompt, question!.answer));
  }
  assert.equal(new Set(hashes).size, 1);
});

test("a standalone answer label preserves a leading code fence, list, or equation", () => {
  for (const body of ["```md\n**A:** Example only.\n```", "- First\n- Second", "$$\nc = 2\n$$"]) {
    const markdown = `**Q:** Explain it.\n<!-- recall:id=${ID_ONE} -->\n\n**A:**\n\n${body}\n`;
    assert.equal(parseRecallQuestions(markdown)[0]?.answer, body);
  }
});

test("inline prose labels preserve content while block-first answers still render as Markdown blocks", async () => {
  const { marked } = await import("marked");
  const prose = "The answer starts here.\n\nA later paragraph.\n\n- A later list.";
  assert.equal(formatRecallAnswer(prose), `**A:** ${prose}`);
  for (const [body, type] of [
    ["```python\nprint(1)\n```", "code"],
    ["- First\n- Second", "list"],
    ["1. First\n2. Second", "list"],
    ["> A quotation.", "blockquote"],
    ["### Details", "heading"],
    ["| Name | Value |\n| --- | --- |\n| c | 2 |", "table"],
  ]) {
    const formatted = formatRecallAnswer(body!);
    const tokens = marked.lexer(formatted).filter(token => token.type !== "space");
    assert.equal(tokens[0]?.type, "paragraph");
    assert.equal(tokens[1]?.type, type);
    assert.equal(parseRecallQuestions(`**Q:** Explain it.\n<!-- recall:id=${ID_ONE} -->\n\n${formatted}\n`)[0]?.answer, body);
  }
  assert.equal(formatRecallAnswer("$$\nc=2\n$$"), "**A:**\n\n$$\nc=2\n$$");
});

test("ends an answer at the next question", () => {
  const markdown = `**Q:** First?\n<!-- recall:id=${ID_ONE} -->\n\nFirst answer.\n\n**Q:** Second?\n<!-- recall:id=${ID_TWO} -->\n\nSecond answer.\n`;
  const questions = parseRecallQuestions(markdown);
  assert.equal(questions.length, 2);
  assert.equal(questions[0]?.answer, "First answer.");
  assert.equal(questions[1]?.answer, "Second answer.");
});

test("ends an answer at an H1 or H2 while retaining deeper headings", () => {
  const markdown = `**Q:** Explain it.\n<!-- recall:id=${ID_ONE} -->\n\nAnswer.\n\n### Detail\n\nStill answer.\n\n## Ordinary section\n\nNot answer.\n`;
  const [question] = parseRecallQuestions(markdown);
  assert.equal(question?.answer, "Answer.\n\n### Detail\n\nStill answer.");
});

test("ignores question-like text inside fenced code blocks", () => {
  const markdown = `\`\`\`markdown\n**Q:** Not a real question.\n\`\`\`\n\n**Q:** Real question.\n<!-- recall:id=${ID_ONE} -->\n\nAnswer.\n`;
  const questions = parseRecallQuestions(markdown);
  assert.equal(questions.length, 1);
  assert.equal(questions[0]?.prompt, "Real question.");
});

test("reports missing and duplicated identities without changing content", () => {
  const markdown = `**Q:** First?\n<!-- recall:id=${ID_ONE} -->\n\nA.\n\n**Q:** Copy?\n<!-- recall:id=${ID_ONE} -->\n\nB.\n\n**Q:** No identity?\n\nC.\n`;
  const questions = parseRecallQuestions(markdown);
  assert.equal(questions[2]?.id, null);
  assert.deepEqual(duplicateQuestionIds(questions).get(ID_ONE), [0, 5]);
});

test("requires the identity on the immediately following line", () => {
  const markdown = `**Q:** Detached identity?\n\n<!-- recall:id=${ID_ONE} -->\n\nAnswer.\n`;
  const [question] = parseRecallQuestions(markdown);
  assert.equal(question?.id, null);
  assert.deepEqual(orphanRecallIdentities(markdown), [{ id: ID_ONE, line: 2 }]);
});

test("ignores identity-like comments in fenced code", () => {
  const markdown = `\`\`\`markdown\n<!-- recall:id=${ID_ONE} -->\n\`\`\`\n`;
  assert.deepEqual(orphanRecallIdentities(markdown), []);
});

test("requires a question marker to begin its own Markdown paragraph", () => {
  const markdown = `Some prose\n**Q:** Lazy continuation?\n<!-- recall:id=${ID_ONE} -->\n`;
  assert.deepEqual(parseRecallQuestions(markdown), []);
  assert.deepEqual(orphanRecallIdentities(markdown), [{ id: ID_ONE, line: 2 }]);
});

test("ends an answer before a Setext level-one or level-two heading", () => {
  const markdown = `**Q:** First?\n<!-- recall:id=${ID_ONE} -->\n\nAnswer.\n\nNext section\n---\n\nNot answer.\n`;
  assert.equal(parseRecallQuestions(markdown)[0]?.answer, "Answer.");
});

test("does not treat YAML front matter or list separators as Setext headings", () => {
  const frontMatter = `---\ntitle: Course\n---\n\n**Q:** First?\n<!-- recall:id=${ID_ONE} -->\n\nAnswer.\n`;
  assert.equal(parseRecallQuestions(frontMatter)[0]?.answer, "Answer.");
  const list = `**Q:** List?\n<!-- recall:id=${ID_ONE} -->\n\n- first item\n---\nAfter rule.\n`;
  assert.equal(
    parseRecallQuestions(list)[0]?.answer,
    "- first item\n---\nAfter rule.",
  );
});
