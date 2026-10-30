import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  RecallDatabase,
  ReviewStore,
  type IndexedQuestionRecord,
} from "../src/index";
const now = new Date("2026-10-30T12:00:00Z");
const record = (id = "q1", hash = "v1"): IndexedQuestionRecord => ({
  id,
  contentHash: hash,
  collectionPath: "Course",
  filePath: "Course/Topic.md",
  topic: "Topic",
  sectionPath: [],
  questionOrdinal: Number(id.slice(1)) || 0,
  prompt: `Prompt ${hash}`,
  answer: "Answer",
});
const scope = { collectionPath: "Course", includeUnseen: true };
function setup() {
  const db = new RecallDatabase(":memory:");
  db.reconcileFull([record()]);
  return { db, store: new ReviewStore(db) };
}

test("study persists without manufacturing a recall and survives reindexing and reopening", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "recall-study-"));
  try {
    let db = new RecallDatabase(path.join(dir, "test.sqlite"));
    db.reconcileFull([record()]);
    let store = new ReviewStore(db);
    const session = store.start(scope, now);
    assert.equal(session.current?.mode, "study");
    store.act(session.id, 0, "studied", now);
    assert.equal(
      db.connection.prepare("SELECT count(*) AS n FROM review_events").get()?.n,
      0,
    );
    db.reconcileFull([
      { ...record(), filePath: "Other/Moved.md", collectionPath: "Other" },
    ]);
    db.close();
    db = new RecallDatabase(path.join(dir, "test.sqlite"));
    store = new ReviewStore(db);
    assert.equal(store.progress("q1").studiedAt, now.toISOString());
    assert.equal(store.progress("q1").card, null);
    assert.equal(
      store.start({ includeUnseen: false }, now).current?.mode,
      "recall",
    );
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recall stores FSRS state and immutable events, exact retries are idempotent", () => {
  const { db, store } = setup();
  try {
    store.markStudied("q1", "v1", true, now);
    const s = store.start(scope, now);
    assert.equal(s.current?.mode, "recall");
    assert.ok(s.current?.preview?.Good);
    assert.equal(
      store.act(s.id, 0, "Good", now).completedAt,
      now.toISOString(),
    );
    const q = db.getQuestion("q1")!;
    assert.equal(q.lastReviewedAt, now.toISOString());
    assert.equal(q.lastReviewedHash, "v1");
    assert.ok(new Date(q.dueAt!).getTime() > now.getTime());
    store.act(s.id, 0, "Good", now);
    assert.equal(
      db.connection.prepare("SELECT count(*) AS n FROM review_events").get()?.n,
      1,
    );
    assert.equal(
      db.connection
        .prepare("SELECT count(*) AS n FROM fsrs_event_details")
        .get()?.n,
      1,
    );
    assert.equal(store.start(scope, now).current, null);
    assert.equal(
      store.start(scope, new Date(q.dueAt!)).current?.mode,
      "recall",
    );
  } finally {
    db.close();
  }
});

test("concurrent sessions reject stale ratings and allow skipping without duplicate history", () => {
  const { db, store } = setup();
  try {
    store.markStudied("q1", "v1", true, now);
    const a = store.start(scope, now),
      b = store.start(scope, now);
    store.act(a.id, 0, "Again", now);
    assert.throws(() => store.act(b.id, 0, "Good", now), /another session/);
    assert.equal(store.session(b.id).current?.sessionPosition, 0);
    store.act(b.id, 0, "skip", now);
    assert.equal(store.progress("q1").version, 1);
    assert.equal(
      db.connection.prepare("SELECT count(*) AS n FROM review_events").get()?.n,
      1,
    );
  } finally {
    db.close();
  }
});

test("snapshot grades its captured version, outdated first study is rejected, archived items skipped", () => {
  const { db, store } = setup();
  try {
    const study = store.start(scope, now);
    db.reconcileFull([record("q1", "v2")]);
    assert.throws(() => store.act(study.id, 0, "studied", now), /changed/);
    store.markStudied("q1", "v2", true, now);
    const recall = store.start(scope, now);
    db.reconcileFull([record("q1", "v3")]);
    store.act(recall.id, 0, "Good", now);
    assert.equal(db.getQuestion("q1")?.lastReviewedHash, "v2");
    assert.equal(db.getQuestion("q1")?.status, "changed");
    const later = store.start(scope, new Date("2026-11-01T12:00:00Z"));
    db.reconcileFull([]);
    assert.equal(store.session(later.id).current, null);
  } finally {
    db.close();
  }
});

test("unseen toggle excludes initial study and undo preserves history", () => {
  const { db, store } = setup();
  try {
    assert.equal(
      store.start({ ...scope, includeUnseen: false }, now).current,
      null,
    );
    store.markStudied("q1", "v1", true, now);
    const s = store.start(scope, now);
    store.act(s.id, 0, "Good", now);
    store.markStudied("q1", "v1", false, now);
    assert.equal(
      store.start({ ...scope, includeUnseen: false }, new Date("2026-12-01"))
        .current,
      null,
    );
    assert.equal(store.start(scope, now).current?.mode, "study");
    assert.equal(store.progress("q1").version, 1);
  } finally {
    db.close();
  }
});

test("review transaction failure rolls back state, event and queue completion", () => {
  const { db, store } = setup();
  try {
    store.markStudied("q1", "v1", true, now);
    const s = store.start(scope, now);
    db.connection.exec(
      `CREATE TRIGGER fail_event BEFORE INSERT ON fsrs_event_details BEGIN SELECT RAISE(ABORT,'fail'); END;`,
    );
    assert.throws(() => store.act(s.id, 0, "Good", now), /fail/);
    assert.equal(store.progress("q1").card, null);
    assert.ok(store.session(s.id).current);
    assert.equal(
      db.connection.prepare("SELECT count(*) AS n FROM review_events").get()?.n,
      0,
    );
  } finally {
    db.close();
  }
});

test("queue creation failure rolls back snapshot and respects folder boundaries", () => {
  const { db, store } = setup();
  try {
    db.reconcileFull([
      record(),
      { ...record("q2"), filePath: "Course/Other/Two.md" },
    ]);
    assert.equal(
      store.start({ ...scope, folderPath: "Course/Other" }, now).items.length,
      1,
    );
    const count = db.connection
      .prepare("SELECT count(*) AS n FROM review_sessions")
      .get()?.n;
    db.connection.exec(
      `CREATE TRIGGER fail_queue BEFORE INSERT ON recall_queue_items BEGIN SELECT RAISE(ABORT,'queue fail'); END;`,
    );
    assert.throws(() => store.start(scope, now), /queue fail/);
    assert.equal(
      db.connection.prepare("SELECT count(*) AS n FROM review_sessions").get()
        ?.n,
      count,
    );
  } finally {
    db.close();
  }
});

test("Obsidian and website share study state and reject stale study queues", () => {
  const { db, store } = setup();
  try {
    const queued = store.start(scope, now);
    const state = db.setStudied(
      {
        questionId: "q1",
        filePath: record().filePath,
        contentHash: "v1",
        studied: true,
        expectedRevision: null,
      },
      now.toISOString(),
    );
    assert.equal(store.progress("q1").studyRevision, state.revision);
    assert.equal(
      store.start({ includeUnseen: false }, now).current?.mode,
      "recall",
    );
    assert.throws(() => store.act(queued.id, 0, "studied", now));
    assert.equal(store.session(queued.id).done, 0);
    store.markStudied("q1", "v1", false, now, state.revision);
    assert.equal(db.getStudyState("q1")?.studiedAt, null);
    assert.equal(
      db.connection
        .prepare("SELECT name FROM sqlite_master WHERE name='study_progress'")
        .get(),
      undefined,
    );
  } finally {
    db.close();
  }
});
