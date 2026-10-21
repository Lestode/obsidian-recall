import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  hashQuestionContent,
  nearestRecallRoot,
  orphanRecallIdentities,
  parseRecallQuestions,
  RECALL_MARKER_FILE,
  sourceContexts,
} from "@recall/core";
import type { IndexedQuestionRecord, RecallDatabase } from "@recall/database";

export interface ScanDiagnostic {
  kind: "missing-identity" | "orphan-identity" | "duplicate-identity" | "read-error";
  filePath: string;
  line?: number;
  message: string;
}

export interface ScanResult {
  records: IndexedQuestionRecord[];
  markerPaths: string[];
  markdownPaths: string[];
  blockedFilePaths: string[];
  diagnostics: ScanDiagnostic[];
}

interface ScannedQuestionRecord extends IndexedQuestionRecord {
  sourceLine: number;
}

function posixPath(value: string): string {
  return value.split(path.sep).join("/").replace(/^\.\//, "");
}

async function walk(directory: string, relative = ""): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === ".obsidian" || entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }
    const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await walk(path.join(directory, entry.name), relativePath));
    } else if (entry.isFile()) {
      files.push(posixPath(relativePath));
    }
  }
  return files;
}

async function fileStatus(filePath: string): Promise<"file" | "missing" | Error> {
  try {
    return (await stat(filePath)).isFile()
      ? "file"
      : new Error(`${filePath} is not a regular file.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    return error instanceof Error ? error : new Error(String(error));
  }
}

function topicFromPath(filePath: string): string {
  return path.posix.basename(filePath, path.posix.extname(filePath));
}

async function parseFile(
  vaultPath: string,
  filePath: string,
  markerPaths: string[],
): Promise<{ records: ScannedQuestionRecord[]; diagnostics: ScanDiagnostic[] }> {
  const root = nearestRecallRoot(filePath, markerPaths);
  if (root === null || path.posix.basename(filePath) === RECALL_MARKER_FILE) {
    return { records: [], diagnostics: [] };
  }

  let markdown: string;
  try {
    markdown = await readFile(path.join(vaultPath, ...filePath.split("/")), "utf8");
  } catch (error) {
    return {
      records: [],
      diagnostics: [{
        kind: "read-error",
        filePath,
        message: `Could not read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      }],
    };
  }

  const parsed = parseRecallQuestions(markdown);
  const orphanIdentities = orphanRecallIdentities(markdown, parsed);
  const contexts = sourceContexts(markdown, parsed);
  const diagnostics: ScanDiagnostic[] = [];
  const records: ScannedQuestionRecord[] = [];

  for (const orphan of orphanIdentities) {
    diagnostics.push({
      kind: "orphan-identity",
      filePath,
      line: orphan.line + 1,
      message: `${filePath}:${orphan.line + 1} has a Recall identity without an immediately preceding **Q:** question.`,
    });
  }

  for (const [index, question] of parsed.entries()) {
    if (!question.id) {
      diagnostics.push({
        kind: "missing-identity",
        filePath,
        line: question.questionLine + 1,
        message: `${filePath}:${question.questionLine + 1} has no Recall identity.`,
      });
      continue;
    }
    const context = contexts[index] ?? { sectionPath: [], questionOrdinal: index };
    const contentHash = await hashQuestionContent(question.prompt, question.answer);
    records.push({
      id: question.id,
      collectionPath: root || ".",
      filePath,
      topic: topicFromPath(filePath),
      sectionPath: context.sectionPath,
      questionOrdinal: context.questionOrdinal,
      prompt: question.prompt,
      answer: question.answer,
      contentHash,
      sourceLine: question.questionLine + 1,
    });
  }

  return { records, diagnostics };
}

function duplicateDiagnostics(
  records: ScannedQuestionRecord[],
  existing: Map<string, string> = new Map(),
): { diagnostics: ScanDiagnostic[]; blockedFilePaths: Set<string> } {
  const locations = new Map<string, { filePath: string; line?: number }>(
    [...existing].map(([id, filePath]) => [id, { filePath }]),
  );
  const diagnostics: ScanDiagnostic[] = [];
  const blockedFilePaths = new Set<string>();
  const diagnosedLocations = new Set<string>();
  for (const record of records) {
    const previous = locations.get(record.id);
    if (previous) {
      blockedFilePaths.add(previous.filePath);
      blockedFilePaths.add(record.filePath);
      const message = `Recall identity ${record.id} appears in both ${previous.filePath} and ${record.filePath}.`;
      diagnostics.push({
        kind: "duplicate-identity",
        filePath: record.filePath,
        line: record.sourceLine,
        message,
      });
      diagnosedLocations.add(`${record.id}\u0000${record.filePath}`);
      const previousKey = `${record.id}\u0000${previous.filePath}`;
      if (previous.line !== undefined && !diagnosedLocations.has(previousKey)) {
        diagnostics.push({
          kind: "duplicate-identity",
          filePath: previous.filePath,
          line: previous.line,
          message,
        });
        diagnosedLocations.add(previousKey);
      }
    } else {
      locations.set(record.id, { filePath: record.filePath, line: record.sourceLine });
    }
  }
  return { diagnostics, blockedFilePaths };
}

export async function scanVault(vaultPath: string): Promise<ScanResult> {
  const files = await walk(vaultPath);
  const markerPaths = files.filter((file) => path.posix.basename(file) === RECALL_MARKER_FILE);
  const markdownPaths = files.filter((file) => file.toLowerCase().endsWith(".md"));
  const parsed = await Promise.all(markdownPaths.map((file) => parseFile(vaultPath, file, markerPaths)));
  const allRecords = parsed.flatMap((result) => result.records);
  const parseDiagnostics = parsed.flatMap((result) => result.diagnostics);
  const parseBlockedFilePaths = new Set(
    parseDiagnostics.map((diagnostic) => diagnostic.filePath),
  );
  const candidateRecords = allRecords.filter(
    (record) => !parseBlockedFilePaths.has(record.filePath),
  );
  const duplicates = duplicateDiagnostics(candidateRecords);
  const blockedFilePaths = new Set([
    ...parseDiagnostics.map((diagnostic) => diagnostic.filePath),
    ...duplicates.blockedFilePaths,
  ]);
  return {
    records: candidateRecords.filter((record) => !blockedFilePaths.has(record.filePath)),
    markerPaths,
    markdownPaths,
    blockedFilePaths: [...blockedFilePaths],
    diagnostics: [...parseDiagnostics, ...duplicates.diagnostics],
  };
}

export async function scanChangedFiles(
  vaultPath: string,
  dirtyPaths: string[],
  markerPaths: string[],
  database: RecallDatabase,
): Promise<{
  records: IndexedQuestionRecord[];
  filePaths: string[];
  missingFilePaths: string[];
  blockedFilePaths: string[];
  diagnostics: ScanDiagnostic[];
}> {
  const filePaths = [...new Set(dirtyPaths.map(posixPath))]
    .filter((file) => file.toLowerCase().endsWith(".md"));
  const observedPaths = await Promise.all(filePaths.map(async (file) => ({
    file,
    status: await fileStatus(path.join(vaultPath, ...file.split("/"))),
  })));
  const existingPaths = observedPaths.filter(({ status }) => status === "file");
  const unreadableDiagnostics = observedPaths.flatMap(({ file, status }) =>
    status instanceof Error
      ? [{
          kind: "read-error" as const,
          filePath: file,
          message: `Could not inspect ${file}: ${status.message}`,
        }]
      : []);
  const parsed = await Promise.all(existingPaths
    .map(({ file }) => parseFile(vaultPath, file, markerPaths)));
  const allRecords = parsed.flatMap((result) => result.records);
  const parseDiagnostics = [
    ...unreadableDiagnostics,
    ...parsed.flatMap((result) => result.diagnostics),
  ];
  const parseBlockedFilePaths = new Set(
    parseDiagnostics.map((diagnostic) => diagnostic.filePath),
  );
  const candidateRecords = allRecords.filter(
    (record) => !parseBlockedFilePaths.has(record.filePath),
  );
  const duplicates = duplicateDiagnostics(
    candidateRecords,
    database.activeIdentityLocationsExcluding(filePaths),
  );
  const blockedFilePaths = new Set([
    ...parseDiagnostics.map((diagnostic) => diagnostic.filePath),
    ...[...duplicates.blockedFilePaths].filter((file) => filePaths.includes(file)),
  ]);
  return {
    records: candidateRecords.filter((record) => !blockedFilePaths.has(record.filePath)),
    filePaths: existingPaths
      .map(({ file }) => file)
      .filter((file) => !blockedFilePaths.has(file)),
    missingFilePaths: observedPaths
      .filter(({ status }) => status === "missing")
      .map(({ file }) => file),
    blockedFilePaths: [...blockedFilePaths],
    diagnostics: [...parseDiagnostics, ...duplicates.diagnostics],
  };
}
