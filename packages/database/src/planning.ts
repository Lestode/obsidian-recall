import { recallProbability, schedule } from "@recall/scheduler";
import type { RecallDatabase } from "./index";

export class PlanError extends Error {
  readonly status = 400;
}
export interface PlanScope {
  collectionPath: string;
  folderPath: string;
}
export interface Plan extends PlanScope {
  targetDate: string;
  retention: number;
  dailyNew: number | null;
}
interface Item {
  id: string;
  studiedAt: string | null;
  card: string | null;
  good: boolean;
}
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function dayStart(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
function dayAfter(date: Date, n = 1) {
  const d = dayStart(date);
  d.setDate(d.getDate() + n);
  return d;
}
function deadline(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new PlanError("Choose a valid target date.");
  const d = new Date(value + "T00:00:00");
  if (!Number.isFinite(+d) || dateKey(d) !== value)
    throw new PlanError("Choose a valid target date.");
  d.setHours(23, 59, 59, 999);
  return d;
}
function covers(parent: PlanScope, child: PlanScope) {
  return (
    parent.collectionPath === child.collectionPath &&
    (parent.folderPath === "." ||
      child.folderPath === parent.folderPath ||
      child.folderPath.startsWith(parent.folderPath + "/"))
  );
}
function qualified(item: Item, end: Date, retention: number) {
  return (
    !!item.studiedAt &&
    item.good &&
    recallProbability(item.card, end) >= retention
  );
}
/** Earliest intervention, retaining ordinary FSRS due times and adding deadline checks. */
function nextReview(item: Item, now: Date, end: Date, retention: number): Date {
  if (!item.studiedAt) return new Date(Infinity);
  const available = item.card
    ? now
    : new Date(Math.max(+now, +dayAfter(new Date(item.studiedAt))));
  if (!item.card) return available;
  const card = JSON.parse(item.card);
  let next = Math.max(+available, +new Date(card.due));
  if (!qualified(item, end, retention)) {
    next = Math.min(next, Math.max(+available, +dayStart(end)));
    if (recallProbability(item.card, available) < retention) next = +available;
    else if (recallProbability(item.card, end) < retention) {
      let low = +available,
        high = +end;
      for (let i = 0; i < 18; i++) {
        const mid = (low + high) / 2;
        if (recallProbability(item.card, new Date(mid)) < retention) high = mid;
        else low = mid;
      }
      next = Math.min(next, high);
    }
  }
  return new Date(next);
}
export class PlanStore {
  constructor(readonly db: RecallDatabase) {
    db.connection.exec(`CREATE TABLE IF NOT EXISTS review_plans (
      collection_path TEXT NOT NULL, folder_path TEXT NOT NULL, target_date TEXT NOT NULL,
      retention REAL NOT NULL, daily_new INTEGER, updated_at TEXT NOT NULL,
      PRIMARY KEY(collection_path,folder_path)
    );`);
  }
  list(): Plan[] {
    return this.db.connection
      .prepare("SELECT * FROM review_plans")
      .all()
      .map((r) => ({
        collectionPath: String(r.collection_path),
        folderPath: String(r.folder_path),
        targetDate: String(r.target_date),
        retention: Number(r.retention),
        dailyNew: r.daily_new === null ? null : Number(r.daily_new),
      }));
  }
  effective(scope: PlanScope) {
    return (
      this.list()
        .filter((p) => covers(p, scope))
        .sort((a, b) => b.folderPath.length - a.folderPath.length)[0] ?? null
    );
  }
  validateScope(value: Record<string, unknown>): PlanScope {
    const { collectionPath, folderPath } = value;
    if (
      typeof collectionPath !== "string" ||
      typeof folderPath !== "string" ||
      !collectionPath ||
      !folderPath ||
      collectionPath.length > 2048 ||
      folderPath.length > 2048
    )
      throw new PlanError("Select a collection or folder.");
    if (
      collectionPath !== "." &&
      folderPath !== collectionPath &&
      !folderPath.startsWith(collectionPath + "/")
    )
      throw new PlanError("Folder must belong to the selected collection.");
    return { collectionPath, folderPath };
  }
  validate(value: Record<string, unknown>, now = new Date()): Plan {
    const scope = this.validateScope(value);
    if (typeof value.targetDate !== "string")
      throw new PlanError("Choose a target date.");
    const end = deadline(value.targetDate);
    if (+end < +now || +end > +dayAfter(now, 366))
      throw new PlanError("Choose a date from today through one year ahead.");
    const retention = value.retention ?? 0.9,
      dailyNew = value.dailyNew ?? null;
    if (
      typeof retention !== "number" ||
      !Number.isFinite(retention) ||
      retention < 0.8 ||
      retention > 0.97
    )
      throw new PlanError("Recall threshold must be between 80% and 97%.");
    if (
      dailyNew !== null &&
      (typeof dailyNew !== "number" ||
        !Number.isInteger(dailyNew) ||
        dailyNew < 1 ||
        dailyNew > 5000)
    )
      throw new PlanError("Daily introductions must be 1–5000, or automatic.");
    return {
      ...scope,
      targetDate: value.targetDate,
      retention,
      dailyNew: dailyNew as number | null,
    };
  }
  save(value: Record<string, unknown>, now = new Date()) {
    const p = this.validate(value, now);
    if (!this.items(p).length)
      throw new PlanError("This scope has no active questions.");
    this.db.connection
      .prepare(
        `INSERT INTO review_plans VALUES(?,?,?,?,?,?) ON CONFLICT(collection_path,folder_path) DO UPDATE SET target_date=excluded.target_date,retention=excluded.retention,daily_new=excluded.daily_new,updated_at=excluded.updated_at`,
      )
      .run(
        p.collectionPath,
        p.folderPath,
        p.targetDate,
        p.retention,
        p.dailyNew,
        now.toISOString(),
      );
    return p;
  }
  remove(scope: PlanScope) {
    this.db.connection
      .prepare(
        "DELETE FROM review_plans WHERE collection_path=? AND folder_path=?",
      )
      .run(scope.collectionPath, scope.folderPath);
  }
  private items(scope: PlanScope): Item[] {
    return this.db.connection
      .prepare(
        `SELECT q.id,q.file_path,s.studied_at,f.card_json,
      (SELECT MAX(e.reviewed_at) FROM review_events e WHERE e.question_id=q.id AND e.content_hash=q.content_hash AND e.outcome IN ('Good','Easy')) good_at,
      (SELECT MAX(e.reviewed_at) FROM review_events e WHERE e.question_id=q.id AND e.outcome='Again') failed_at
      FROM questions q LEFT JOIN study_state s ON q.id=s.question_id LEFT JOIN fsrs_cards f ON q.id=f.question_id
      WHERE q.archived_at IS NULL AND q.collection_path=? ORDER BY q.file_path,q.question_ordinal`,
      )
      .all(scope.collectionPath)
      .filter(
        (r) =>
          scope.folderPath === "." ||
          String(r.file_path).startsWith(scope.folderPath + "/"),
      )
      .map((r) => ({
        id: String(r.id),
        studiedAt: r.studied_at ? String(r.studied_at) : null,
        card: r.card_json ? String(r.card_json) : null,
        good:
          !!r.good_at &&
          (!r.failed_at || String(r.good_at) > String(r.failed_at)),
      }));
  }
  private rate(items: Item[], p: Plan, now: Date) {
    const end = deadline(p.targetDate);
    const days = Math.max(
      1,
      Math.round(
        (Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) -
          Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) /
          86400000,
      ) + 1,
    );
    const reserve = Math.min(7, Math.max(1, Math.ceil(days * 0.2)));
    const introductionDays = Math.max(1, days - reserve);
    const studiedToday = items.filter(
      (i) => i.studiedAt && dateKey(new Date(i.studiedAt)) === dateKey(now),
    ).length;
    const unseen = items.filter((i) => !i.studiedAt).length;
    const recommended = Math.ceil((unseen + studiedToday) / introductionDays);
    const daily = p.dailyNew ?? recommended;
    return {
      days,
      reserve,
      introductionDays,
      unseen,
      studiedToday,
      recommended,
      daily,
      remainingToday: Math.max(0, daily - studiedToday),
    };
  }
  selection(scope: PlanScope, now = new Date()) {
    const plan = this.effective(scope);
    if (!plan || plan.targetDate < dateKey(now)) return null;
    // The allowance is shared across a covering plan, including study in Obsidian.
    const items = this.items(plan),
      rate = this.rate(items, plan, now),
      end = deadline(plan.targetDate);
    return {
      plan,
      rate,
      recallIds: new Set(
        items
          .filter((i) => +nextReview(i, now, end, plan.retention) <= +now)
          .map((i) => i.id),
      ),
    };
  }
  preview(value: Record<string, unknown>, now = new Date()) {
    const plan = this.validate(value, now),
      items = this.items(plan),
      end = deadline(plan.targetDate),
      rate = this.rate(items, plan, now);
    if (items.length > 5000)
      throw new PlanError(
        "Select a smaller scope (up to 5,000 questions) for a forecast.",
      );
    const stats = this.db.connection
      .prepare(
        `SELECT outcome,COUNT(*) n FROM (SELECT e.outcome FROM review_events e JOIN questions q ON q.id=e.question_id WHERE q.collection_path=? ORDER BY e.reviewed_at DESC LIMIT 200) GROUP BY outcome`,
      )
      .all(plan.collectionPath);
    const count = stats.reduce((n, r) => n + Number(r.n), 0),
      failures = Number(stats.find((r) => r.outcome === "Again")?.n ?? 0);
    const failureRate = Math.max(
      0.1,
      Math.min(0.5, (failures + 4) / (count + 20)),
    );
    const simulate = (setbacks: boolean) => {
      const days = Array.from({ length: rate.days }, (_, i) => ({
        date: dateKey(dayAfter(now, i)),
        study: 0,
        reviews: 0,
      }));
      let unseenIndex = 0,
        missed = 0,
        sequence = 0,
        capped = false;
      for (const original of items) {
        const item = { ...original };
        let available = new Date(now);
        if (!item.studiedAt) {
          let index = unseenIndex++;
          const day =
            index < rate.remainingToday
              ? 0
              : 1 +
                Math.floor(
                  (index - rate.remainingToday) / Math.max(1, rate.daily),
                );
          if (!rate.daily || day >= days.length) {
            missed++;
            continue;
          }
          days[day]!.study++;
          item.studiedAt = new Date(
            Math.max(+now, +dayAfter(now, day)),
          ).toISOString();
          available = dayAfter(new Date(item.studiedAt));
        }
        let attempts = 0;
        while (true) {
          const at = nextReview(item, available, end, plan.retention);
          if (+at > +end || !Number.isFinite(+at)) break;
          const index = days.findIndex((d) => d.date === dateKey(at));
          if (index < 0) break;
          if (++attempts > rate.days * 12) {
            capped = true;
            break;
          }
          const failed =
            setbacks &&
            ++sequence % Math.max(2, Math.round(1 / failureRate)) === 0;
          item.card = JSON.stringify(
            schedule(item.card, failed ? "Again" : "Good", at),
          );
          item.good = !failed;
          days[index]!.reviews++;
          // Avoid an instantaneous repeated attempt when the threshold is not yet met.
          available = new Date(+at + 60000);
        }
        if (!qualified(item, end, plan.retention)) missed++;
      }
      return {
        days,
        missed,
        capped,
        totalReviews: days.reduce((n, d) => n + d.reviews, 0),
      };
    };
    const good = simulate(false),
      setbacks = simulate(true);
    return {
      plan,
      ...rate,
      total: items.length,
      qualifyingNow: items.filter((i) => qualified(i, end, plan.retention))
        .length,
      withoutGood: items.filter((i) => !i.good).length,
      recallAtRisk: items.filter(
        (i) => i.studiedAt && !qualified(i, end, plan.retention),
      ).length,
      good,
      setbacks,
      failureRate,
      historyCount: count,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      warnings: [
        ...(rate.days < 3
          ? [
              "Very short deadline: little time for independent recall and repetition.",
            ]
          : []),
        ...(good.missed
          ? [
              "Even the Good-answer scenario leaves questions below the target. Increase introductions or choose a later date.",
            ]
          : []),
        ...(good.capped || setbacks.capped
          ? [
              "Simulation limit reached for difficult questions; workload may be understated.",
            ]
          : []),
      ],
    };
  }
}
