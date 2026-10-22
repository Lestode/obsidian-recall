import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { request as httpRequest } from "node:http";
import test from "node:test";
import { RecallDatabase } from "@recall/database";
import { scanVault } from "../src/scanner";
import { createRecallServer } from "../src/server";
import { RecallSynchronizer } from "../src/synchronizer";

test("Obsidian study API checks vault, identity, current content and state; leaves Markdown and reviews untouched", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "recall-study-api-"));
  await mkdir(path.join(vault, "Course"));
  await writeFile(path.join(vault, "Course/_recall.md"), "# Course\n");
  const markdown = "**Q:** What is an RL policy?\n<!-- recall:id=123e4567-e89b-42d3-a456-426614174000 -->\n\n**A:** An action selection rule.\n";
  const note = path.join(vault, "Course/Chapter.md");
  await writeFile(note, markdown);
  const database = new RecallDatabase(":memory:");
  const synchronizer = new RecallSynchronizer(vault, database);
  await synchronizer.reconcileFull();
  const server = createRecallServer({ database, synchronizer, webRoot: "", vaultName: "Test" });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { "x-recall-client": "obsidian", "x-recall-vault": encodeURIComponent(vault), "content-type": "application/json" };
  const question = database.listQuestions()[0]!;
  const request = { questionId: question.id, filePath: question.filePath, contentHash: question.contentHash, studied: true, expectedRevision: null };
  const post = (body: unknown = request, extraHeaders = {}) => fetch(`${origin}/api/study`, {
    method: "POST", headers: { ...headers, ...extraHeaders }, body: JSON.stringify(body),
  });
  try {
    assert.equal((await fetch(`${origin}/api/study?file=Course/Chapter.md`)).status, 403);
    assert.equal((await post(request, { "x-recall-client": "browser" })).status, 403);
    const reboundStatus = await new Promise<number | undefined>((resolve, reject) => {
      const outgoing = httpRequest(`${origin}/api/study`, {
        method: "POST", headers: { ...headers, host: "rebound.example" },
      }, incoming => { incoming.resume(); resolve(incoming.statusCode); });
      outgoing.on("error", reject); outgoing.end(JSON.stringify(request));
    });
    assert.equal(reboundStatus, 403);
    assert.equal((await post(request, { "x-recall-vault": encodeURIComponent(os.tmpdir()) })).status, 409);
    assert.equal((await post(request, { "content-type": "text/plain" })).status, 415);
    assert.equal((await post({ ...request, studied: "yes" })).status, 400);
    const states = await (await fetch(`${origin}/api/study?file=Course/Chapter.md`, { headers })).json() as { states: { studiedAt: string | null }[] };
    assert.equal(states.states[0]?.studiedAt, null);
    assert.equal((await post()).status, 200);
    const saved = database.getStudyState(question.id)!;
    assert.ok(saved.studiedAt);
    assert.equal((await post()).status, 409);
    await writeFile(note, markdown.replace("selection rule.", "distribution."));
    assert.equal((await post({ ...request, studied: false, expectedRevision: saved.revision })).status, 409);
    assert.deepEqual(database.getStudyState(question.id), saved);
    await synchronizer.reconcileFull();
    const edited = database.getStudyState(question.id)!;
    assert.equal(edited.contentChanged, true);
    assert.equal(edited.studiedAt, saved.studiedAt);
    const undo = { ...request, studied: false, contentHash: edited.contentHash, expectedRevision: edited.revision };
    assert.equal((await post(undo)).status, 200);
    assert.equal(database.getStudyState(question.id)?.studiedAt, null);
    // Invalid files retain old indexed content but cannot accept study writes.
    await writeFile(note, `${markdown}\n${markdown}`);
    await synchronizer.reconcileFull();
    assert.equal((await post({ ...undo, expectedRevision: database.getStudyState(question.id)!.revision })).status, 409);
    assert.equal((await readFile(note, "utf8")), `${markdown}\n${markdown}`);
    assert.equal(database.connection.prepare("SELECT COUNT(*) AS n FROM review_events").get()?.n, 0);
    assert.equal((await scanVault(vault)).diagnostics[0]?.kind, "duplicate-identity");
  } finally {
    synchronizer.stop(); server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    database.close(); await rm(vault, { recursive: true, force: true });
  }
});
