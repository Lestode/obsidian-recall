import { MarkdownView, TFile, type Plugin } from "obsidian";
import { noteProgress, noteQuestionHashes } from "./note-progress";
import type { StudyClient } from "./study-client";

interface ProgressMount {
  file: string;
  element: HTMLElement;
  refresh: (invalidate?: boolean) => void;
  dispose: () => void;
}

/** Decorate titles without putting progress inside editable filename elements. */
export function registerNoteProgressViews(plugin: Plugin, client: StudyClient, eligible: (file: TFile) => boolean): void {
  const mounts = new Map<HTMLElement, ProgressMount>();
  let scheduled = false;
  let stopped = false;
  const schedule = () => {
    if (scheduled || stopped) return;
    scheduled = true;
    window.requestAnimationFrame(() => { scheduled = false; if (!stopped) reconcile(); });
  };
  const markdownFor = async (file: string): Promise<string> => {
    const active = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const views = [active, ...plugin.app.workspace.getLeavesOfType("markdown").map(leaf => leaf.view)];
    for (const view of views) {
      if (view instanceof MarkdownView && view.file?.path === file && view.getMode() === "source") {
        return view.editor.getValue();
      }
    }
    const note = plugin.app.vault.getAbstractFileByPath(file);
    if (!(note instanceof TFile)) throw new Error("The note is no longer available.");
    return plugin.app.vault.cachedRead(note);
  };
  const mount = (host: HTMLElement, file: string, placement: "file" | "title") => {
    const element = host.ownerDocument.createElement("span");
    element.className = `recall-note-progress recall-note-progress-${placement}`;
    // A sibling avoids modifying contenteditable titles or their text content.
    host.insertAdjacentElement("afterend", element);
    let hashes: Map<string, string> | null | undefined;
    let disposed = false;
    let generation = 0;
    let readError: string | null = null;
    const render = () => {
      if (disposed) return;
      const snapshot = client.snapshot(file);
      const progress = noteProgress(readError ? { ...snapshot, error: readError } : snapshot, hashes);
      const text = progress.label + (progress.changed ? " · Content changed" : "");
      if (element.textContent !== text) element.textContent = text;
      element.hidden = progress.hidden;
      element.dataset.state = progress.tone;
      element.title = progress.description;
      element.setAttribute("aria-label", progress.description);
    };
    const refresh = (invalidate = false) => {
      const current = ++generation;
      if (invalidate) hashes = undefined;
      readError = null;
      render();
      void markdownFor(file).then(noteQuestionHashes).then(result => {
        if (disposed || current !== generation) return;
        hashes = result;
        render();
      }).catch(error => {
        if (disposed || current !== generation) return;
        readError = error instanceof Error ? error.message : String(error);
        render();
      });
    };
    const unsubscribe = client.subscribe(file, () => { render(); refresh(); });
    mounts.set(host, { file, element, refresh, dispose: () => {
      disposed = true; unsubscribe(); element.remove();
    } });
    refresh();
    void client.load(file);
  };
  const reconcile = () => {
    const targets = new Map<HTMLElement, { file: string; placement: "file" | "title" }>();
    for (const leaf of plugin.app.workspace.getLeavesOfType("file-explorer")) {
      const area = leaf.view.containerEl.getBoundingClientRect();
      for (const row of Array.from(leaf.view.containerEl.querySelectorAll<HTMLElement>(".nav-file-title[data-path]"))) {
        const rect = row.getBoundingClientRect();
        if (!row.getClientRects().length || rect.bottom < area.top || rect.top > area.bottom) continue;
        const file = plugin.app.vault.getAbstractFileByPath(row.dataset.path!);
        const label = row.querySelector<HTMLElement>(".nav-file-title-content");
        if (file instanceof TFile && label && eligible(file)) targets.set(label, { file: file.path, placement: "file" });
      }
    }
    for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || !view.file || !eligible(view.file)) continue;
      // Use the open-note header, keeping editable inline titles untouched.
      for (const title of Array.from(view.containerEl.querySelectorAll<HTMLElement>(".view-header-title"))) {
        targets.set(title, { file: view.file.path, placement: "title" });
      }
    }
    for (const [host, item] of mounts) {
      if (targets.get(host)?.file !== item.file || !item.element.isConnected) {
        item.dispose(); mounts.delete(host);
      }
    }
    for (const [host, target] of targets) if (!mounts.has(host)) mount(host, target.file, target.placement);
  };
  const refreshFile = (file: string) => {
    for (const item of mounts.values()) if (item.file === file) item.refresh(true);
    schedule();
  };
  plugin.registerEvent(plugin.app.workspace.on("layout-change", schedule));
  plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", schedule));
  plugin.registerEvent(plugin.app.workspace.on("editor-change", (_editor, info) => {
    if (info.file) refreshFile(info.file.path);
  }));
  plugin.registerEvent(plugin.app.vault.on("modify", file => refreshFile(file.path)));
  plugin.registerEvent(plugin.app.vault.on("create", schedule));
  plugin.registerEvent(plugin.app.vault.on("delete", schedule));
  plugin.registerEvent(plugin.app.vault.on("rename", schedule));
  plugin.registerDomEvent(plugin.app.workspace.containerEl, "scroll", schedule, true);
  plugin.registerDomEvent(window, "resize", schedule);
  const observer = new MutationObserver(schedule);
  observer.observe(plugin.app.workspace.containerEl, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-path"] });
  plugin.register(() => {
    stopped = true; observer.disconnect();
    for (const item of mounts.values()) item.dispose();
    mounts.clear();
  });
  plugin.app.workspace.onLayoutReady(schedule);
}
