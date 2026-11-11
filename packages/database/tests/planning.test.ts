import assert from "node:assert/strict";
import test from "node:test";
import { RecallDatabase, ReviewStore, PlanError } from "../src/index";
import { recallProbability, schedule } from "@recall/scheduler";
import { dateKey } from "../src/planning";
const now = new Date(2026, 9, 30, 12);
const scope = { collectionPath: "Course", folderPath: "Course" };
const plan = {
  ...scope,
  targetDate: "2026-12-14",
  retention: 0.9,
  dailyNew: null,
};
function setup(count = 5) {
  const db = new RecallDatabase(":memory:");
  const store = new ReviewStore(db);
  db.reconcileFull(
    Array.from({ length: count }, (_, i) => ({
      id: `q${i}`,
      collectionPath: "Course",
      filePath: "Course/Topic.md",
      topic: "Topic",
      sectionPath: [],
      questionOrdinal: i,
      prompt: `Q ${i}`,
      answer: "A",
      contentHash: `h${i}`,
    })),
  );
  return { db, store, plans: store.plans };
}
test("forecast is read-only, date-driven, and exposes daily studies and repeat reviews", () => {
  const { db, plans } = setup(12);
  try {
    const before = db.connection
      .prepare("SELECT count(*) n FROM review_events")
      .get()!.n;
    const forecast = plans.preview(plan, now);
    assert.equal(forecast.total, 12);
    assert.equal(forecast.qualifyingNow, 0);
    assert.equal(
      forecast.good.days.reduce((n, d) => n + d.study, 0),
      12,
    );
    assert.ok(forecast.good.totalReviews >= 12);
    assert.ok(forecast.setbacks.totalReviews >= forecast.good.totalReviews);
    assert.equal(forecast.good.days[0]!.reviews, 0);
    assert.ok(
      plans.preview({ ...plan, targetDate: "2026-11-03" }, now).recommended >
        forecast.recommended,
    );
    assert.equal(plans.list().length, 0);
    assert.equal(
      db.connection.prepare("SELECT count(*) n FROM review_events").get()!.n,
      before,
    );
  } finally {
    db.close();
  }
});
test("saving, editing and removing plans preserve recall history", () => {
  const { db, store, plans } = setup();
  try {
    store.markStudied("q0", "h0", true, new Date(2026, 9, 29, 12));
    const session = store.start(
      { collectionPath: "Course", includeUnseen: false },
      now,
    );
    store.act(session.id, 0, "Good", now);
    const before = store.progress("q0");
    plans.save(plan, now);
    plans.save({ ...plan, targetDate: "2026-12-01", dailyNew: 2 }, now);
    assert.equal(plans.list().length, 1);
    assert.equal(plans.list()[0]!.dailyNew, 2);
    plans.remove(scope);
    assert.equal(plans.list().length, 0);
    assert.deepEqual(store.progress("q0"), before);
  } finally {
    db.close();
  }
});
test("today allowance is shared with Obsidian and does not reset on queue restart", () => {
  const { db, store, plans } = setup();
  try {
    plans.save({ ...plan, dailyNew: 2 }, now);
    let session = store.start({ ...scope, includeUnseen: true }, now);
    assert.equal(session.items.length, 2);
    store.act(session.id, 0, "studied", now);
    db.setStudied(
      {
        questionId: "q1",
        filePath: "Course/Topic.md",
        contentHash: "h1",
        studied: true,
        expectedRevision: null,
      },
      now.toISOString(),
    );
    session = store.start({ ...scope, includeUnseen: true }, now);
    assert.equal(session.items.length, 0);
    assert.equal(
      plans.preview({ ...plan, dailyNew: 2 }, now).remainingToday,
      0,
    );
    const tomorrow = new Date(2026, 9, 31, 12);
    session = store.start({ ...scope, includeUnseen: true }, tomorrow);
    assert.equal(session.items.filter((i) => i.mode === "recall").length, 2);
    assert.equal(session.items.filter((i) => i.mode === "study").length, 2);
    assert.equal(
      store.start({ ...scope, includeUnseen: false }, tomorrow).items.length,
      2,
    );
  } finally {
    db.close();
  }
});
test("short dates and low overrides expose unmet coverage; invalid input is rejected", () => {
  const { db, plans } = setup(50);
  try {
    const short = plans.preview(
      { ...plan, targetDate: dateKey(now), dailyNew: 1 },
      now,
    );
    assert.equal(short.good.missed, 50);
    assert.ok(short.warnings.length);
    for (const bad of [
      { targetDate: "2026-02-30" },
      { targetDate: "2026-10-29" },
      { targetDate: "2030-01-01" },
      { retention: 1 },
      { dailyNew: 0 },
      { dailyNew: 1.2 },
      { folderPath: "Other" },
    ])
      assert.throws(() => plans.preview({ ...plan, ...bad }, now), PlanError);
  } finally {
    db.close();
  }
});
test("plan inheritance, child overrides, and expired plans have explicit scope", () => {
  const { db, plans } = setup();
  try {
    plans.save(plan, now);
    assert.equal(
      plans.effective({ ...scope, folderPath: "Course/Sub" })?.targetDate,
      plan.targetDate,
    );
    assert.equal(
      plans.effective({ collectionPath: "Other", folderPath: "Other" }),
      null,
    );
    assert.equal(plans.selection(scope, new Date(2026, 11, 15, 12)), null);
  } finally {
    db.close();
  }
});
test("Good evidence is content-specific; predicted recall is not a Good assessment", () => {
  const { db, store, plans } = setup(1);
  try {
    store.markStudied("q0", "h0", true, new Date(2026, 9, 29, 12));
    const s = store.start({ ...scope, includeUnseen: false }, now);
    store.act(s.id, 0, "Good", now);
    const short = { ...plan, targetDate: dateKey(now), retention: 0.8 };
    assert.equal(plans.preview(short, now).withoutGood, 0);
    db.connection
      .prepare("UPDATE questions SET content_hash='edited' WHERE id='q0'")
      .run();
    assert.equal(plans.preview(short, now).withoutGood, 1);
    assert.ok(recallProbability(store.progress("q0").card, now) > 0.8);
  } finally {
    db.close();
  }
});
test("at-risk recall is selected even when ordinary due date is beyond deadline", () => {
  const { db, store, plans } = setup(1);
  try {
    const earlier = new Date(2026, 8, 1, 12);
    store.markStudied("q0", "h0", true, earlier);
    const s = store.start({ ...scope, includeUnseen: false }, earlier);
    store.act(s.id, 0, "Good", earlier);
    db.connection
      .prepare("UPDATE review_state SET due_at='2027-01-01T00:00:00Z'")
      .run();
    const card = JSON.parse(store.progress("q0").card!);
    card.due = "2027-01-01T00:00:00Z";
    db.connection
      .prepare("UPDATE fsrs_cards SET card_json=?")
      .run(JSON.stringify(card));
    assert.equal(
      store.start({ ...scope, includeUnseen: false }, now).items.length,
      0,
    );
    plans.save(plan, now);
    assert.equal(
      store.start({ ...scope, includeUnseen: false }, now).items.length,
      1,
    );
  } finally {
    db.close();
  }
});
test("FSRS recall probability decays with elapsed time", () => {
  const card = JSON.stringify(schedule(null, "Good", now));
  assert.equal(recallProbability(null, now), 0);
  assert.ok(
    recallProbability(card, now) >
      recallProbability(card, new Date(2026, 11, 14, 12)),
  );
});
