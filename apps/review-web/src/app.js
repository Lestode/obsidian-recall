import DOMPurify from "dompurify";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";

marked.use(markedKatex({ throwOnError: false, output: "mathml", nonStandard: true }));

const state = {
  collection: null,
  questions: [],
  vaultName: "",
  includeArchived: false,
};

const elements = {
  archived: document.querySelector("#include-archived"),
  collections: document.querySelector("#collections"),
  diagnostic: document.querySelector("#diagnostic"),
  questions: document.querySelector("#questions"),
  rescan: document.querySelector("#rescan"),
  revision: document.querySelector("#revision"),
  scopeLabel: document.querySelector("#scope-label"),
  scopeTitle: document.querySelector("#scope-title"),
  search: document.querySelector("#search"),
  sync: document.querySelector("#sync-state"),
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderMarkdown(source) {
  const rendered = marked.parse(source || "");
  return DOMPurify.sanitize(rendered, { USE_PROFILES: { html: true, mathMl: true } });
}

function obsidianUrl(filePath) {
  return `obsidian://open?vault=${encodeURIComponent(state.vaultName)}&file=${encodeURIComponent(filePath)}`;
}

function folderFromQuestion(question) {
  const slash = question.filePath.lastIndexOf("/");
  const folder = slash < 0 ? "." : question.filePath.slice(0, slash);
  if (question.collectionPath === ".") return folder;
  if (folder === question.collectionPath) return ".";
  return folder.startsWith(`${question.collectionPath}/`)
    ? folder.slice(question.collectionPath.length + 1)
    : folder;
}

function sortQuestions(questions) {
  return questions.sort((left, right) =>
    left.collectionPath.localeCompare(right.collectionPath)
      || left.filePath.localeCompare(right.filePath)
      || left.questionOrdinal - right.questionOrdinal);
}

function renderQuestions() {
  const query = elements.search.value.trim().toLowerCase();
  const visible = state.questions.filter((question) => {
    if (!query) return true;
    return `${question.prompt}\n${question.answer}\n${question.topic}\n${question.filePath}`
      .toLowerCase().includes(query);
  });
  if (!visible.length) {
    elements.questions.innerHTML = '<div class="empty">No matching Recall questions.</div>';
    return;
  }
  let previousFile = "";
  elements.questions.innerHTML = visible.map((question) => {
    const fileHeading = question.filePath === previousFile ? "" : `
      <div class="file-heading">
        <div>
          <span>${escapeHtml(question.collectionPath)} / ${escapeHtml(folderFromQuestion(question))}</span>
          <strong>${escapeHtml(question.topic)}</strong>
          <small>${escapeHtml(question.filePath)}</small>
        </div>
        <a href="${obsidianUrl(question.filePath)}">Open in Obsidian</a>
      </div>`;
    previousFile = question.filePath;
    const section = question.sectionPath.length
      ? `<p class="section-path">${question.sectionPath.map(escapeHtml).join(" / ")}</p>`
      : "";
    return `${fileHeading}
      <article class="question-card">
        <div class="question-meta"><span class="status ${question.status}">${question.status}</span><span>#${question.questionOrdinal + 1}</span></div>
        ${section}
        <div class="markdown question-prompt">${renderMarkdown(question.prompt)}</div>
        <details><summary>Show answer</summary><div class="answer markdown">${question.answer ? renderMarkdown(question.answer) : "<em>No answer yet.</em>"}</div></details>
      </article>`;
  }).join("");
}

function questionParameters(includeFiles = []) {
  const parameters = new URLSearchParams();
  if (state.collection) parameters.set("collection", state.collection);
  if (state.includeArchived) parameters.set("archived", "1");
  includeFiles.forEach((filePath) => parameters.append("file", filePath));
  const query = parameters.toString();
  return query ? `?${query}` : "";
}

async function loadQuestions() {
  const response = await fetch(`/api/questions${questionParameters()}`);
  const payload = await response.json();
  state.questions = payload.questions;
  elements.revision.textContent = `revision ${payload.revision}`;
  renderQuestions();
}

async function loadCollections() {
  const archived = state.includeArchived ? "?archived=1" : "";
  const response = await fetch(`/api/collections${archived}`);
  const payload = await response.json();
  const allCount = payload.collections.reduce((sum, collection) => sum + collection.questionCount, 0);
  const items = [{ collectionPath: null, questionCount: allCount, newCount: 0 }, ...payload.collections];
  elements.collections.innerHTML = items.map((collection) => {
    const selected = collection.collectionPath === state.collection;
    const title = collection.collectionPath ?? "All collections";
    return `<button class="collection ${selected ? "selected" : ""}" data-collection="${escapeHtml(collection.collectionPath ?? "")}">
      <span><strong>${escapeHtml(title)}</strong><small>${collection.newCount ? `${collection.newCount} new` : "Indexed"}</small></span>
      <b>${collection.questionCount}</b>
    </button>`;
  }).join("");
  elements.collections.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", async () => {
      state.collection = button.dataset.collection || null;
      elements.scopeLabel.textContent = state.collection ? "COLLECTION" : "ALL QUESTIONS";
      elements.scopeTitle.textContent = state.collection ?? "Library";
      await Promise.all([loadCollections(), loadQuestions()]);
    });
  });
}

function renderDiagnostics(error) {
  elements.diagnostic.hidden = !error;
  if (!error) {
    elements.diagnostic.replaceChildren();
    return;
  }
  const diagnostics = error.diagnostics || [];
  if (!diagnostics.length) {
    elements.diagnostic.textContent = error.message || "Synchronization failed.";
    return;
  }
  elements.diagnostic.innerHTML = `<strong>Synchronization needs attention</strong><ul>${diagnostics.map((item) => {
    const location = `${item.filePath}${item.line ? `:${item.line}` : ""}`;
    return `<li><b>${escapeHtml(location)}</b> — ${escapeHtml(item.message)}</li>`;
  }).join("")}</ul>`;
}

async function loadStatus() {
  const response = await fetch("/api/status");
  const status = await response.json();
  state.vaultName = status.vaultName;
  const error = status.lastSyncEvent?.type === "error" ? status.lastSyncEvent : null;
  elements.sync.textContent = error ? "Sync needs attention" : `${status.activeQuestions} questions indexed`;
  elements.sync.classList.toggle("error", Boolean(error));
  renderDiagnostics(error);
}

async function refresh() {
  await loadStatus();
  await Promise.all([loadCollections(), loadQuestions()]);
}

async function refreshAffectedFiles(filePaths, revision) {
  const parameters = new URLSearchParams();
  parameters.set("archived", "1");
  if (state.collection) parameters.set("collection", state.collection);
  filePaths.forEach((filePath) => parameters.append("file", filePath));
  const response = await fetch(`/api/questions?${parameters}`);
  const payload = await response.json();
  const affected = new Set(filePaths);
  const changed = payload.questions.filter((question) => state.includeArchived || !question.archivedAt);
  const changedIds = new Set(changed.map((question) => question.id));
  const kept = state.questions.filter((question) =>
    !affected.has(question.filePath) && !changedIds.has(question.id));
  state.questions = sortQuestions([...kept, ...changed]);
  elements.revision.textContent = `revision ${revision ?? payload.revision}`;
  renderQuestions();
  await Promise.all([loadStatus(), loadCollections()]);
}

elements.search.addEventListener("input", renderQuestions);
elements.archived.addEventListener("change", async () => {
  state.includeArchived = elements.archived.checked;
  await Promise.all([loadCollections(), loadQuestions()]);
});
elements.rescan.addEventListener("click", async () => {
  elements.rescan.disabled = true;
  elements.rescan.textContent = "Rescan requested…";
  try {
    await fetch("/api/rescan", { method: "POST" });
  } finally {
    elements.rescan.disabled = false;
    elements.rescan.textContent = "Rescan vault";
  }
});

const events = new EventSource("/api/events");
events.addEventListener("sync", (message) => {
  const event = JSON.parse(message.data);
  if (event.type === "error") {
    void loadStatus();
  } else if (event.full) {
    void refresh();
  } else {
    void refreshAffectedFiles(event.filePaths, event.revision);
  }
});
events.addEventListener("open", () => { elements.sync.textContent = "Connected"; });
events.addEventListener("error", () => { elements.sync.textContent = "Reconnecting…"; });

await refresh();
