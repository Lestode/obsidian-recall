import assert from "node:assert/strict";
import test from "node:test";
import { parseRecallQuestions, sourceContexts } from "../src/index";

test("derives section paths and file order from current Markdown", () => {
  const markdown = `# Chapter 2\n\n## Core concepts\n\n**Q:** First?\n<!-- recall:id=123e4567-e89b-42d3-a456-426614174000 -->\nA\n\n**Q:** Second?\n<!-- recall:id=123e4567-e89b-42d3-a456-426614174001 -->\nB\n\n## Neighbours\n\n**Q:** Third?\n<!-- recall:id=123e4567-e89b-42d3-a456-426614174002 -->\nC\n`;
  const questions = parseRecallQuestions(markdown);

  assert.deepEqual(sourceContexts(markdown, questions), [
    { sectionPath: ["Chapter 2", "Core concepts"], questionOrdinal: 0 },
    { sectionPath: ["Chapter 2", "Core concepts"], questionOrdinal: 1 },
    { sectionPath: ["Chapter 2", "Neighbours"], questionOrdinal: 2 },
  ]);
});

test("ignores headings inside fenced code when deriving section paths", () => {
  const markdown = `# Real chapter\n\n\`\`\`markdown\n## Fake section\n\`\`\`\n\n**Q:** Real?\n<!-- recall:id=123e4567-e89b-42d3-a456-426614174000 -->\nA\n`;
  const questions = parseRecallQuestions(markdown);

  assert.deepEqual(sourceContexts(markdown, questions), [
    { sectionPath: ["Real chapter"], questionOrdinal: 0 },
  ]);
});

test("derives section paths from Setext headings", () => {
  const markdown = `Chapter\n=======\n\nSection\n-------\n\n**Q:** Real?\n<!-- recall:id=123e4567-e89b-42d3-a456-426614174000 -->\nA\n`;
  const questions = parseRecallQuestions(markdown);

  assert.deepEqual(sourceContexts(markdown, questions), [
    { sectionPath: ["Chapter", "Section"], questionOrdinal: 0 },
  ]);
});

test("does not derive Setext headings from YAML or list items", () => {
  const markdown = `---\ntitle: Metadata\n---\n\n# Real\n\n- list item\n---\n\n**Q:** Real?\n<!-- recall:id=123e4567-e89b-42d3-a456-426614174000 -->\nA\n`;
  const questions = parseRecallQuestions(markdown);
  assert.deepEqual(sourceContexts(markdown, questions), [
    { sectionPath: ["Real"], questionOrdinal: 0 },
  ]);
});
