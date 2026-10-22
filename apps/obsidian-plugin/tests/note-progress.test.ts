import assert from "node:assert/strict";
import test from "node:test";
import type { StudyState } from "@recall/database";
import { noteProgress, noteQuestionHashes } from "../src/note-progress";
import { StudyClient, type FileState } from "../src/study-client";

const first: StudyState = { questionId: "one", contentHash: "hash-one", studiedAt: null,
  studiedContentHash: null, revision: null, contentChanged: false };
const second: StudyState = { ...first, questionId: "two", contentHash: "hash-two" };
const studied = (state: StudyState): StudyState => ({ ...state, studiedAt: "now", studiedContentHash: state.contentHash });
const snapshot = (states: StudyState[]): FileState => ({
  states: new Map(states.map(state => [state.questionId, state])), loaded: true, synchronized: true, error: null,
});
const hashes = new Map([["one", "hash-one"], ["two", "hash-two"]]);

test("note completion is derived from every current question and reverses after undo or additions", () => {
  assert.equal(noteProgress(snapshot([first, second]), hashes).label, "0/2");
  assert.equal(noteProgress(snapshot([studied(first), second]), hashes).label, "1/2");
  const complete = noteProgress(snapshot([studied(first), studied(second)]), hashes);
  assert.equal(complete.label, "✓ Completed");
  assert.equal(complete.tone, "complete");
  assert.match(complete.description, /2 of 2/);
  assert.equal(noteProgress(snapshot([first, studied(second)]), hashes).label, "1/2");
  const third = { ...first, questionId: "three", contentHash: "hash-three" };
  assert.equal(noteProgress(snapshot([studied(first), studied(second), third]), new Map([...hashes, ["three", "hash-three"]])).label, "2/3");
  assert.equal(noteProgress(snapshot([studied(first)]), new Map([["one", "hash-one"]])).label, "✓ Completed");
  assert.equal(noteProgress(snapshot([]), new Map()).hidden, true);
});

test("completion cannot be inferred from old index data, invalid content, initial loading, or offline state", () => {
  const complete = snapshot([studied(first), studied(second)]);
  for (const progress of [
    noteProgress({ ...complete, loaded: false }, hashes),
    noteProgress({ ...complete, synchronized: false }, hashes),
    noteProgress({ ...complete, error: "Offline" }, hashes),
    noteProgress(complete, null),
    noteProgress(complete, undefined),
    noteProgress(complete, new Map([...hashes, ["three", "new"]])),
    noteProgress(complete, new Map([["one", "edited"], ["two", "hash-two"]])),
  ]) {
    assert.equal(progress.tone, "unknown");
    assert.notEqual(progress.label, "✓ Completed");
  }
  assert.equal(noteProgress({ ...complete, error: "Offline" }, hashes).label, "Unavailable");
  assert.equal(noteProgress(complete, null).label, "Syncing…");
  assert.equal(noteProgress(complete, undefined).label, "Loading…");
});

test("edits retain completion and expose content changes without acknowledging the edited version", () => {
  const edited = { ...studied(first), contentHash: "edited", contentChanged: true };
  const progress = noteProgress(snapshot([edited, studied(second)]), new Map([["one", "edited"], ["two", "hash-two"]]));
  assert.equal(progress.label, "✓ Completed");
  assert.equal(progress.changed, true);
  assert.match(progress.description, /Content changed/);
});

test("current Markdown hashing uses the shared grammar and rejects ambiguous question identity", async () => {
  const question = "**Q:** What is a policy in reinforcement learning?\n<!-- recall:id=123e4567-e89b-42d3-a456-426614174000 -->\n\n**A:** A rule for selecting actions.\n";
  const hashes = await noteQuestionHashes(question);
  assert.equal(hashes?.size, 1);
  assert.equal(await noteQuestionHashes(question + "\n" + question), null);
  assert.equal(await noteQuestionHashes(question.replace(/<!--.*-->\n/, "")), null);
  assert.equal(await noteQuestionHashes(question + "\n<!-- recall:id=123e4567-e89b-42d3-a456-426614174001 -->\n"), null);
  assert.equal((await noteQuestionHashes("```md\n" + question + "```"))?.size, 0);
  assert.notDeepEqual(await noteQuestionHashes(question.replace("rule", "distribution")), hashes);
});

test("note progress observes only confirmed saves, recovers after disconnection, and shares question state", async () => {
  let current = first;
  let failRead = false;
  let failWrite = false;
  const client = new StudyClient(async (_route, body) => {
    if (!body) {
      if (failRead) throw new Error("Offline");
      return { states: [current], synchronized: true };
    }
    if (failWrite) throw new Error("Save failed");
    current = { ...current, studiedAt: (body as { studied: boolean }).studied ? "now" : null, revision: "saved" };
    return { state: current };
  });
  const currentHashes = new Map([[first.questionId, first.contentHash]]);
  await client.load("chapter");
  const saving = client.setStudied("chapter", "one", "hash-one", true);
  assert.equal(noteProgress(client.snapshot("chapter"), currentHashes).label, "0/1");
  await saving;
  assert.equal(noteProgress(client.snapshot("chapter"), currentHashes).label, "✓ Completed");
  failWrite = true;
  assert.equal(await client.setStudied("chapter", "one", "hash-one", false), false);
  assert.equal(noteProgress(client.snapshot("chapter"), currentHashes).label, "Unavailable");
  failRead = true;
  await client.load("chapter");
  assert.equal(noteProgress(client.snapshot("chapter"), currentHashes).label, "Unavailable");
  failRead = false;
  await client.load("chapter");
  assert.equal(noteProgress(client.snapshot("chapter"), currentHashes).label, "✓ Completed");
});
