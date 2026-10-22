import { MarkdownRenderChild, MarkdownView, type App, type MarkdownPostProcessorContext } from "obsidian";
import { duplicateQuestionIds, parseRecallQuestions } from "@recall/core";
import { StudyClient } from "./study-client";
import { focusStudyControl, mountStudyControl } from "./study-control";

export function addReadingStudyControls(el: HTMLElement, context: MarkdownPostProcessorContext, client: StudyClient, app: App): void {
  const section = context.getSectionInfo(el);
  if (!section) return;
  const all = parseRecallQuestions(section.text);
  const duplicates = duplicateQuestionIds(all);
  const questions = all.filter(question => question.questionLine >= section.lineStart &&
    question.questionLine <= section.lineEnd);
  const paragraphs = Array.from(el.querySelectorAll<HTMLParagraphElement>("p")).filter(paragraph => {
    const first = paragraph.firstElementChild;
    return first?.tagName === "STRONG" && first.textContent === "Q:" &&
      !paragraph.closest("blockquote, li, .callout, .markdown-embed");
  });
  // Do not guess the mapping when an unusual render produces ambiguous blocks.
  if (paragraphs.length !== questions.length) return;
  for (const [index, paragraph] of paragraphs.entries()) {
    const question = questions[index];
    if (!question?.id || duplicates.has(question.id) || paragraph.querySelector(".recall-study-control")) continue;
    const container = document.createElement("span");
    paragraph.append(container);
    const id = question.id;
    class StudyChild extends MarkdownRenderChild {
      private dispose: (() => void) | null = null;
      onload(): void {
        this.dispose = mountStudyControl(container, client, context.sourcePath, { ...question!, id }, () => {
          const current = context.getSectionInfo(el);
          const questions = current ? parseRecallQuestions(current.text) : all;
          const index = questions.findIndex(candidate => candidate.id === id);
          const next = index >= 0 ? questions[index + 1] : undefined;
          const root = container.closest(".markdown-preview-view") ?? el;
          if (!next?.id) {
            container.querySelector<HTMLButtonElement>("button:not([hidden]):not(:disabled)")?.focus();
          } else if (!focusStudyControl(root, next.id)) {
            // Reading view virtualizes long notes. Scroll by the public source-line
            // API first, then focus the control once that section is rendered.
            const view = app.workspace.getLeavesOfType("markdown").map(leaf => leaf.view)
              .find((candidate): candidate is MarkdownView => candidate instanceof MarkdownView && candidate.containerEl.contains(container));
            if (!view) return;
            view.previewMode.applyScroll(next.questionLine);
            let attempts = 0;
            const focus = () => {
              if (!view.containerEl.isConnected || view.file?.path !== context.sourcePath) return;
              if (!focusStudyControl(root, next.id!) && ++attempts < 30) requestAnimationFrame(focus);
            };
            requestAnimationFrame(focus);
          }
        }, () => {
          const current = context.getSectionInfo(el);
          return current ? parseRecallQuestions(current.text).find(candidate => candidate.id === id) ?? null : null;
        });
      }
      onunload(): void { this.dispose?.(); }
    }
    context.addChild(new StudyChild(container));
  }
}
