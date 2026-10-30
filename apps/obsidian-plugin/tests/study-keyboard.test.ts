import assert from "node:assert/strict";
import test from "node:test";
import { EditorSelection, EditorState } from "@codemirror/state";
import { isStudyEnter, questionAtStudyCursor } from "../src/study-keyboard";

const markdown = `# Policies

**Q:** In reinforcement learning, what does a policy specify?
<!-- recall:id=123e4567-e89b-42d3-a456-426614174000 -->

**A:** How the agent selects actions.

**Q:** In reinforcement learning, what is a stochastic policy?
<!-- recall:id=123e4567-e89b-42d3-a456-426614174001 -->

**A:** A distribution over actions.
`;

test("study Enter targets any cursor position on the question line, never the answer or surrounding text", () => {
  const initial = EditorState.create({ doc: markdown });
  const line = initial.doc.line(3);
  for (const position of [line.from, line.from + 15, line.to]) {
    const state = initial.update({ selection: { anchor: position } }).state;
    assert.equal(questionAtStudyCursor(state)?.id, "123e4567-e89b-42d3-a456-426614174000");
  }
  for (const lineNumber of [1, 2, 4, 5, 6, 7, 11]) {
    const state = initial.update({ selection: { anchor: initial.doc.line(lineNumber).from } }).state;
    assert.equal(questionAtStudyCursor(state), null);
  }
});

test("study Enter leaves selections, multiple cursors, read-only editors, and ambiguous identities alone", () => {
  const position = markdown.indexOf("**Q:**");
  assert.equal(questionAtStudyCursor(EditorState.create({ doc: markdown, selection: { anchor: position, head: position + 10 } })), null);
  assert.equal(questionAtStudyCursor(EditorState.create({
    doc: markdown, selection: EditorSelection.create([EditorSelection.cursor(position), EditorSelection.cursor(position + 5)]),
    extensions: EditorState.allowMultipleSelections.of(true),
  })), null);
  assert.equal(questionAtStudyCursor(EditorState.create({ doc: markdown, selection: { anchor: position }, extensions: EditorState.readOnly.of(true) })), null);
  for (const doc of [markdown + markdown, "**Q:** A draft without identity?\n", "```md\n" + markdown + "\n```\n"]) {
    assert.equal(questionAtStudyCursor(EditorState.create({ doc, selection: { anchor: doc.indexOf("**Q:**") } })), null);
  }
});

test("only plain Enter outside IME composition is a study shortcut", () => {
  const event = { key: "Enter", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, isComposing: false };
  assert.equal(isStudyEnter(event), true);
  for (const modifier of ["shiftKey", "ctrlKey", "altKey", "metaKey", "isComposing"] as const) {
    assert.equal(isStudyEnter({ ...event, [modifier]: true }), false);
  }
  assert.equal(isStudyEnter({ ...event, key: "a" }), false);
});
