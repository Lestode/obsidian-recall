import assert from "node:assert/strict";
import { mkdir, mkdtemp, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RecallDatabase } from "@recall/database";
import { RecallSynchronizer, type SyncEvent } from "../src/synchronizer";

const ID = "123e4567-e89b-42d3-a456-426614174000";

async function vaultFixture(markdown: string): Promise<{ vault: string; file: string }> {
  const vault = await mkdtemp(path.join(os.tmpdir(), "recall-sync-"));
  await mkdir(path.join(vault, "Course"));
  await writeFile(path.join(vault, "Course", "_recall.md"), "# Course\n");
  const file = path.join(vault, "Course", "Chapter.md");
  await writeFile(file, markdown);
  return { vault, file };
}

function question(prompt: string): string {
  return `**Q:** ${prompt}\n<!-- recall:id=${ID} -->\n\nAnswer.\n`;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(predicate(), true, "Timed out waiting for the expected synchronized state.");
}

test("an editing burst is reconciled once after the debounce window", async () => {
  const { vault, file } = await vaultFixture(question("Initial?"));
  const database = new RecallDatabase(":memory:");
  const synchronizer = new RecallSynchronizer(vault, database, 80);
  const events: SyncEvent[] = [];
  synchronizer.on("sync", (event: SyncEvent) => events.push(event));
  await synchronizer.start();
  events.length = 0;

  const incremental = new Promise<SyncEvent>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for incremental reconciliation.")), 2_000);
    synchronizer.on("sync", (event: SyncEvent) => {
      if (event.type === "reconciled" && !event.full) {
        clearTimeout(timeout);
        resolve(event);
      }
    });
  });
  await writeFile(file, question("First edit?"));
  await writeFile(file, question("Second edit?"));
  await writeFile(file, question("Final edit?"));
  await incremental;
  await new Promise((resolve) => setTimeout(resolve, 180));

  assert.equal(events.filter((event) => event.type === "reconciled").length, 1);
  assert.equal(database.revision(), 2);
  assert.equal(database.listQuestions()[0]?.prompt, "Final edit?");
  synchronizer.stop();
  database.close();
});

test("startup validation errors are reported while the last revision remains available", async () => {
  const { vault } = await vaultFixture("**Q:** Missing identity?\n\nAnswer.\n");
  await writeFile(
    path.join(vault, "Course", "Valid.md"),
    `**Q:** Still index me?\n<!-- recall:id=123e4567-e89b-42d3-a456-426614174001 -->\n\nYes.\n`,
  );
  const database = new RecallDatabase(":memory:");
  const synchronizer = new RecallSynchronizer(vault, database, 20);
  const events: SyncEvent[] = [];
  synchronizer.on("sync", (event: SyncEvent) => events.push(event));

  await synchronizer.start();

  const error = events.find((event) => event.type === "error");
  assert.equal(error?.diagnostics?.[0]?.kind, "missing-identity");
  assert.equal(database.listQuestions().length, 1);
  assert.equal(database.listQuestions()[0]?.prompt, "Still index me?");
  assert.equal(database.revision(), 1);

  events.length = 0;
  await writeFile(
    path.join(vault, "Course", "Valid.md"),
    `**Q:** Updated independently?\n<!-- recall:id=123e4567-e89b-42d3-a456-426614174001 -->\n\nYes.\n`,
  );
  const deadline = Date.now() + 1_500;
  while (!events.some((event) => event.type === "error") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(database.listQuestions()[0]?.prompt, "Updated independently?");
  assert.equal(events.at(-1)?.type, "error");
  assert.equal(events.at(-1)?.diagnostics?.[0]?.filePath, "Course/Chapter.md");
  synchronizer.stop();
  database.close();
});

test("a transiently missing file is not archived", async () => {
  const { vault, file } = await vaultFixture(question("Transient?"));
  const temporary = `${file}.temporary`;
  const database = new RecallDatabase(":memory:");
  const synchronizer = new RecallSynchronizer(vault, database, 20, 180);
  await synchronizer.start();

  try {
    await rename(file, temporary);
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal(database.listQuestions().length, 1);
    await rename(temporary, file);
    await new Promise((resolve) => setTimeout(resolve, 280));
    assert.equal(database.listQuestions().length, 1);
    assert.equal(database.listQuestions({ includeArchived: true })[0]?.archivedAt, null);
  } finally {
    synchronizer.stop();
    database.close();
  }
});

test("a confirmed deletion archives the file after the grace period", async () => {
  const { vault, file } = await vaultFixture(question("Delete me?"));
  const database = new RecallDatabase(":memory:");
  const synchronizer = new RecallSynchronizer(vault, database, 20, 100);
  await synchronizer.start();

  try {
    await unlink(file);
    const deadline = Date.now() + 1_500;
    while (database.listQuestions().length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.equal(database.listQuestions().length, 0);
    assert.equal(database.listQuestions({ includeArchived: true }).length, 1);
  } finally {
    synchronizer.stop();
    database.close();
  }
});

test("a duplicate copied to a second file is rechecked after the source is deleted", async () => {
  const { vault, file } = await vaultFixture(question("Move across saves?"));
  const destination = path.join(vault, "Course", "Destination.md");
  const database = new RecallDatabase(":memory:");
  const synchronizer = new RecallSynchronizer(vault, database, 20, 100);
  const events: SyncEvent[] = [];
  synchronizer.on("sync", (event: SyncEvent) => events.push(event));
  await synchronizer.start();

  try {
    await writeFile(destination, question("Move across saves?"));
    await waitUntil(() => events.some((event) =>
      event.diagnostics?.some((diagnostic) => diagnostic.kind === "duplicate-identity") ?? false));
    await unlink(file);
    await waitUntil(() => database.getQuestion(ID)?.filePath === "Course/Destination.md");
    assert.equal(database.getQuestion(ID)?.archivedAt, null);
  } finally {
    synchronizer.stop();
    database.close();
  }
});

test("a duplicate copied to a second file is rechecked after removal by editing", async () => {
  const { vault, file } = await vaultFixture(question("Move by editing?"));
  const destination = path.join(vault, "Course", "Destination.md");
  const database = new RecallDatabase(":memory:");
  const synchronizer = new RecallSynchronizer(vault, database, 20, 100);
  const events: SyncEvent[] = [];
  synchronizer.on("sync", (event: SyncEvent) => events.push(event));
  await synchronizer.start();

  try {
    await writeFile(destination, question("Move by editing?"));
    await waitUntil(() => events.some((event) =>
      event.diagnostics?.some((diagnostic) => diagnostic.kind === "duplicate-identity") ?? false));
    await writeFile(file, "No Recall questions remain here.\n");
    await waitUntil(() => database.getQuestion(ID)?.filePath === "Course/Destination.md");
    assert.equal(database.getQuestion(ID)?.archivedAt, null);
    assert.equal(events.at(-1)?.type, "reconciled");
  } finally {
    synchronizer.stop();
    database.close();
  }
});

test("moving a question out of a quarantined file does not create a false duplicate", async () => {
  const { vault, file } = await vaultFixture(question("Leave invalid source?"));
  const destination = path.join(vault, "Course", "Destination.md");
  const database = new RecallDatabase(":memory:");
  const synchronizer = new RecallSynchronizer(vault, database, 20, 100);
  const events: SyncEvent[] = [];
  synchronizer.on("sync", (event: SyncEvent) => events.push(event));
  await synchronizer.start();

  try {
    await writeFile(file, "**Q:** Invalid source without identity?\n");
    await waitUntil(() => events.some((event) => event.type === "error"));
    await writeFile(destination, question("Leave invalid source?"));
    await waitUntil(() => database.getQuestion(ID)?.filePath === "Course/Destination.md");
    const latestError = events.filter((event) => event.type === "error").at(-1);
    assert.deepEqual(
      [...new Set(latestError?.diagnostics?.map((diagnostic) => diagnostic.filePath))],
      ["Course/Chapter.md"],
    );
  } finally {
    synchronizer.stop();
    database.close();
  }
});

test("a transiently missing recall marker does not archive its collection", async () => {
  const { vault } = await vaultFixture(question("Keep collection?"));
  const marker = path.join(vault, "Course", "_recall.md");
  const temporary = `${marker}.temporary`;
  const database = new RecallDatabase(":memory:");
  const synchronizer = new RecallSynchronizer(vault, database, 20, 180);
  await synchronizer.start();

  try {
    await rename(marker, temporary);
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal(database.listQuestions().length, 1);
    await rename(temporary, marker);
    await new Promise((resolve) => setTimeout(resolve, 280));
    assert.equal(database.listQuestions().length, 1);
    assert.equal(database.getQuestion(ID)?.archivedAt, null);
  } finally {
    synchronizer.stop();
    database.close();
  }
});

test("a confirmed recall-marker deletion archives its collection", async () => {
  const { vault } = await vaultFixture(question("Archive collection?"));
  const marker = path.join(vault, "Course", "_recall.md");
  const database = new RecallDatabase(":memory:");
  const synchronizer = new RecallSynchronizer(vault, database, 20, 100);
  await synchronizer.start();

  try {
    await unlink(marker);
    await waitUntil(() => database.listQuestions().length === 0);
    assert.equal(database.getQuestion(ID)?.status, "archived");
  } finally {
    synchronizer.stop();
    database.close();
  }
});

test("a recall marker missing at startup receives the same deletion grace", async () => {
  const { vault } = await vaultFixture(question("Startup grace?"));
  const marker = path.join(vault, "Course", "_recall.md");
  const database = new RecallDatabase(":memory:");
  const initial = new RecallSynchronizer(vault, database, 20, 120);
  await initial.start();
  initial.stop();
  await unlink(marker);

  const restarted = new RecallSynchronizer(vault, database, 20, 120);
  await restarted.start();
  try {
    assert.equal(database.listQuestions().length, 1);
    await waitUntil(() => database.listQuestions().length === 0);
  } finally {
    restarted.stop();
    database.close();
  }
});

test("a transiently missing nested marker does not move questions to the outer collection", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "recall-nested-marker-"));
  await mkdir(path.join(vault, "Course", "Nested"), { recursive: true });
  await writeFile(path.join(vault, "Course", "_recall.md"), "# Course\n");
  const nestedMarker = path.join(vault, "Course", "Nested", "_recall.md");
  await writeFile(nestedMarker, "# Nested\n");
  await writeFile(path.join(vault, "Course", "Nested", "Chapter.md"), question("Nested?"));
  const temporary = `${nestedMarker}.temporary`;
  const database = new RecallDatabase(":memory:");
  const synchronizer = new RecallSynchronizer(vault, database, 20, 180);
  await synchronizer.start();

  try {
    assert.equal(database.getQuestion(ID)?.collectionPath, "Course/Nested");
    await rename(nestedMarker, temporary);
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal(database.getQuestion(ID)?.collectionPath, "Course/Nested");
    await rename(temporary, nestedMarker);
    await new Promise((resolve) => setTimeout(resolve, 280));
    assert.equal(database.getQuestion(ID)?.collectionPath, "Course/Nested");
  } finally {
    synchronizer.stop();
    database.close();
  }
});
