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
  const button = document.createElement("button");
  button.type = "button";
  button.className = "recall-study-toggle";
  const changed = document.createElement("span");
  changed.className = "recall-study-changed";
  changed.textContent = "Content changed";
  changed.hidden = true;
  container.append(button, status, changed);
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
    const label = busy ? "Saving…" : snapshot.error ? "Unavailable" :
      !snapshot.loaded || hash === null ? "Loading…" : !available ? "Syncing…" :
      studied ? "Reviewed" : "Not reviewed";
    status.textContent = label + (contentChanged ? " · Content changed" : "");
    button.textContent = label;
    button.classList.toggle("is-studied", available && studied);
    button.classList.toggle("is-unknown", !available);
    button.setAttribute("aria-label", label);
    if (available) button.setAttribute("aria-pressed", String(studied));
    else button.removeAttribute("aria-pressed");
    button.title = snapshot.error ? `${snapshot.error} Click to retry.` : !available ?
      `${label}. Click to retry synchronization.` :
      `${label}${contentChanged ? " · Content changed" : ""}. Click to mark ${studied ? "not reviewed" : "reviewed"}.`;
    button.disabled = busy || hash === null;
    changed.hidden = !contentChanged;
  };
  button.addEventListener("click", () => {
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
