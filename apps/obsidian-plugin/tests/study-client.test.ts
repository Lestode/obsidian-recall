import assert from "node:assert/strict";
import test from "node:test";
import { StudyClient, loopbackServiceUrl } from "../src/study-client";
import type { StudyState } from "@recall/database";

const state: StudyState = {
  questionId: "question-one", contentHash: "hash", studiedAt: null,
  studiedContentHash: null, revision: null, contentChanged: false,
};

test("the client never guesses an initial status or confirms a failed save", async () => {
  let fail = false;
  const requests: unknown[] = [];
  const client = new StudyClient(async (_route, body) => {
    if (body) { requests.push(body); throw new Error("Disk full"); }
    if (fail) throw new Error("Offline");
    return { states: [state] };
  });
  assert.equal(client.snapshot("file").loaded, false);
  await client.load("file");
  assert.equal(client.snapshot("file").states.get(state.questionId)?.studiedAt, null);
  assert.equal(await client.setStudied("file", state.questionId, "outdated", true), false);
  assert.equal(requests.length, 0);
  assert.equal(await client.setStudied("file", state.questionId, "hash", true), false);
  assert.equal(client.snapshot("file").error, "Disk full");
  assert.equal(client.snapshot("file").states.get(state.questionId)?.studiedAt, null);
  fail = true;
  await client.load("file");
  assert.equal(client.snapshot("file").error, "Offline");
});

test("a delayed background read cannot erase a confirmed mark and duplicate clicks cannot double-save", async () => {
  let finishRead: ((value: unknown) => void) | undefined;
  let finishWrite: ((value: unknown) => void) | undefined;
  let first = true;
  const client = new StudyClient(async (_route, body) => {
    if (body) return new Promise(resolve => { finishWrite = resolve; });
    if (first) { first = false; return { states: [state] }; }
    return new Promise(resolve => { finishRead = resolve; });
  });
  await client.load("file");
  const reading = client.load("file");
  const writing = client.setStudied("file", state.questionId, "hash", true);
  assert.equal(client.isBusy(state.questionId), true);
  assert.equal(client.snapshot("file").states.get(state.questionId)?.studiedAt, null);
  assert.equal(await client.setStudied("file", state.questionId, "hash", true), false);
  const studied = { ...state, studiedAt: "now", studiedContentHash: "hash", revision: "saved" };
  finishWrite!({ state: studied });
  assert.equal(await writing, true);
  finishRead!({ states: [state] });
  await reading;
  assert.deepEqual(client.snapshot("file").states.get(state.questionId), studied);
});

test("service settings accept only loopback HTTP origins", () => {
  assert.equal(loopbackServiceUrl("http://127.0.0.1:45871/"), "http://127.0.0.1:45871");
  for (const value of ["https://example.com", "http://localhost:45871", "file:///vault", "http://127.0.0.1/path", "http://user@127.0.0.1", "http://127.0.0.1/?q=x"]) {
    assert.throws(() => loopbackServiceUrl(value));
  }
});
