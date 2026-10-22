import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import { duplicateQuestionIds, parseRecallQuestions, type RecallQuestion } from "@recall/core";
import { StudyClient } from "./study-client";
import { focusStudyControl, mountStudyControl } from "./study-control";

export function studyEditorExtension(client: StudyClient, eligible: (file: string) => boolean) {
  class StudyWidget extends WidgetType {
    constructor(readonly file: string, readonly question: RecallQuestion & { id: string }) { super(); }
    eq(other: StudyWidget): boolean {
      return this.file === other.file && this.question.id === other.question.id &&
        this.question.prompt === other.question.prompt && this.question.answer === other.question.answer;
    }
    toDOM(view: EditorView): HTMLElement {
      const element = document.createElement("span");
      const dispose = mountStudyControl(element, client, this.file, this.question, () => {
        const questions = parseRecallQuestions(view.state.doc.toString());
        const index = questions.findIndex(question => question.id === this.question.id);
        const next = index >= 0 ? questions[index + 1] : undefined;
        if (!next?.id) {
          element.querySelector<HTMLButtonElement>("button:not([hidden]):not(:disabled)")?.focus();
          return;
        }
        const position = view.state.doc.line(next.questionLine + 1).from;
        view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: "center" }) });
        let attempts = 0;
        const focus = () => {
          if (!view.dom.isConnected) return;
          if (!focusStudyControl(view.dom, next.id!) && ++attempts < 30) requestAnimationFrame(focus);
        };
        requestAnimationFrame(focus);
      });
      cleanup.set(element, dispose);
      return element;
    }
    destroy(element: HTMLElement): void { cleanup.get(element)?.(); }
    ignoreEvent(): boolean { return true; }
  }
  const cleanup = new WeakMap<HTMLElement, () => void>();
  const build = (view: EditorView): DecorationSet => {
    const file = view.state.field(editorInfoField, false)?.file?.path;
    if (!file || !eligible(file)) return Decoration.none;
    const questions = parseRecallQuestions(view.state.doc.toString());
    const duplicates = duplicateQuestionIds(questions);
    return Decoration.set(questions.flatMap(question => question.id && !duplicates.has(question.id)
      ? [Decoration.widget({ widget: new StudyWidget(file, { ...question, id: question.id }), side: 2 })
        .range(view.state.doc.line(question.questionLine + 1).to)] : []), true);
  };
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = build(view); }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.startState.field(editorInfoField, false)?.file?.path !==
          update.state.field(editorInfoField, false)?.file?.path) this.decorations = build(update.view);
    }
  }, { decorations: plugin => plugin.decorations });
}
