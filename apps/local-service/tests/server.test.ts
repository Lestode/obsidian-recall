import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { RecallDatabase, type IndexedQuestionRecord } from "@recall/database";
import { writeSourceNote } from "../../../automation/source-preparation/prepare";
import { createRecallServer } from "../src/server";
import { scanVault } from "../src/scanner";
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

test("generated PDF references serve only actual PDFs linked from the indexed answer", async (t) => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "recall-pdf-source-"));
  t.after(() => rm(vault, { recursive: true, force: true }));
  const parent = path.join(vault, "Course");
  await mkdir(parent);
  await writeFile(path.join(parent, "_recall.md"), "# Course\n");
  const sourcePath = path.join(vault, "Original source ü.pdf");
  const unlinkedPath = path.join(vault, "Unlinked.pdf");
  const nonPdfPath = path.join(vault, "Not a PDF.pdf");
  const textPath = path.join(vault, "Notes.txt");
  const pdf = Buffer.from("%PDF-1.4\nOriginal PDF fixture.\n%%EOF\n");
  await writeFile(sourcePath, pdf);
  await writeFile(unlinkedPath, pdf);
  await writeFile(nonPdfPath, "Not a PDF.");
  await writeFile(textPath, "Private text.");
  const unlinkedUrl = pathToFileURL(unlinkedPath).href;
  const nonPdfUrl = pathToFileURL(nonPdfPath).href;
  const textUrl = pathToFileURL(textPath).href;
  await writeSourceNote({
    source: { kind: "pdf", title: "Original source", location: sourcePath, scope: "Page 2" },
    title: "PDF questions",
    sections: [{ title: "Core", questions: [{
      prompt: "In the PDF fixture, which physical page is referenced?",
      answer: `Physical page 2.\n\n\`\`\`md\n[Code example](<${unlinkedUrl}>)\n\`\`\`\n\n` +
        `\`[Inline example](<${unlinkedUrl}>)\`\n\n` +
        `[Invalid PDF](<${nonPdfUrl}>) and [Text file](<${textUrl}>).`,
      references: [{ page: 2 }],
    }] }],
  }, parent, "none");
  const scan = await scanVault(vault);
  assert.deepEqual(scan.diagnostics, []);
  const record = scan.records[0]!;
  const database = new RecallDatabase(":memory:");
  database.reconcileFull(scan.records);
  const synchronizer = new RecallSynchronizer(vault, database);
  const server = createRecallServer({ database, synchronizer, webRoot: "", vaultName: "Test Vault" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const endpoint = `${origin}/api/questions/${record.id}/source-pdf`;
  try {
    const sourceUrl = pathToFileURL(sourcePath).href;
    const response = await fetch(`${endpoint}?source=${encodeURIComponent(sourceUrl)}#page=2`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type")!, /application\/pdf/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
    assert.deepEqual(await readFile(sourcePath), pdf);
    for (const denied of [
      unlinkedUrl, nonPdfUrl, textUrl, sourcePath, "file://remote/Share/source.pdf",
      "https://example.org/source.pdf", `${sourceUrl}?extra=1`, "file:///missing.pdf",
    ]) {
      const result = await fetch(`${endpoint}?source=${encodeURIComponent(denied)}`);
      assert.equal(result.status, 404, denied);
      assert.deepEqual(await result.json(), { error: "PDF source unavailable." });
    }
    await rm(sourcePath);
    assert.equal((await fetch(`${endpoint}?source=${encodeURIComponent(sourceUrl)}`)).status, 404);
    assert.equal((await fetch(`${origin}/api/questions/unknown/source-pdf?source=${encodeURIComponent(sourceUrl)}`)).status, 404);
  } finally {
    synchronizer.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    database.close();
  }
});
