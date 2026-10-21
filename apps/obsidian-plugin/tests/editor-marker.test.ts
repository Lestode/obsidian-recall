import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { identityComment, questionTemplate } from "@recall/core";
import {
  protectsIdentity,
  recallIdentityTransactionFilter,
} from "../src/editor-marker";

const ID = "123e4567-e89b-42d3-a456-426614174000";

function permitted(document: string, from: number, to: number, insert = ""): boolean {
  const state = EditorState.create({ doc: document });
  return protectsIdentity(state.update({ changes: { from, to, insert } }));
}

test("protects both newlines around an identity", () => {
  const markdown = `**Q:** Why?\n${identityComment(ID)}\n\nAnswer.\n`;
  const questionEnd = markdown.indexOf("\n");
  const identityStart = questionEnd + 1;
  const identityEnd = identityStart + identityComment(ID).length;

  assert.equal(permitted(markdown, questionEnd, questionEnd, "\n"), false);
  assert.equal(permitted(markdown, questionEnd, questionEnd, " continued"), true);
  assert.equal(permitted(markdown, questionEnd, questionEnd + 1), false);
  assert.equal(permitted(markdown, identityEnd, identityEnd, "x"), false);
  assert.equal(permitted(markdown, identityEnd, identityEnd + 1), false);
});

test("the real transaction filter permits prompt typing but rejects Enter", () => {
  const markdown = questionTemplate(ID);
  const promptEnd = markdown.indexOf("\n");
  const state = EditorState.create({
    doc: markdown,
    extensions: [recallIdentityTransactionFilter],
  });

  const typed = state.update({ changes: { from: promptEnd, insert: "Why?" } });
  assert.equal(typed.newDoc.line(1).text, "**Q:** Why?");
  const enter = state.update({ changes: { from: promptEnd, insert: "\n" } });
  assert.equal(enter.docChanged, false);

  const middle = markdown.indexOf("Q:") + 2;
  const multilinePaste = state.update({ changes: { from: middle, insert: "first\nsecond" } });
  assert.equal(multilinePaste.docChanged, false);
});

test("the real transaction filter blocks joining a question to the previous line", () => {
  const markdown = `Previous paragraph.\n\n**Q:** Why?\n${identityComment(ID)}\n`;
  const questionStart = markdown.indexOf("**Q:**");
  const state = EditorState.create({
    doc: markdown,
    extensions: [recallIdentityTransactionFilter],
  });
  const backspace = state.update({
    changes: { from: questionStart - 1, to: questionStart },
  });
  assert.equal(backspace.docChanged, false);
});

test("the real transaction filter preserves the blank paragraph boundary above a question", () => {
  const markdown = `Previous answer.\n\n**Q:** Why?\n${identityComment(ID)}\n`;
  const questionStart = markdown.indexOf("**Q:**");
  const firstNewline = markdown.indexOf("\n");
  const blankLineStart = firstNewline + 1;
  const state = EditorState.create({
    doc: markdown,
    extensions: [recallIdentityTransactionFilter],
  });

  const backspaceBlank = state.update({
    changes: { from: questionStart - 1, to: questionStart },
  });
  assert.equal(backspaceBlank.docChanged, false);
  const deleteFromPrevious = state.update({
    changes: { from: firstNewline, to: firstNewline + 1 },
  });
  assert.equal(deleteFromPrevious.docChanged, false);
  const typeOnBlank = state.update({
    changes: { from: blankLineStart, insert: "continued answer" },
  });
  assert.equal(typeOnBlank.docChanged, false);
});

test("the real transaction filter rejects edits that damage an attached marker", () => {
  const markdown = `**Q:** Why?\n${identityComment(ID)}\n`;
  const state = EditorState.create({
    doc: markdown,
    extensions: [recallIdentityTransactionFilter],
  });
  const damageMarker = state.update({ changes: { from: 0, to: 1 } });
  assert.equal(damageMarker.docChanged, false);
});

test("allows question edits and deletion of the complete question with its identity", () => {
  const markdown = `**Q:** Why?\n${identityComment(ID)}\n\nAnswer.\n`;
  const identityEnd = markdown.indexOf(identityComment(ID)) + identityComment(ID).length;

  assert.equal(permitted(markdown, 7, 10, "How"), true);
  assert.equal(permitted(markdown, 0, identityEnd), true);
});

test("allows undoing a newly inserted empty question as one atomic deletion", () => {
  const markdown = questionTemplate(ID);
  assert.equal(permitted(markdown, 0, markdown.indexOf("\n\n")), true);
});

test("does not associate a detached identity with a question", () => {
  const markdown = `**Q:** Why?\n\n${identityComment(ID)}\n`;
  const questionEnd = markdown.indexOf("\n");
  assert.equal(permitted(markdown, questionEnd, questionEnd, "more"), true);
});

test("leaves orphaned and fenced identity examples visible and editable", () => {
  const orphan = `${identityComment(ID)}\n`;
  assert.equal(permitted(orphan, 0, identityComment(ID).length), true);
  const fenced = `\`\`\`markdown\n**Q:** Example?\n${identityComment(ID)}\n\`\`\`\n`;
  const identityStart = fenced.indexOf(identityComment(ID));
  assert.equal(permitted(fenced, identityStart, identityStart + identityComment(ID).length), true);
});
