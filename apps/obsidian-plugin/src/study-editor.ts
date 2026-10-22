import { Prec } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import { duplicateQuestionIds, hashQuestionContent, parseRecallQuestions, type RecallQuestion } from "@recall/core";
import { StudyClient } from "./study-client";
import { mountStudyControl } from "./study-control";
import { isStudyEnter, questionAtStudyCursor } from "./study-keyboard";

export function studyEditorExtension(client: StudyClient, eligible: (file: string) => boolean) {
  class StudyWidget extends WidgetType {
    constructor(readonly file: string, readonly question: RecallQuestion & { id: string }) { super(); }
    eq(other: StudyWidget): boolean {
      return this.file === other.file && this.question.id === other.question.id &&
        this.question.prompt === other.question.prompt && this.question.answer === other.question.answer;
    }
    toDOM(): HTMLElement {
      const element = document.createElement("span");
      cleanup.set(element, mountStudyControl(element, client, this.file, this.question));
      return element;
    }
    destroy(element: HTMLElement): void { cleanup.get(element)?.(); }
    ignoreEvent(): boolean { return true; }
  }
  const cleanup = new WeakMap<HTMLElement, () => void>();
  const pending = new WeakSet<EditorView>();
  const build = (view: EditorView): DecorationSet => {
    const file = view.state.field(editorInfoField, false)?.file?.path;
    if (!file || !eligible(file)) return Decoration.none;
    const questions = parseRecallQuestions(view.state.doc.toString());
    const duplicates = duplicateQuestionIds(questions);
    return Decoration.set(questions.flatMap(question => question.id && !duplicates.has(question.id)
      ? [Decoration.widget({ widget: new StudyWidget(file, { ...question, id: question.id }), side: 2 })
        .range(view.state.doc.line(question.questionLine + 1).to)] : []), true);
  };
  const widgets = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = build(view); }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.startState.field(editorInfoField, false)?.file?.path !==
          update.state.field(editorInfoField, false)?.file?.path) this.decorations = build(update.view);
    }
  }, { decorations: plugin => plugin.decorations });

  const keyboard = Prec.highest(EditorView.domEventHandlers({
    keydown(event, view) {
      if (!isStudyEnter(event) || view.composing ||
          !(event.target instanceof Node) || !view.contentDOM.contains(event.target) ||
          (event.target instanceof Element && event.target.closest(".recall-study-control"))) return false;
      const file = view.state.field(editorInfoField, false)?.file?.path;
      if (!file || !eligible(file)) return false;
      const question = questionAtStudyCursor(view.state);
      if (!question) return false;
      if (event.repeat || pending.has(view)) return true;
      pending.add(view);
      const document = view.state.doc;
      const selection = view.state.selection;
      void (async () => {
        try {
          const hash = await hashQuestionContent(question.prompt, question.answer);
          const studied = await client.toggleStudied(file, question.id, hash);
          // A completed save must not steal a cursor that the user has since moved.
          if (studied !== true || !view.dom.isConnected || !view.hasFocus ||
              view.state.doc !== document || !view.state.selection.eq(selection) ||
              view.state.field(editorInfoField, false)?.file?.path !== file) return;
          const questions = parseRecallQuestions(document.toString());
          const next = questions[questions.findIndex(candidate => candidate.id === question.id) + 1];
          if (!next?.id) return;
          const position = document.line(next.questionLine + 1).from;
          view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: "center" }) });
        } finally { pending.delete(view); }
      })();
      return true;
    },
  }));
  return [widgets, keyboard];
}
