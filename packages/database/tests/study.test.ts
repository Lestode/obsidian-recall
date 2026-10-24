import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RecallDatabase, StudyConflict, type IndexedQuestionRecord } from "../src/index";

const question: IndexedQuestionRecord = {
  id: "123e4567-e89b-42d3-a456-426614174000", collectionPath: "Course",
  filePath: "Course/Chapter.md", topic: "Chapter", sectionPath: [], questionOrdinal: 0,
  prompt: "What is a policy in reinforcement learning?", answer: "An action selection rule.", contentHash: "one",
};
const mark = (database: RecallDatabase, studied = true) => database.setStudied({
  questionId: question.id, filePath: database.getQuestion(question.id)!.filePath,
  contentHash: database.getQuestion(question.id)!.contentHash, studied,
  expectedRevision: database.getStudyState(question.id)!.revision,
});

test("all questions start unstudied, independently of review history; one explicit mark affects only its UUID", () => {
  const database = new RecallDatabase(":memory:");
  const second = { ...question, id: "123e4567-e89b-42d3-a456-426614174001" };
  database.reconcileFull([question, second]);
  database.connection.prepare("INSERT INTO review_state(question_id, last_reviewed_hash) VALUES (?, ?)")
    .run(question.id, question.contentHash);
  assert.equal(database.getStudyState(question.id)?.studiedAt, null);
  assert.equal(database.getStudyState(second.id)?.studiedAt, null);
  const session = database.createSession({}, [question.id]);
  mark(database);
  assert.ok(database.getStudyState(question.id)?.studiedAt);
  assert.equal(database.getStudyState(second.id)?.studiedAt, null);
  assert.equal(database.connection.prepare("SELECT COUNT(*) AS count FROM review_events").get()?.count, 0);
  assert.deepEqual(database.getSession(session.id), session);
  database.close();
});

test("study state survives restarts, moves, index rebuilds, edits, archival and restoration; undo is explicit", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "recall-study-"));
  const file = path.join(directory, "study.sqlite");
  let database = new RecallDatabase(file);
  try {
    database.bindVault("/vault-one");
    assert.throws(() => database.bindVault("/vault-two"), /another vault/);
    database.reconcileFull([question]);
    const saved = mark(database);
    database.close();
    database = new RecallDatabase(file);
    database.bindVault("/vault-one");
    assert.deepEqual(database.getStudyState(question.id), saved);
    const moved = { ...question, filePath: "Course/Renamed.md", questionOrdinal: 8 };
    database.reconcileFull([moved]);
    assert.deepEqual(database.getStudyState(question.id), saved);
    database.reconcileFull([{ ...moved, contentHash: "two", answer: "Edited answer." }]);
    assert.equal(database.getStudyState(question.id)?.studiedAt, saved.studiedAt);
    assert.equal(database.getStudyState(question.id)?.contentChanged, true);
    // Repeated activation does not acknowledge changed material.
    assert.equal(mark(database).studiedContentHash, "one");
    database.reconcileFull([moved]);
    assert.equal(database.getStudyState(question.id)?.contentChanged, false);
    database.reconcileFull([]);
    assert.equal(database.getStudyState(question.id)?.studiedAt, saved.studiedAt);
    assert.throws(() => mark(database), StudyConflict);
    database.reconcileFull([moved]);
    assert.equal(mark(database, false).studiedAt, null);
    assert.ok(mark(database).studiedAt);
  } finally { database.close(); await rm(directory, { recursive: true, force: true }); }
});

test("stale content and progress cannot overwrite current state; failed writes remain atomic", () => {
  const database = new RecallDatabase(":memory:");
  database.reconcileFull([question]);
  const request = { questionId: question.id, filePath: question.filePath, contentHash: "one", studied: true, expectedRevision: null };
  const saved = database.setStudied(request);
  assert.throws(() => database.setStudied({ ...request, studied: false }), StudyConflict);
  assert.throws(() => database.setStudied({ ...request, contentHash: "old", expectedRevision: saved.revision }), StudyConflict);
  assert.deepEqual(database.getStudyState(question.id), saved);
  database.connection.exec(`CREATE TRIGGER reject_study BEFORE UPDATE ON study_state
    BEGIN SELECT RAISE(ABORT, 'write failed'); END;`);
  assert.throws(() => mark(database, false), /write failed/);
  assert.deepEqual(database.getStudyState(question.id), saved);
  database.close();
});
