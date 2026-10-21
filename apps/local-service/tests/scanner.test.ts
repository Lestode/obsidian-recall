import assert from "node:assert/strict";
import { mkdir, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { RecallDatabase } from "@recall/database";
import { scanChangedFiles, scanVault } from "../src/scanner";

const ID_ONE = "123e4567-e89b-42d3-a456-426614174000";
const ID_TWO = "123e4567-e89b-42d3-a456-426614174001";

async function fixture(): Promise<string> {
  const vault = await mkdtemp(path.join(os.tmpdir(), "recall-vault-"));
  await mkdir(path.join(vault, "Course"));
  await writeFile(path.join(vault, "Course", "_recall.md"), "# Course\n");
  return vault;
}

test("full scan derives hierarchy, order, and stable content hashes", async () => {
  const vault = await fixture();
  await writeFile(path.join(vault, "Course", "Chapter.md"), `## Core\n\n**Q:** First?\n<!-- recall:id=${ID_ONE} -->\nAnswer one.\n\n**Q:** Second?\n<!-- recall:id=${ID_TWO} -->\nAnswer two.\n`);

  const result = await scanVault(vault);
  assert.equal(result.records.length, 2);
  assert.deepEqual(result.records.map((record) => record.questionOrdinal), [0, 1]);
  assert.deepEqual(result.records[0]?.sectionPath, ["Core"]);
  assert.equal(result.records[0]?.contentHash.length, 64);
});

test("incremental scan recognizes a move as the same identity", async () => {
  const vault = await fixture();
  const original = path.join(vault, "Course", "One.md");
  const destination = path.join(vault, "Course", "Two.md");
  const markdown = `**Q:** Moving?\n<!-- recall:id=${ID_ONE} -->\nYes.\n`;
  await writeFile(original, markdown);
  const database = new RecallDatabase(":memory:");
  const initial = await scanVault(vault);
  database.reconcileFull(initial.records);
  await writeFile(original, "No questions.\n");
  await writeFile(destination, markdown);

  const changed = await scanChangedFiles(
    vault,
    ["Course/One.md", "Course/Two.md"],
    initial.markerPaths,
    database,
  );
  database.reconcileFiles(changed.filePaths, changed.records);
  assert.equal(database.listQuestions()[0]?.filePath, "Course/Two.md");
  assert.equal(database.listQuestions({ includeArchived: true }).length, 1);
  database.close();
});

test("incremental scan recognizes an actual file rename as the same identity", async () => {
  const vault = await fixture();
  const original = path.join(vault, "Course", "Before.md");
  const destination = path.join(vault, "Course", "After.md");
  await writeFile(original, `**Q:** Rename?\n<!-- recall:id=${ID_ONE} -->\nYes.\n`);
  const database = new RecallDatabase(":memory:");
  const initial = await scanVault(vault);
  database.reconcileFull(initial.records);
  await rename(original, destination);

  const changed = await scanChangedFiles(
    vault,
    ["Course/Before.md", "Course/After.md"],
    initial.markerPaths,
    database,
  );
  assert.deepEqual(changed.missingFilePaths, ["Course/Before.md"]);
  database.reconcileFiles(["Course/Before.md", ...changed.filePaths], changed.records);
  assert.equal(database.listQuestions()[0]?.filePath, "Course/After.md");
  assert.equal(database.listQuestions({ includeArchived: true }).length, 1);
  database.close();
});

test("validation failure leaves the previous database revision readable", async () => {
  const vault = await fixture();
  const file = path.join(vault, "Course", "Chapter.md");
  await writeFile(file, `**Q:** Valid?\n<!-- recall:id=${ID_ONE} -->\nYes.\n`);
  const database = new RecallDatabase(":memory:");
  const initial = await scanVault(vault);
  database.reconcileFull(initial.records);
  await writeFile(file, "**Q:** Missing identity?\nNo identity.\n");

  const result = await scanChangedFiles(
    vault,
    ["Course/Chapter.md"],
    initial.markerPaths,
    database,
  );
  assert.equal(result.diagnostics[0]?.kind, "missing-identity");
  assert.deepEqual(result.blockedFilePaths, ["Course/Chapter.md"]);
  assert.deepEqual(result.filePaths, []);
  assert.equal(database.status().revision, 1);
  assert.equal(database.listQuestions()[0]?.prompt, "Valid?");
  database.close();
});

test("a duplicated identity in different files is rejected", async () => {
  const vault = await fixture();
  const question = `**Q:** Duplicate?\n<!-- recall:id=${ID_ONE} -->\nYes.\n`;
  await writeFile(path.join(vault, "Course", "One.md"), question);
  await writeFile(path.join(vault, "Course", "Two.md"), question);

  const result = await scanVault(vault);
  assert.equal(result.diagnostics[0]?.kind, "duplicate-identity");
  assert.deepEqual(result.blockedFilePaths.sort(), ["Course/One.md", "Course/Two.md"]);
  assert.deepEqual(result.records, []);
});

test("an orphaned identity is rejected instead of archiving the previous question", async () => {
  const vault = await fixture();
  const file = path.join(vault, "Course", "Chapter.md");
  await writeFile(file, `**Q:** Valid?\n<!-- recall:id=${ID_ONE} -->\n\nYes.\n`);
  const database = new RecallDatabase(":memory:");
  const initial = await scanVault(vault);
  database.reconcileFull(initial.records);
  await writeFile(file, `Valid?\n<!-- recall:id=${ID_ONE} -->\n\nYes.\n`);

  const result = await scanChangedFiles(
    vault,
    ["Course/Chapter.md"],
    initial.markerPaths,
    database,
  );
  assert.equal(result.diagnostics[0]?.kind, "orphan-identity");
  assert.deepEqual(result.blockedFilePaths, ["Course/Chapter.md"]);
  assert.equal(database.listQuestions().length, 1);
  assert.equal(database.revision(), 1);
  database.close();
});

test("a path that exists but is not a readable file is quarantined", async () => {
  const vault = await fixture();
  await mkdir(path.join(vault, "Course", "Broken.md"));
  const database = new RecallDatabase(":memory:");
  const initial = await scanVault(vault);
  const result = await scanChangedFiles(
    vault,
    ["Course/Broken.md"],
    initial.markerPaths,
    database,
  );

  assert.equal(result.diagnostics[0]?.kind, "read-error");
  assert.deepEqual(result.blockedFilePaths, ["Course/Broken.md"]);
  assert.deepEqual(result.filePaths, []);
  database.close();
});
