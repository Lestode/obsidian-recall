import {
  App,
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  TFile,
} from "obsidian";

export interface SlashAction {
  command: string;
  label: string;
  run(editor: Editor, file: TFile, context: EditorSuggestContext): void | Promise<void>;
}

export class RecallSlashSuggest extends EditorSuggest<SlashAction> {
  constructor(app: App, private readonly actions: SlashAction[]) {
    super(app);
  }

  onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    file: TFile | null,
  ): EditorSuggestTriggerInfo | null {
    if (!file) return null;
    const lineBeforeCursor = editor.getLine(cursor.line).slice(0, cursor.ch);
    const match = lineBeforeCursor.match(/(?:^|\s)\/([a-z-]*)$/i);
    if (!match || match.index === undefined) return null;
    const slashOffset = lineBeforeCursor.lastIndexOf("/");
    return {
      start: { line: cursor.line, ch: slashOffset },
      end: cursor,
      query: match[1] ?? "",
    };
  }

  getSuggestions(context: EditorSuggestContext): SlashAction[] {
    const query = context.query.toLowerCase();
    return this.actions.filter((action) => action.command.startsWith(query));
  }

  renderSuggestion(action: SlashAction, element: HTMLElement): void {
    element.createEl("div", { text: `/${action.command}` });
    element.createEl("small", { text: action.label });
  }

  selectSuggestion(action: SlashAction): void {
    const context = this.context;
    if (!context) return;
    context.editor.replaceRange("", context.start, context.end);
    void action.run(context.editor, context.file, context);
  }
}
