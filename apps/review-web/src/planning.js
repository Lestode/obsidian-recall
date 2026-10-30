export function openPlan(project, plans, api, esc, onSaved) {
  document.querySelector("#plan-dialog")?.remove();
  const scope = {
    collectionPath: project.collectionPath,
    folderPath: project.folderPath,
  };
  const own = plans.find(
    (p) =>
      p.collectionPath === scope.collectionPath &&
      p.folderPath === scope.folderPath,
  );
  const inherited = plans
    .filter(
      (p) =>
        p.collectionPath === scope.collectionPath &&
        (p.folderPath === "." ||
          scope.folderPath === p.folderPath ||
          scope.folderPath.startsWith(p.folderPath + "/")),
    )
    .sort((a, b) => b.folderPath.length - a.folderPath.length)[0];
  const existing = own || inherited;
  const dateKey = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const future = new Date();
  future.setDate(future.getDate() + 45);
  const dialog = document.createElement("dialog");
  dialog.id = "plan-dialog";
  dialog.className = "plan-dialog";
  dialog.innerHTML = `<div class="plan-heading"><div><h2>Target date</h2><p>${esc(project.label)}</p></div><button type="button" id="close-plan" aria-label="Close plan">×</button></div>
    <p class="muted">Aim for a Good or Easy on each question, with sufficient predicted recall at the deadline.</p>
    ${inherited && !own ? `<p class="muted">This folder inherits the plan for ${esc(inherited.folderPath)}. Saving here creates a separate folder plan.</p>` : ""}
    <form id="plan-form"><div class="plan-fields">
      <label>Target date<input id="plan-date" type="date" required min="${dateKey(new Date())}" value="${esc(existing?.targetDate || dateKey(future))}"></label>
      <label>Predicted recall threshold<select id="plan-retention">${[80, 85, 90, 95, 97].map((n) => `<option value="${n / 100}" ${Math.round((existing?.retention ?? 0.9) * 100) === n ? "selected" : ""}>${n}%</option>`).join("")}</select></label>
      <label>Unseen questions / day<input id="plan-rate" type="number" min="1" max="5000" placeholder="Automatic from date" value="${existing?.dailyNew ?? ""}"><small>Leave blank for the suggested rate.</small></label>
    </div><div id="plan-preview" aria-live="polite">Calculating workload…</div>
    <p id="plan-error" role="alert"></p>
    <div class="plan-footer">${own ? '<button type="button" id="remove-plan">Remove target date</button>' : "<span></span>"}<button class="primary" id="save-plan" disabled>Save plan</button></div></form>`;
  document.body.append(dialog);
  dialog.showModal();
  let timer,
    revision = 0,
    approved = null,
    saving = false;
  const form = dialog.querySelector("form"),
    preview = dialog.querySelector("#plan-preview"),
    save = dialog.querySelector("#save-plan"),
    error = dialog.querySelector("#plan-error");
  const close = () => {
    clearTimeout(timer);
    revision++;
    dialog.close();
    dialog.remove();
  };
  dialog.querySelector("#close-plan").onclick = close;
  dialog.addEventListener("cancel", close);
  const input = () => ({
    ...scope,
    targetDate: dialog.querySelector("#plan-date").value,
    retention: Number(dialog.querySelector("#plan-retention").value),
    dailyNew:
      dialog.querySelector("#plan-rate").value === ""
        ? null
        : Number(dialog.querySelector("#plan-rate").value),
  });
  const range = (a, b) =>
    a === b ? `${a}` : `${Math.min(a, b)}–${Math.max(a, b)}`;
  async function calculate() {
    const current = ++revision;
    approved = null;
    save.disabled = true;
    error.textContent = "";
    if (!form.checkValidity()) {
      preview.textContent = "Choose a valid date and introduction rate.";
      return;
    }
    preview.textContent = "Calculating workload…";
    const request = input();
    try {
      const p = await api("/api/review/plan/preview", request);
      if (current !== revision || !dialog.isConnected) return;
      approved = request;
      save.disabled = false;
      const daily = p.good.days.map((d, i) => ({
        ...d,
        high: p.setbacks.days[i].reviews,
      }));
      const peak = Math.max(
        1,
        ...daily.map((d) => d.study + Math.max(d.reviews, d.high)),
      );
      preview.innerHTML = `<div class="plan-stats"><div><strong>${p.daily}</strong><span>unseen / day${request.dailyNew === null ? " · suggested" : ""}</span></div><div><strong>${range(Math.ceil(p.good.totalReviews / p.days), Math.ceil(p.setbacks.totalReviews / p.days))}</strong><span>review attempts / day, average</span></div><div><strong>${p.qualifyingNow} / ${p.total}</strong><span>already meet deadline criterion</span></div></div>
      <p><strong>Today:</strong> ${p.remainingToday} unseen left to study; approximately ${range(daily[0].reviews, daily[0].high)} recall attempts. ${p.studiedToday} studied today.</p>
      <p class="muted">${p.unseen} unseen · ${p.withoutGood} still need Good/Easy evidence · ${p.days} calendar days. Suggested rate: ${p.recommended}/day, reserving ${p.reserve} day(s) for repetition.</p>
      ${p.warnings.map((w) => `<p class="change-note">${esc(w)}</p>`).join("")}
      <p><strong>Still below target at deadline:</strong> ${p.good.missed} in the Good-answer scenario; ${p.setbacks.missed} with setbacks.</p>
      <details class="plan-schedule"><summary>Daily workload through ${esc(p.plan.targetDate)}</summary><table><thead><tr><th>Date</th><th>Study</th><th>Recall attempts</th><th>Workload</th></tr></thead><tbody>${daily.map((d) => `<tr><td>${esc(d.date)}</td><td>${d.study}</td><td>${range(d.reviews, d.high)}</td><td><span class="workload-bar" style="width:${Math.round((100 * (d.study + Math.max(d.reviews, d.high))) / peak)}%"></span></td></tr>`).join("")}</tbody></table></details>
      <p class="plan-assumptions">Illustrative scenarios, not a confidence interval: future Good answers versus about ${Math.round(p.failureRate * 100)}% Again answers followed by retries. ${p.historyCount ? `Based on ${p.historyCount} recent collection attempts, smoothed with a prior.` : "No recall history yet; setbacks use a 20% starting assumption."} Includes repeated attempts. No reliable time estimate yet. FSRS predicts successful recall, not a Good rating. Dates use ${esc(p.timezone)}. Previewing does not change progress.</p>`;
    } catch (e) {
      if (current === revision) {
        error.textContent = e.message;
        preview.textContent = "Preview unavailable.";
      }
    }
  }
  form.addEventListener("input", () => {
    clearTimeout(timer);
    revision++;
    approved = null;
    save.disabled = true;
    timer = setTimeout(calculate, 250);
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!approved || saving) return;
    saving = true;
    save.disabled = true;
    try {
      await api("/api/review/plan/save", approved);
      close();
      await onSaved();
    } catch (e) {
      error.textContent = e.message;
      saving = false;
      save.disabled = false;
    }
  };
  dialog.querySelector("#remove-plan")?.addEventListener("click", async () => {
    try {
      await api("/api/review/plan/remove", scope);
      close();
      await onSaved();
    } catch (e) {
      error.textContent = e.message;
    }
  });
  void calculate();
}
