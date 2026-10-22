import { hashQuestionContent } from "@recall/core";
import type { RecallQuestion } from "@recall/core";
import { StudyClient } from "./study-client";

export function mountStudyControl(
  container: HTMLElement, client: StudyClient, file: string,
  question: RecallQuestion & { id: string }, advance: () => void,
  readCurrentQuestion?: () => RecallQuestion | null,
): () => void {
  container.className = "recall-study-control";
  container.dataset.recallStudyId = question.id;
  const status = document.createElement("span");
  status.setAttribute("role", "status");
  const action = document.createElement("button");
  action.type = "button";
  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "Next →";
  next.title = "Skip to the next question without changing study progress";
  next.addEventListener("click", advance);
  const undo = document.createElement("button");
  undo.type = "button";
  undo.textContent = "Undo study";
  container.append(status, action, next, undo);
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
    status.textContent = busy ? "Saving…" : snapshot.error ? "Study unavailable" :
      !snapshot.loaded || hash === null ? "Loading study…" :
      studied ? `✓ Studied${state?.contentChanged || state?.studiedContentHash !== hash ? " · Content changed" : ""}` :
      available ? "Not studied" : "Waiting for sync";
    container.title = snapshot.error ?? (available ? "Study progress is saved separately from this note" : "Wait for synchronization, then retry");
    action.textContent = available ? "Mark studied →" : "Retry";
    action.hidden = Boolean(available && studied);
    action.disabled = busy || hash === null;
    next.disabled = busy;
    undo.hidden = !available || !studied;
    undo.disabled = busy;
  };
  action.addEventListener("click", () => {
    void (async () => {
      const snapshot = client.snapshot(file);
      if (snapshot.error || snapshot.states.get(question.id)?.contentHash !== hash) {
        await client.load(file);
        return;
      }
      if (hash && await client.setStudied(file, question.id, hash, true) && !disposed) {
        advance();
        // At the last question keep keyboard focus on the available Next control.
        if (action.hidden && container.contains(document.activeElement)) next.focus();
      }
    })();
  });
  undo.addEventListener("click", () => {
    void (async () => {
      if (hash && await client.setStudied(file, question.id, hash, false) && !disposed) action.focus();
    })();
  });
  const unsubscribe = client.subscribe(file, render);
  updateHash(question);
  void client.load(file);
  render();
  return () => { disposed = true; unsubscribe(); };
}

export function focusStudyControl(root: ParentNode, id: string): boolean {
  const control = Array.from(root.querySelectorAll<HTMLElement>(".recall-study-control"))
    .find(element => element.dataset.recallStudyId === id);
  if (!control) return false;
  control.scrollIntoView({ block: "center" });
  const button = Array.from(control.querySelectorAll<HTMLButtonElement>("button"))
    .find(element => !element.hidden && !element.disabled);
  button?.focus();
  return Boolean(button);
}
