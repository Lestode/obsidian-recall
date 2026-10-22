import type { EditorState } from "@codemirror/state";
import { duplicateQuestionIds, parseRecallQuestions, type RecallQuestion } from "@recall/core";

export function questionAtStudyCursor(state: EditorState): (RecallQuestion & { id: string }) | null {
  if (state.readOnly || state.selection.ranges.length !== 1 || !state.selection.main.empty) return null;
  const line = state.doc.lineAt(state.selection.main.head).number - 1;
  const questions = parseRecallQuestions(state.doc.toString());
  const question = questions.find(candidate => candidate.questionLine === line);
  if (!question?.id || duplicateQuestionIds(questions).has(question.id)) return null;
  return { ...question, id: question.id };
}

export function isStudyEnter(event: Pick<KeyboardEvent, "key" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey" | "isComposing">): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.altKey &&
    !event.ctrlKey && !event.metaKey && !event.isComposing;
}
