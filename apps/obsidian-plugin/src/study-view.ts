import {
  FileSystemAdapter,
  ItemView,
  MarkdownRenderer,
  requestUrl,
  type WorkspaceLeaf,
} from "obsidian";

export const STUDY_VIEW = "recall-study";
interface Question {
  id: string;
  prompt: string;
  answer: string;
  contentHash: string;
  studiedAt: string | null;
  filePath: string;
}
export class RecallStudyView extends ItemView {
  private filePath: string | null = null;
  private questions: Question[] = [];
  private focusedId: string | null = null;
  private signature = "";
  private loading = false;
  private closed = false;
  private generation = 0;
  private timer: number | undefined;
  constructor(
    leaf: WorkspaceLeaf,
    private readonly baseUrl: () => string,
  ) {
    super(leaf);
  }
  getViewType(): string {
    return STUDY_VIEW;
  }
  getDisplayText(): string {
    return "Recall study";
  }
  getIcon(): string {
    return "brain";
  }
  async onOpen(): Promise<void> {
    this.filePath = this.app.workspace.getActiveFile()?.path ?? null;
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file) {
          this.filePath = file.path;
          this.focusedId = null;
          this.signature = "";
          this.generation++;
          void this.refresh();
        }
      }),
    );
    this.timer = window.setInterval(() => void this.refresh(), 3000);
    await this.refresh(true);
  }
  async onClose(): Promise<void> {
    this.closed = true;
    window.clearInterval(this.timer);
  }
  private async request(route: string, body?: unknown) {
    const response = await requestUrl({
      url: this.baseUrl() + route,
      method: body === undefined ? "GET" : "POST",
      headers:
        body === undefined
          ? {}
          : { "Content-Type": "application/json", "X-Recall-Client": "1" },
      body: body === undefined ? undefined : JSON.stringify(body),
      throw: false,
    });
    if (response.status >= 400)
      throw new Error(response.json?.error ?? "Recall service request failed.");
    return response.json;
  }
  private async verifyVault(): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter))
      throw new Error(
        "Recall study requires the desktop vault and local service.",
      );
    const status = await this.request("/api/status");
    if (status.vaultPath !== adapter.getBasePath())
      throw new Error(
        "The Recall service is connected to a different vault. Start it with this vault's path.",
      );
  }
  async refresh(focusAction = false): Promise<void> {
    if (this.loading || this.closed) return;
    const generation = this.generation;
    this.loading = true;
    try {
      await this.verifyVault();
      const data = this.filePath
        ? await this.request(
            `/api/study?file=${encodeURIComponent(this.filePath)}`,
          )
        : { questions: [] };
      if (this.closed || generation !== this.generation) return;
      const signature = JSON.stringify([this.filePath, data.questions]);
      if (signature !== this.signature) {
        this.questions = data.questions;
        this.signature = signature;
        await this.render(focusAction);
      }
    } catch (error) {
      if (!this.closed) {
        this.signature = "";
        this.contentEl.empty();
        this.contentEl.createEl("h3", { text: "Recall study" });
        this.contentEl.createEl("p", {
          text:
            error instanceof Error
              ? error.message
              : "Cannot reach the local Recall service.",
        });
        this.contentEl.createEl("p", {
          text: "Start the local service, then use this panel to study the current note. It will reconnect automatically.",
        });
      }
    } finally {
      this.loading = false;
    }
  }
  private async render(focusAction = false): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("recall-study-view");
    this.contentEl.createEl("h3", { text: "Recall study" });
    this.contentEl.createEl("p", {
      text: this.filePath ?? "Open a Recall note to study.",
    });
    if (!this.questions.length) {
      this.contentEl.createEl("p", {
        text: "No indexed questions in this note yet. Save it and wait for synchronization.",
      });
      return;
    }
    if (!this.questions.some((q) => q.id === this.focusedId))
      this.focusedId = (this.questions.find((q) => !q.studiedAt) ??
        this.questions[0])!.id;
    const nav = this.contentEl.createDiv({ cls: "recall-study-progress" });
    this.questions.forEach((q, i) => {
      const b = nav.createEl("button", {
        text: `${i + 1}${q.studiedAt ? " ✓" : ""}`,
        attr: {
          "aria-label": `Question ${i + 1}${q.studiedAt ? ", studied" : ""}`,
          "aria-pressed": String(q.id === this.focusedId),
        },
      });
      b.onclick = () => {
        this.focusedId = q.id;
        void this.render(true);
      };
    });
    const q = this.questions.find((q) => q.id === this.focusedId)!;
    const prompt = this.contentEl.createDiv({ cls: "recall-study-prompt" });
    await MarkdownRenderer.render(this.app, q.prompt, prompt, q.filePath, this);
    const answer = this.contentEl.createDiv();
    await MarkdownRenderer.render(
      this.app,
      q.answer || "*No answer written yet.*",
      answer,
      q.filePath,
      this,
    );
    this.contentEl.createEl("p", {
      text: q.studiedAt ? "✓ Studied" : "Not studied",
    });
    const actions = this.contentEl.createDiv({ cls: "recall-study-actions" });
    const next = () => {
      const i = this.questions.findIndex((x) => x.id === q.id);
      this.focusedId =
        this.questions[Math.min(i + 1, this.questions.length - 1)]!.id;
    };
    const study = actions.createEl("button", {
      text: q.studiedAt ? "Next question" : "Mark studied →",
      cls: "mod-cta",
    });
    study.onclick = async () => {
      if (this.loading) return;
      this.loading = true;
      study.disabled = true;
      try {
        await this.verifyVault();
        if (!q.studiedAt)
          await this.request("/api/study", {
            id: q.id,
            contentHash: q.contentHash,
            studied: true,
          });
        next();
        this.signature = "";
      } catch (error) {
        new NoticeMessage(this.contentEl, error);
      } finally {
        this.loading = false;
        await this.refresh(true);
        study.disabled = false;
      }
    };
    if (q.studiedAt) {
      const undo = actions.createEl("button", { text: "Mark not studied" });
      undo.onclick = async () => {
        if (this.loading) return;
        this.loading = true;
        undo.disabled = true;
        try {
          await this.verifyVault();
          await this.request("/api/study", {
            id: q.id,
            contentHash: q.contentHash,
            studied: false,
          });
          this.signature = "";
        } catch (error) {
          new NoticeMessage(this.contentEl, error);
        } finally {
          this.loading = false;
          await this.refresh(true);
          undo.disabled = false;
        }
      };
    }
    if (focusAction) study.focus();
  }
}
class NoticeMessage {
  constructor(container: HTMLElement, error: unknown) {
    container.createEl("p", {
      text: error instanceof Error ? error.message : "Could not save progress.",
      attr: { role: "alert" },
    });
  }
}
