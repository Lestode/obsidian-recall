import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RecallDatabase, type IndexedQuestionRecord } from "@recall/database";
import { createRecallServer } from "../src/server";
import { RecallSynchronizer } from "../src/synchronizer";

const question: IndexedQuestionRecord = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  collectionPath: "Course",
  filePath: "Course/Chapter.md",
  topic: "Chapter",
  sectionPath: ["Core"],
  questionOrdinal: 0,
  prompt: "Question?",
  answer: "Answer.",
  contentHash: "hash",
};

test("loopback API exposes status, targeted questions, rescan, and inspector assets", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "recall-server-"));
  await mkdir(path.join(vault, "Course"));
  await writeFile(path.join(vault, "Course", "_recall.md"), "# Course\n");
  const database = new RecallDatabase(":memory:");
  database.reconcileFull([question]);
  const synchronizer = new RecallSynchronizer(vault, database, 20, 50);
  const webRoot = path.resolve(import.meta.dirname, "../../review-web");
  const server = createRecallServer({ database, synchronizer, webRoot, vaultName: "Test Vault" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;

  try {
    const status = await (await fetch(`${origin}/api/status`)).json() as {
      activeQuestions: number;
      vaultName: string;
    };
    assert.equal(status.activeQuestions, 1);
    assert.equal(status.vaultName, "Test Vault");

    const questions = await (await fetch(
      `${origin}/api/questions?file=${encodeURIComponent(question.filePath)}`,
    )).json() as { questions: IndexedQuestionRecord[] };
    assert.deepEqual(questions.questions.map((item) => item.id), [question.id]);

    const rescan = await fetch(`${origin}/api/rescan`, { method: "POST" });
    assert.equal(rescan.status, 202);
    assert.equal((await fetch(`${origin}/app.js`)).status, 200);
  } finally {
    synchronizer.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    database.close();
  }
});
