import { hashQuestionContent, type RecallQuestion } from "@recall/core";
import { StudyClient } from "./study-client";

export function mountStudyControl(
  container: HTMLElement, client: StudyClient, file: string,
  question: RecallQuestion & { id: string },
  readCurrentQuestion?: () => RecallQuestion | null,
): () => void {
  container.className = "recall-study-control";
  container.dataset.recallStudyId = question.id;
  const status = document.createElement("span");
  status.className = "recall-study-status";
  status.setAttribute("role", "status");
  const icon = document.createElement("button");
  icon.type = "button";
  icon.className = "recall-study-icon";
  const changed = document.createElement("span");
  changed.className = "recall-study-changed";
  changed.textContent = "Content changed";
  changed.hidden = true;
  container.append(icon, status, changed);
  let disposed = false;
  let hash: string | null = null;
  let indexedHash: string | undefined;
  let hashGeneration = 0;
  const updateHash = (current: RecallQuestion | null) => {
    const generation = ++hashGeneration;
    hash = null;
    if (!current) return;
    void hashQuestionContent(current.prompt, current.answer).then(value => {
      if (disposed || generation !== hashGeneration) return;
      hash = value;
      render();
    });
  };
  const render = () => {
    const snapshot = client.snapshot(file);
    const state = snapshot.states.get(question.id);
    if (readCurrentQuestion && state && state.contentHash !== indexedHash) {
      indexedHash = state.contentHash;
      updateHash(readCurrentQuestion());
    }
    const busy = client.isBusy(question.id);
    const available = !snapshot.error && hash !== null && state?.contentHash === hash;
    const studied = Boolean(state?.studiedAt);
    const contentChanged = studied && hash !== null && Boolean(state?.contentChanged || state?.studiedContentHash !== hash);
    const label = busy ? "Saving study progress" : snapshot.error ? "Study unavailable" :
      !snapshot.loaded || hash === null ? "Loading study progress" : !available ? "Waiting for sync" :
      studied ? "Studied" : "Not studied";
    status.textContent = label + (contentChanged ? " · Content changed" : "");
    icon.textContent = busy || hash === null ? "…" : available ? studied ? "✓" : "" : "?";
    icon.classList.toggle("is-studied", available && studied);
    icon.classList.toggle("is-unknown", !available);
    icon.setAttribute("aria-label", label);
    if (available) icon.setAttribute("aria-pressed", String(studied));
    else icon.removeAttribute("aria-pressed");
    icon.title = snapshot.error ? `${snapshot.error} Click to retry.` : !available ?
      `${label}. Click to retry synchronization.` :
      `${label}${contentChanged ? " · Content changed" : ""}. Click to mark ${studied ? "not studied" : "studied"}.`;
    icon.disabled = busy || hash === null;
    changed.hidden = !contentChanged;
  };
  icon.addEventListener("click", () => {
    void (async () => {
      const snapshot = client.snapshot(file);
      if (snapshot.error || snapshot.states.get(question.id)?.contentHash !== hash) {
        await client.load(file);
        return;
      }
      if (hash) await client.toggleStudied(file, question.id, hash);
    })();
  });
  const unsubscribe = client.subscribe(file, render);
  updateHash(question);
  void client.load(file);
  render();
  return () => { disposed = true; unsubscribe(); };
}
