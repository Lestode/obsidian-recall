import { Editor, FileSystemAdapter, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath, requestUrl } from "obsidian";
import {
  duplicateQuestionIds,
  orphanRecallIdentities,
  parseRecallQuestions,
  questionTemplate,
  RECALL_MARKER_FILE,
} from "./grammar";
import { nearestRecallRoot } from "./roots";
import { RecallSlashSuggest, SlashAction } from "./slash-suggest";
import { recallIdentityEditorExtension } from "./editor-marker";
import { convertNumberedQuestions } from "./import-questions";
import { StudyClient, loopbackServiceUrl } from "./study-client";
import { studyEditorExtension } from "./study-editor";
import { addReadingStudyControls } from "./study-reading";
import { registerNoteProgressViews } from "./note-progress-views";
import {
  importPrefixForContext,
  questionPrefixForBlankLine,
} from "./authoring-placement";

export default class ObsidianRecallPlugin extends Plugin {
  async onload(): Promise<void> {
    const data = await this.loadData() as { serviceUrl?: string } | null;
    let serviceUrl = data?.serviceUrl ?? "http://127.0.0.1:45871";
    const study = new StudyClient(async (route, body) => {
      const adapter = this.app.vault.adapter;
      if (!(adapter instanceof FileSystemAdapter)) throw new Error("Study tracking requires the desktop companion service.");
      let timer: number | undefined;
      try {
        const response = await Promise.race([
          requestUrl({
            url: `${loopbackServiceUrl(serviceUrl)}${route}`,
            method: body ? "POST" : "GET", throw: false,
            headers: { "x-recall-client": "obsidian", "x-recall-vault": encodeURIComponent(adapter.getBasePath()) },
            ...(body ? { contentType: "application/json", body: JSON.stringify(body) } : {}),
          }),
          new Promise<never>((_resolve, reject) => {
            timer = window.setTimeout(() => reject(new Error(
              "Could not confirm study progress. Check the companion service and retry.")), 10000);
          }),
        ]);
        if (response.status !== 200) throw new Error(response.json?.error ?? "Study service unavailable. Start the companion service for this vault.");
        return response.json;
      } finally { if (timer !== undefined) window.clearTimeout(timer); }
    });
    this.registerInterval(window.setInterval(() => void study.refreshVisible(), 3000));
    registerNoteProgressViews(this, study, file => file.extension === "md" && file.name !== RECALL_MARKER_FILE && this.isInsideRecallRoot(file));
    this.registerEditorExtension(studyEditorExtension(study, file => nearestRecallRoot(file, this.markerPaths()) !== null));
    this.registerMarkdownPostProcessor((el, context) => {
      if (nearestRecallRoot(context.sourcePath, this.markerPaths()) !== null) addReadingStudyControls(el, context, study);
    });
    const plugin = this;
    this.addSettingTab(new class extends PluginSettingTab {
      display(): void {
        this.containerEl.empty();
        new Setting(this.containerEl).setName("Study companion service")
          .setDesc("Start the local service for this vault, then use its loopback address. Progress is stored separately from Markdown.")
          .addText(text => text.setValue(serviceUrl).onChange(async value => {
            serviceUrl = value;
            try {
              const checked = loopbackServiceUrl(value);
              await plugin.saveData({ ...data, serviceUrl: checked });
              serviceUrl = checked;
              await study.refreshVisible();
            } catch { /* Retry displays validation errors for an incomplete address. */ }
          }));
      }
    }(this.app, this));
    this.registerEditorExtension(recallIdentityEditorExtension);
    this.app.workspace.updateOptions();

    const actions: SlashAction[] = [
      {
        command: "question",
        label: "Insert an active-recall question",
        run: (editor, file) => this.insertQuestion(editor, file),
      },
      {
        command: "enable-recall-folder",
        label: "Mark the current folder as an active-recall root",
        run: (_editor, file) => this.enableRecallFolder(file),
      },
    ];

    this.registerEditorSuggest(new RecallSlashSuggest(this.app, actions));

    this.addCommand({
      id: "insert-question",
      name: "Insert recall question",
      editorCheckCallback: (checking, editor, view) => {
        if (!view.file || !this.isInsideRecallRoot(view.file)) return false;
        if (!checking) this.insertQuestion(editor, view.file);
        return true;
      },
    });

    this.addCommand({
      id: "enable-recall-folder",
      name: "Enable active recall for current folder",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) void this.enableRecallFolder(file);
        return true;
      },
    });

    this.addCommand({
      id: "inspect-current-file",
      name: "Inspect recall questions in current file",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file || !this.isInsideRecallRoot(view.file)) return false;
        if (!checking) this.inspectCurrentFile(view);
        return true;
      },
    });

    this.addCommand({
      id: "convert-numbered-selection",
      name: "Convert numbered selection to recall questions",
      editorCheckCallback: (checking, editor, view) => {
        if (
          !view.file ||
          !this.isInsideRecallRoot(view.file) ||
          editor.getSelection().trim() === ""
        ) {
          return false;
        }
        if (!checking) this.convertNumberedSelection(editor);
        return true;
      },
    });
  }

  private markerPaths(): string[] {
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.name === RECALL_MARKER_FILE)
      .map((file) => file.path);
  }

  private isInsideRecallRoot(file: TFile): boolean {
    return nearestRecallRoot(file.path, this.markerPaths()) !== null;
  }

  private insertQuestion(editor: Editor, file: TFile): void {
    if (!this.isInsideRecallRoot(file)) {
      new Notice("This file is not inside a folder containing _recall.md.");
      return;
    }

    const id = crypto.randomUUID();
    const cursor = editor.getCursor();
    const template = questionTemplate(id);
    const line = editor.getLine(cursor.line);
    if (line.trim() === "") {
      const prefix = questionPrefixForBlankLine(
        cursor.line > 0 ? editor.getLine(cursor.line - 1) : "",
      );
      editor.replaceRange(
        `${prefix}${template}`,
        { line: cursor.line, ch: 0 },
        { line: cursor.line, ch: line.length },
      );
      editor.setCursor({
        line: cursor.line + (prefix ? 1 : 0),
        ch: "**Q:** ".length,
      });
    } else {
      editor.replaceRange(`\n\n${template}`, { line: cursor.line, ch: line.length });
      editor.setCursor({ line: cursor.line + 2, ch: "**Q:** ".length });
    }
  }

  private async enableRecallFolder(file: TFile): Promise<void> {
    const folder = file.parent?.path ?? "";
    const markerPath = normalizePath(folder ? `${folder}/${RECALL_MARKER_FILE}` : RECALL_MARKER_FILE);
    if (this.app.vault.getAbstractFileByPath(markerPath)) {
      new Notice(`${markerPath} already exists.`);
      return;
    }
    await this.app.vault.create(markerPath, `# ${file.parent?.name ?? "Recall"}\n`);
    new Notice(`Enabled active recall for ${folder || "the vault root"}.`);
  }

  private inspectCurrentFile(view: MarkdownView): void {
    const questions = parseRecallQuestions(view.editor.getValue());
    const missingIds = questions.filter((question) => !question.id).length;
    const duplicates = duplicateQuestionIds(questions).size;
    const orphanIdentities = orphanRecallIdentities(view.editor.getValue(), questions).length;
    const details = [
      `${questions.length} question${questions.length === 1 ? "" : "s"}`,
      `${missingIds} without identity`,
      `${duplicates} duplicated ${duplicates === 1 ? "identity" : "identities"}`,
      `${orphanIdentities} orphaned ${orphanIdentities === 1 ? "identity" : "identities"}`,
    ];
    new Notice(details.join(" · "));
  }

  private convertNumberedSelection(editor: Editor): void {
    const result = convertNumberedQuestions(editor.getSelection());
    if (!result) {
      new Notice("The selection does not contain numbered questions.");
      return;
    }

    const selectionStart = editor.getCursor("from");
    const textBeforeSelection = editor.getLine(selectionStart.line).slice(0, selectionStart.ch);
    const previousLine = selectionStart.line > 0
      ? editor.getLine(selectionStart.line - 1)
      : "";
    const prefix = importPrefixForContext(textBeforeSelection, previousLine);
    editor.replaceSelection(`${prefix}${result.markdown}`);
    new Notice(
      `Converted ${result.questionCount} question${result.questionCount === 1 ? "" : "s"}.`,
    );
  }
}
