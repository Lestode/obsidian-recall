export function initPractice({ renderMarkdown, escapeHtml: esc, events }) {
  const root = document.querySelector("#practice");
  const library = document.querySelector("#library-layout");
  const practiceTab = document.querySelector("#practice-tab");
  const libraryTab = document.querySelector("#library-tab");
  let session = null,
    revealed = false,
    busy = false,
    lastMessage = "",
    projects = [],
    sessions = [];
  let includeUnseen = localStorage.getItem("recall.includeUnseen") !== "false";
  const api = async (path, body) => {
    const response = await fetch(
      path,
      body === undefined
        ? {}
        : {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Recall-Client": "1",
            },
            body: JSON.stringify(body),
          },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Request failed.");
    return result;
  };
  const error = (message) => {
    let node = root.querySelector(".practice-error");
    if (!node) {
      node = document.createElement("p");
      node.className = "practice-error";
      node.setAttribute("role", "alert");
      root.prepend(node);
    }
    node.textContent = message;
  };
  const run = async (fn) => {
    if (busy) return;
    busy = true;
    root.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      await fn();
    } catch (e) {
      error(e.message);
    } finally {
      busy = false;
      root.querySelectorAll("button").forEach((b) => (b.disabled = false));
    }
  };
  function tab(practice) {
    root.hidden = !practice;
    library.hidden = practice;
    practiceTab.classList.toggle("active", practice);
    libraryTab.classList.toggle("active", !practice);
  }
  async function home() {
    const data = await api("/api/review/projects");
    projects = data.projects;
    sessions = data.sessions;
    session = null;
    const due = projects
      .filter((p) => p.folderPath === p.collectionPath)
      .reduce((n, p) => n + p.due + p.ready, 0);
    root.innerHTML = `<div class="practice-heading"><div><h2>Practice</h2><p class="muted">${due ? `${due} questions ready for recall.` : "Choose a project or folder to review."}</p></div>
      <label class="unseen-toggle"><input id="include-unseen" type="checkbox" ${includeUnseen ? "checked" : ""}> Include unseen material</label></div>
      ${sessions.length ? `<section class="resume-list"><h3>Unfinished sessions</h3>${sessions.map((s) => `<button data-resume="${esc(s.id)}">Resume ${esc(s.scope.folderPath || s.scope.collectionPath || "all questions")} <span>→</span></button>`).join("")}</section>` : ""}
      <div class="project-list"><table class="project-table"><thead><tr><th scope="col">Project / folder</th><th scope="col">Ready</th><th scope="col">Unseen</th><th scope="col" class="total-column">Total</th><th scope="col"><span class="sr-only">Action</span></th></tr></thead><tbody>${projects.map((p, i) => {
        const collection = p.folderPath === p.collectionPath;
        const relative = p.folderPath.startsWith(p.collectionPath + "/") ? p.folderPath.slice(p.collectionPath.length + 1) : p.label;
        return `<tr class="${collection ? "collection-row" : "folder-row"}"><th scope="row"><span class="project-name">${esc(collection ? p.label : relative)}</span>${collection ? '<span class="project-kind">Collection</span>' : `<span class="project-kind">${esc(p.collectionPath)}</span>`}</th><td>${p.due + p.ready}</td><td>${p.unseen}</td><td class="total-column">${p.total}</td><td><button data-start="${i}" aria-label="Review ${esc(p.label)}">Review</button></td></tr>`;
      }).join("")}</tbody></table>${projects.length ? "" : '<p class="empty">No indexed collections.</p>'}</div>`;
    root.querySelector("#include-unseen").addEventListener("change", (e) => {
      includeUnseen = e.target.checked;
      localStorage.setItem("recall.includeUnseen", String(includeUnseen));
      void run(home);
    });
    root.querySelectorAll("[data-start]").forEach((b) =>
      b.addEventListener("click", () =>
        run(async () => {
          const p = projects[Number(b.dataset.start)];
          session = await api("/api/review/sessions", {
            collectionPath: p.collectionPath,
            folderPath: p.folderPath,
            includeUnseen,
          });
          revealed = false;
          lastMessage = "";
          renderSession();
        }),
      ),
    );
    root.querySelectorAll("[data-resume]").forEach((b) =>
      b.addEventListener("click", () =>
        run(async () => {
          session = await api(`/api/review/sessions/${b.dataset.resume}`);
          revealed = false;
          lastMessage = "";
          renderSession();
        }),
      ),
    );
  }
  const dueLabel = (iso) => {
    const minutes = Math.max(
      1,
      Math.round((new Date(iso) - Date.now()) / 60000),
    );
    return minutes < 60
      ? `${minutes} min`
      : minutes < 1440
        ? `${Math.round(minutes / 60)} hr`
        : `${Math.round(minutes / 1440)} days`;
  };
  function renderSession() {
    const q = session.current;
    const heading =
      session.scope.folderPath ||
      session.scope.collectionPath ||
      "All questions";
    root.innerHTML = `<div class="session-top"><button id="stop-practice">← Projects</button><span>${esc(heading)}</span><span>${session.done} completed</span></div>
      <p class="saved-message" role="status">${esc(lastMessage)}</p>
      ${
        q
          ? `<article class="focus-card"><div class="focus-context"><span class="eyebrow">${q.mode === "study" ? "FIRST STUDY" : "RECALL"}</span><span>${esc(q.topic || "")} ${q.sectionPath.length ? " / " + esc(q.sectionPath.join(" / ")) : ""}</span></div>
        ${q.changed ? '<p class="change-note">This question has changed. Review history is preserved; this session keeps its captured content.</p>' : ""}
        <div class="focus-prompt markdown">${renderMarkdown(q.prompt, q.questionId)}</div>
        ${q.mode === "study" || revealed ? `<div class="focus-answer markdown">${q.answer ? renderMarkdown(q.answer, q.questionId) : "<em>No answer written yet. You can still assess your own recall.</em>"}</div>` : '<div class="recall-space"><p>Reconstruct the essentials before revealing the answer.</p><button class="primary" id="reveal-answer">Reveal answer <kbd>Space</kbd></button></div>'}
        <div class="focus-actions">${q.mode === "study" ? '<p class="muted">Read the material, then confirm you have studied it.</p><button class="primary" id="mark-studied">✓ Studied — next <kbd>Enter</kbd></button>' : revealed ? `<p class="muted">Essentials recalled independently; minor omissions are okay.</p><div class="rating-grid">${["Again", "Hard", "Good", "Easy"].map((rating, i) => `<button class="rating rating-${rating.toLowerCase()}" data-rating="${rating}" title="${["Missing essentials, crucial error, or needed help", "Recalled with substantial effort or doubt", "Recalled with reasonable effort", "Recalled fluently with little effort"][i]}"><kbd>${i + 1}</kbd><strong>${rating}</strong><small>${dueLabel(q.preview[rating])}</small></button>`).join("")}</div>` : ""}</div>
        <div class="focus-bottom"><button id="skip-question">Skip for now</button><span>Progress saved automatically.</span></div></article>`
          : `<div class="queue-complete"><h2>This queue is complete.</h2><p>Keep going with questions that are ready now, or return later.</p><button class="primary" id="continue-practice">Check for more</button></div>`
      }`;
    root
      .querySelector("#stop-practice")
      .addEventListener("click", () => run(home));
    root.querySelector("#reveal-answer")?.addEventListener("click", () => {
      revealed = true;
      renderSession();
      root.querySelector('[data-rating="Good"]')?.focus();
    });
    root
      .querySelector("#mark-studied")
      ?.addEventListener("click", () => act("studied"));
    root
      .querySelector("#skip-question")
      ?.addEventListener("click", () => act("skip"));
    root
      .querySelectorAll("[data-rating]")
      .forEach((b) => b.addEventListener("click", () => act(b.dataset.rating)));
    root.querySelector("#continue-practice")?.addEventListener("click", () =>
      run(async () => {
        session = await api("/api/review/sessions", session.scope);
        revealed = false;
        lastMessage = "";
        renderSession();
      }),
    );
  }
  function act(action) {
    void run(async () => {
      const current = session.current;
      session = await api(`/api/review/sessions/${session.id}`, {
        position: current.sessionPosition,
        action,
      });
      lastMessage =
        action === "studied"
          ? "✓ Studied. Saved in your shared progress."
          : action === "skip"
            ? "Skipped. No assessment recorded."
            : `${action} saved. Next review scheduled.`;
      revealed = false;
      renderSession();
      root
        .querySelector("#mark-studied, #reveal-answer, #continue-practice")
        ?.focus();
    });
  }
  practiceTab.addEventListener("click", () => {
    tab(true);
    if (!session) void run(home);
  });
  libraryTab.addEventListener("click", () => tab(false));
  document.addEventListener("keydown", (e) => {
    if (
      root.hidden ||
      !session?.current ||
      busy ||
      e.repeat ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)
    )
      return;
    if (
      session.current.mode === "study" &&
      e.key === "Enter" &&
      (e.target === document.body || e.target.id === "mark-studied")
    ) {
      e.preventDefault();
      act("studied");
    } else if (
      session.current.mode === "recall" &&
      !revealed &&
      (e.code === "Space" || e.key === "Enter") &&
      (e.target === document.body || e.target.id === "reveal-answer")
    ) {
      e.preventDefault();
      revealed = true;
      renderSession();
    } else if (revealed && /^[1-4]$/.test(e.key)) {
      e.preventDefault();
      act(["Again", "Hard", "Good", "Easy"][Number(e.key) - 1]);
    }
  });
  async function update() {
    if (busy) return;
    try {
      if (!session) {
        if (!root.hidden) await home();
        return;
      }
      const updated = await api(`/api/review/sessions/${session.id}`);
      if (
        session.current?.sessionPosition !== updated.current?.sessionPosition
      ) {
        session = updated;
        revealed = false;
        renderSession();
      }
    } catch (e) {
      error(e.message);
    }
  }
  events.addEventListener("progress", () => void update());
  events.addEventListener("sync", () => void update());
  tab(true);
  void run(home);
}
