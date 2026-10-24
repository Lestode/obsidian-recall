import { open, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

function localPdf(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "file:" || url.hostname || url.search ||
        path.extname(fileURLToPath(url)).toLowerCase() !== ".pdf") return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

/** Resolve only real Markdown links in the indexed answer, never a raw path. */
export async function openSourcePdf(answer: string, requested: string): Promise<FileHandle | null> {
  const source = localPdf(requested);
  if (!source) return null;
  let linked = false;
  marked.walkTokens(marked.lexer(answer), (token) => {
    if (token.type === "link" && localPdf(token.href)?.href === source.href) linked = true;
  });
  if (!linked) return null;

  const file = await open(fileURLToPath(source));
  try {
    if (!(await file.stat()).isFile()) {
      await file.close();
      return null;
    }
    const header = Buffer.alloc(5);
    await file.read(header, 0, header.length, 0);
    if (header.toString("ascii") !== "%PDF-") {
      await file.close();
      return null;
    }
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}
