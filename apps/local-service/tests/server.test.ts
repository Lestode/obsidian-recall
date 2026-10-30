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
  const server = createRecallServer({
    database,
    synchronizer,
    webRoot,
    vaultName: "Test Vault",
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;

  try {
    const status = (await (await fetch(`${origin}/api/status`)).json()) as {
      activeQuestions: number;
      vaultName: string;
    };
    assert.equal(status.activeQuestions, 1);
    assert.equal(status.vaultName, "Test Vault");

    const questions = (await (
      await fetch(
        `${origin}/api/questions?file=${encodeURIComponent(question.filePath)}`,
      )
    ).json()) as { questions: IndexedQuestionRecord[] };
    assert.deepEqual(
      questions.questions.map((item) => item.id),
      [question.id],
    );

    const rescan = await fetch(`${origin}/api/rescan`, { method: "POST" });
    assert.equal(rescan.status, 202);
    assert.equal((await fetch(`${origin}/app.js`)).status, 200);
  } finally {
    synchronizer.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    database.close();
  }
});

test("study and review API validates writes, rejects foreign origins and exports restorable progress", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "recall-write-api-"));
  const db = new RecallDatabase(":memory:");
  db.reconcileFull([question]);
  const synchronizer = new RecallSynchronizer(vault, db);
  const server = createRecallServer({
    database: db,
    synchronizer,
    webRoot: path.resolve(import.meta.dirname, "../../review-web"),
    vaultName: "Test",
    vaultPath: vault,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = {
    "Content-Type": "application/json",
    "X-Recall-Client": "1",
  };
  const post = (route: string, body: unknown) =>
    fetch(origin + route, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  try {
    assert.equal(
      (await fetch(origin + "/api/study", { method: "POST", body: "{}" }))
        .status,
      403,
    );
    assert.equal(
      (
        await fetch(origin + "/api/study", {
          method: "POST",
          headers: { ...headers, Origin: "https://foreign.example" },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await post("/api/study", {
          id: question.id,
          contentHash: question.contentHash,
          studied: "yes",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post("/api/study", {
          id: question.id,
          contentHash: question.contentHash,
          studied: true,
        })
      ).status,
      200,
    );
    const list = (await (await fetch(origin + "/api/study")).json()) as {
      questions: { studiedAt: string }[];
    };
    assert.ok(list.questions[0]?.studiedAt);
    const s = (await (
      await post("/api/review/sessions", {
        collectionPath: "Course",
        includeUnseen: false,
      })
    ).json()) as { id: string; current: { mode: string } };
    assert.equal(s.current.mode, "recall");
    assert.equal(
      (
        await post(`/api/review/sessions/${s.id}`, {
          position: 0,
          action: "Good",
        })
      ).status,
      200,
    );
    const backup = await fetch(origin + "/api/backup");
    assert.equal(backup.status, 200);
    const file = path.join(vault, "backup.sqlite");
    await writeFile(file, Buffer.from(await backup.arrayBuffer()));
    const restored = new RecallDatabase(file);
    assert.ok(restored.getQuestion(question.id)?.lastReviewedAt);
    assert.ok(
      restored.connection.prepare("SELECT studied_at FROM study_progress").get()
        ?.studied_at,
    );
    restored.close();
  } finally {
    synchronizer.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});
