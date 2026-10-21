import assert from "node:assert/strict";
import test from "node:test";
import { RecallDatabase, type IndexedQuestionRecord } from "../src/index";

function record(overrides: Partial<IndexedQuestionRecord> = {}): IndexedQuestionRecord {
  return {
    id: "123e4567-e89b-42d3-a456-426614174000",
    collectionPath: "Course",
    filePath: "Course/Chapter.md",
    topic: "Chapter",
    sectionPath: ["Core"],
    questionOrdinal: 0,
    prompt: "What is OLS?",
    answer: "Least squares.",
    contentHash: "hash-one",
    ...overrides,
  };
}

test("reconciliation preserves identity while updating order and content versions", () => {
  const database = new RecallDatabase(":memory:");
  database.reconcileFull([record()]);
  database.reconcileFiles(["Course/Chapter.md"], [record({
    questionOrdinal: 4,
    prompt: "Define OLS.",
    contentHash: "hash-two",
  })]);

  const [question] = database.listQuestions();
  assert.equal(question?.questionOrdinal, 4);
  assert.equal(question?.prompt, "Define OLS.");
  assert.equal(database.status().revision, 2);
  const versions = database.connection.prepare(
    "SELECT content_hash FROM question_versions ORDER BY content_hash",
  ).all();
  assert.deepEqual(versions.map((row) => row.content_hash), ["hash-one", "hash-two"]);
  database.close();
});

test("missing questions are archived rather than deleted", () => {
  const database = new RecallDatabase(":memory:");
  database.reconcileFull([record()]);
  database.reconcileFiles(["Course/Chapter.md"], []);

  assert.equal(database.listQuestions().length, 0);
  assert.equal(database.listQuestions({ includeArchived: true })[0]?.status, "archived");
  database.close();
});

test("a failed reconciliation transaction exposes none of its changes", () => {
  const database = new RecallDatabase(":memory:");
  database.reconcileFull([record()]);
  database.connection.exec(`
    CREATE TRIGGER reject_test_version
    BEFORE INSERT ON question_versions
    WHEN NEW.content_hash = 'explode'
    BEGIN
      SELECT RAISE(ABORT, 'simulated version failure');
    END;
  `);

  assert.throws(() => database.reconcileFiles(["Course/Chapter.md"], [record({
    prompt: "This update must roll back.",
    contentHash: "explode",
  })]), /simulated version failure/);

  assert.equal(database.revision(), 1);
  assert.equal(database.getQuestion(record().id)?.prompt, "What is OLS?");
  assert.equal(database.listQuestions({ includeArchived: true })[0]?.archivedAt, null);
  database.close();
});

test("review sessions retain captured order and content while removed items are skipped", () => {
  const database = new RecallDatabase(":memory:");
  const second = record({
    id: "123e4567-e89b-42d3-a456-426614174001",
    questionOrdinal: 1,
    prompt: "Second question?",
    answer: "Second answer.",
    contentHash: "hash-second",
  });
  database.reconcileFull([record(), second]);
  const session = database.createSession(
    { collectionPath: "Course" },
    [second.id, record().id],
    "2026-10-06T10:00:00.000Z",
    "session-one",
  );
  assert.deepEqual(session.items.map((item) => item.questionId), [second.id, record().id]);

  database.reconcileFiles(["Course/Chapter.md"], [record({
    questionOrdinal: 1,
    prompt: "Edited after session start?",
    answer: "New answer.",
    contentHash: "hash-edited",
  })], "2026-10-06T10:05:00.000Z");

  const snapshot = database.getSession("session-one");
  assert.deepEqual(snapshot?.items.map((item) => item.prompt), ["Second question?", "What is OLS?"]);
  assert.equal(snapshot?.items[0]?.skippedAt, "2026-10-06T10:05:00.000Z");
  assert.equal(snapshot?.items[1]?.skippedAt, null);
  assert.equal(snapshot?.databaseRevision, 1);
  database.close();
});

test("question queries can be limited to affected files", () => {
  const database = new RecallDatabase(":memory:");
  database.reconcileFull([
    record(),
    record({
      id: "123e4567-e89b-42d3-a456-426614174002",
      filePath: "Course/Other.md",
      topic: "Other",
    }),
  ]);
  assert.deepEqual(
    database.listQuestions({ filePaths: ["Course/Other.md"] }).map((question) => question.filePath),
    ["Course/Other.md"],
  );
  assert.deepEqual(database.listQuestions({ filePaths: [] }), []);
  database.close();
});

test("a full reconcile preserves quarantined files while updating valid files", () => {
  const database = new RecallDatabase(":memory:");
  const quarantined = record();
  const valid = record({
    id: "123e4567-e89b-42d3-a456-426614174003",
    filePath: "Course/Valid.md",
    topic: "Valid",
  });
  database.reconcileFull([quarantined, valid]);
  database.reconcileFull([
    { ...valid, prompt: "Updated valid question?", contentHash: "valid-two" },
  ], "2026-10-06T12:00:00.000Z", [quarantined.filePath]);

  assert.equal(database.getQuestion(quarantined.id)?.archivedAt, null);
  assert.equal(database.getQuestion(valid.id)?.prompt, "Updated valid question?");
  database.close();
});

test("question status distinguishes reviewed, due, changed, and archived", () => {
  const database = new RecallDatabase(":memory:");
  const question = record();
  database.reconcileFull([question]);
  database.connection.prepare(`
    INSERT INTO review_state(
      question_id, due_at, last_reviewed_at, last_reviewed_hash,
      interval_days, review_count, lapse_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    question.id,
    "2099-01-01T00:00:00.000Z",
    "2026-10-01T00:00:00.000Z",
    question.contentHash,
    7,
    1,
    0,
  );
  assert.equal(database.getQuestion(question.id)?.status, "reviewed");

  database.connection.prepare("UPDATE review_state SET due_at = ? WHERE question_id = ?")
    .run("2020-01-01T00:00:00.000Z", question.id);
  assert.equal(database.getQuestion(question.id)?.status, "due");

  database.reconcileFiles([question.filePath], [{ ...question, contentHash: "changed-hash" }]);
  assert.equal(database.getQuestion(question.id)?.status, "changed");

  database.reconcileFiles([question.filePath], []);
  assert.equal(database.getQuestion(question.id)?.status, "archived");
  database.close();
});
