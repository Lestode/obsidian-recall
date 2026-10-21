import assert from "node:assert/strict";
import test from "node:test";
import { parseRecallQuestions, questionTemplate } from "@recall/core";
import {
  importPrefixForContext,
  questionPrefixForBlankLine,
} from "../src/authoring-placement";

const ID = "123e4567-e89b-42d3-a456-426614174000";

test("question insertion preserves a blank paragraph boundary after prose", () => {
  const result = `Existing paragraph.\n${questionPrefixForBlankLine("Existing paragraph.")}${questionTemplate(ID)}`;
  assert.equal(result.startsWith("Existing paragraph.\n\n**Q:**"), true);
  assert.equal(parseRecallQuestions(result)[0]?.id, ID);
});

test("numbered import preserves a blank paragraph boundary after prose", () => {
  const imported = `**Q:** Imported?\n<!-- recall:id=${ID} -->\n\n`;
  const result = `Existing paragraph.\n${importPrefixForContext("", "Existing paragraph.")}${imported}`;
  assert.equal(result.startsWith("Existing paragraph.\n\n**Q:**"), true);
  assert.equal(parseRecallQuestions(result)[0]?.id, ID);
});

test("mid-line imports move to a fresh paragraph", () => {
  assert.equal(importPrefixForContext("Existing text", ""), "\n\n");
});
