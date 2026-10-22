import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, realpath, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  identityComment, orphanRecallIdentities, parseRecallQuestions, RECALL_MARKER_FILE,
} from "../../packages/core/src/grammar";

type ObjectValue = Record<string, unknown>;
export type PriorOutput = "none" | "confirmed-new-copy";

export interface PreparedNote {
  markdown: string;
  folderName: string;
  fileName: string;
  questionCount: number;
}

function object(value: unknown, label: string): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as ObjectValue;
}

function text(value: unknown, label: string, singleLine = true): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must not be empty.`);
  const result = value.replace(/\r\n?/g, "\n").trim();
  if (result.includes("\0") || (singleLine && result.includes("\n"))) {
    throw new Error(`${label} must be ${singleLine ? "a single line" : "text without null characters"}.`);
  }
  return result;
}

function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a nonempty array.`);
  return value;
}

function webUrl(value: unknown, label: string): string {
  const url = new URL(text(value, label));
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${label} must be an HTTP(S) URL without embedded credentials.`);
  }
  return url.href;
}

function name(value: string): string {
  const result = value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/^[. ]+|[. ]+$/g, "");
  if (!result || ["_recall", "node_modules"].includes(result.toLowerCase()) || result.startsWith(".")) {
    throw new Error("Choose a nonempty, visible source or note title that is not a reserved Recall filename.");
  }
  return result;
}

function label(value: string): string {
  return value.replace(/[\\[\]]/g, "\\$&");
}

function sourceLink(kind: string, location: unknown): string {
  if (kind === "website") return webUrl(location, "source.location");
  const locator = text(location, "source.location");
  if (/^https?:\/\//i.test(locator)) return webUrl(locator, "source.location");
  if (!path.isAbsolute(locator)) throw new Error("A local PDF source.location must be an absolute path.");
  return pathToFileURL(locator).href;
}

/** Structural checks deliberately do not claim to establish source fidelity. */
export function renderSourceNote(input: unknown): PreparedNote {
  const draft = object(input, "draft");
  const source = object(draft.source, "source");
  if (source.kind !== "website" && source.kind !== "pdf") throw new Error("source.kind must be website or pdf.");
  const sourceTitle = text(source.title, "source.title");
  const location = sourceLink(source.kind, source.location);
  const scope = text(source.scope, "source.scope");
  const title = text(draft.title, "title");
  const expected: { id: string; prompt: string; answer: string }[] = [];
  const parts = [`# ${title}`, `Source: [${label(sourceTitle)}](<${location}>)`, `Scope: ${scope}`];

  for (const entry of list(draft.sections, "sections")) {
    const section = object(entry, "section");
    parts.push(`## ${text(section.title, "section.title")}`);
    for (const item of list(section.questions, "section.questions")) {
      const question = object(item, "question");
      if ("id" in question) throw new Error("Do not supply question IDs; every generated copy gets a fresh UUID.");
      const prompt = text(question.prompt, "question.prompt");
      const body = text(question.answer, "question.answer", false);
      const references = list(question.references, "question.references").map((entry) => {
        const reference = object(entry, "reference");
        let url: string;
        let description: string;
        if (source.kind === "website") {
          url = webUrl(reference.url, "reference.url");
          description = reference.label === undefined ? "Source section" : text(reference.label, "reference.label");
        } else {
          if (!Number.isSafeInteger(reference.page) || (reference.page as number) < 1) {
            throw new Error("Each PDF reference.page must be a positive, one-based physical PDF page number.");
          }
          const pageUrl = new URL(location);
          pageUrl.hash = `page=${reference.page}`;
          url = pageUrl.href;
          description = `PDF page ${reference.page}`;
        }
        return `[${label(description)}](<${url}>)`;
      });
      const answer = `${body}\n\nSource: ${references.join(", ")}`;
      const id = randomUUID();
      expected.push({ id, prompt, answer });
      parts.push(`**Q:** ${prompt}\n${identityComment(id)}\n\n${answer}`);
    }
  }
  const markdown = `${parts.join("\n\n")}\n`;
  // A sentinel also checks that the final answer does not leave a code fence open.
  const sentinelId = randomUUID();
  const sentinel = `\n**Q:** End-of-note validation\n${identityComment(sentinelId)}\n\nEnd.`;
  const parsed = parseRecallQuestions(markdown + sentinel);
  if (parsed.length !== expected.length + 1 || parsed.at(-1)?.id !== sentinelId ||
      orphanRecallIdentities(markdown).length || expected.some((question, index) => {
        const actual = parsed[index];
        return actual?.id !== question.id || actual.prompt !== question.prompt || actual.answer !== question.answer;
      })) {
    throw new Error("Draft changes Recall question/answer boundaries. Keep prompts on one line, answer headings at level 3+, code fences closed, and IDs out of authored text.");
  }
  return { markdown, folderName: name(sourceTitle), fileName: `${name(title)}.md`, questionCount: expected.length };
}

async function collectionFor(parent: string): Promise<string> {
  let directory = parent;
  while (true) {
    try {
      if ((await lstat(path.join(directory, RECALL_MARKER_FILE))).isFile()) return directory;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const next = path.dirname(directory);
    if (next === directory) throw new Error("The destination must be inside an existing Recall collection containing _recall.md.");
    directory = next;
  }
}

export async function writeSourceNote(input: unknown, parentPath: string, priorOutput: PriorOutput) {
  if (priorOutput !== "none" && priorOutput !== "confirmed-new-copy") {
    throw new Error("Ask whether this source has prior generated notes. Supply none, or confirmed-new-copy only after user confirmation.");
  }
  const note = renderSourceNote(input);
  const parent = await realpath(parentPath);
  if (!(await lstat(parent)).isDirectory()) throw new Error("The destination parent must be an existing directory.");
  const collection = await collectionFor(parent);
  let folder: string;
  let suffix = 1;
  while (true) {
    folder = path.join(parent, `${note.folderName}${suffix === 1 ? "" : ` (${suffix})`}`);
    try {
      await mkdir(folder);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (priorOutput !== "confirmed-new-copy") {
        throw new Error("The source folder already exists. Ask the user before creating a separate new copy; existing notes will not be changed.");
      }
      suffix += 1;
      if (suffix > 1000) throw new Error("Too many destination-name collisions; choose a different parent folder.");
    }
  }
  const filePath = path.join(folder, note.fileName);
  const temporaryPath = path.join(folder, `${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, note.markdown, { flag: "wx" });
    // Publish a complete file atomically; link never replaces an existing entry.
    await link(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    // Nonrecursive removal cannot delete a file concurrently added by the user.
    await rmdir(folder).catch(() => {});
    throw error;
  }
  await unlink(temporaryPath).catch(() => {});
  return { filePath, collection, questionCount: note.questionCount };
}
