import { studyApi } from "./study-api";
import { openSourcePdf } from "./source-pdf";
import { createReadStream } from "node:fs";
import { stat, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { createServer, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import {
  ReviewStore,
  ReviewError,
  StudyConflict,
  type RecallDatabase,
} from "@recall/database";
import type { RecallSynchronizer, SyncEvent } from "./synchronizer";

const STATIC_FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
};

function json(response: ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

export function createRecallServer(options: {
  database: RecallDatabase;
  synchronizer: RecallSynchronizer;
  webRoot: string;
  vaultName: string;
  vaultPath?: string;
}): Server {
  const { database, synchronizer, webRoot, vaultName } = options;
  const clients = new Set<ServerResponse>();
  const reviews = new ReviewStore(database);
  const notifyProgress = () => {
    for (const client of clients) client.write(`event: progress\ndata: {}\n\n`);
  };
  const handleStudy = studyApi(database, synchronizer);
  let lastSyncEvent: SyncEvent | null = null;

  synchronizer.on("sync", (event: SyncEvent) => {
    lastSyncEvent = event;
    const payload = `event: sync\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) client.write(payload);
  });

  return createServer(async (request, response) => {
    try {
      const host = request.headers.host ?? "";
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
        json(response, { error: "Loopback Host required." }, 403);
        return;
      }
      const origin = request.headers.origin;
      if (
        origin &&
        origin !== `http://${host}` &&
        origin !== "app://obsidian.md"
      ) {
        json(response, { error: "Foreign origin rejected." }, 403);
        return;
      }
      const url = new URL(request.url ?? "/", `http://${host}`);
      if (await handleStudy(request, response, url)) {
        if (request.method === "POST" && response.statusCode === 200)
          notifyProgress();
        return;
      }
      const readBody = async (): Promise<Record<string, unknown>> => {
        if (
          request.headers["x-recall-client"] !== "1" ||
          !request.headers["content-type"]?.startsWith("application/json")
        )
          throw new ReviewError("Recall JSON request required.", 403);
        let data = "";
        for await (const chunk of request) {
          data += chunk.toString();
          if (Buffer.byteLength(data) > 16384)
            throw new ReviewError("Request too large.", 413);
        }
        let body;
        try {
          body = JSON.parse(data);
        } catch {
          throw new ReviewError("Invalid JSON.", 400);
        }
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw new ReviewError("Expected an object.", 400);
        return body;
      };
      if (url.pathname === "/api/review/projects" && request.method === "GET") {
        json(response, {
          projects: reviews.projects(),
        });
        return;
      }
      if (url.pathname === "/api/review/study" && request.method === "GET") {
        const file = url.searchParams.get("file");
        json(response, {
          questions: reviews
            .questions()
            .filter((q) => !file || q.filePath === file),
        });
        return;
      }
      if (url.pathname === "/api/review/study" && request.method === "POST") {
        const body = await readBody();
        if (
          typeof body.id !== "string" ||
          typeof body.contentHash !== "string" ||
          typeof body.studied !== "boolean" ||
          !(
            body.expectedRevision === null ||
            typeof body.expectedRevision === "string"
          )
        )
          throw new ReviewError("Invalid study mark.", 400);
        const question = database.getQuestion(body.id);
        if (
          !question ||
          !(await synchronizer.canStudy(
            question.filePath,
            body.id,
            body.contentHash,
          ))
        )
          throw new ReviewError(
            "Note changed or has not synchronized. Refresh and retry.",
          );
        const result = reviews.markStudied(
          body.id,
          body.contentHash,
          body.studied,
          new Date(),
          body.expectedRevision as string | null,
        );
        notifyProgress();
        json(response, result);
        return;
      }
      if (
        url.pathname === "/api/review/sessions" &&
        request.method === "POST"
      ) {
        const body = await readBody();
        if (
          (body.collectionPath !== undefined &&
            typeof body.collectionPath !== "string") ||
          (body.folderPath !== undefined &&
            typeof body.folderPath !== "string") ||
          typeof body.includeUnseen !== "boolean"
        )
          throw new ReviewError("Invalid session scope.", 400);
        json(
          response,
          reviews.start({
            collectionPath: body.collectionPath as string | undefined,
            folderPath: body.folderPath as string | undefined,
            includeUnseen: body.includeUnseen,
          }),
          201,
        );
        return;
      }
      const sessionMatch = url.pathname.match(
        /^\/api\/review\/sessions\/([^/]+)$/,
      );
      if (sessionMatch && request.method === "GET") {
        json(response, reviews.session(sessionMatch[1]!));
        return;
      }
      if (sessionMatch && request.method === "POST") {
        const body = await readBody();
        if (
          !Number.isInteger(body.position) ||
          Number(body.position) < 0 ||
          typeof body.action !== "string"
        )
          throw new ReviewError("Invalid review action.", 400);
        if (body.action === "studied") {
          const item = reviews.session(sessionMatch[1]!).items[
            Number(body.position)
          ];
          if (
            item &&
            !item.completedAt &&
            (!item.filePath ||
              !(await synchronizer.canStudy(
                item.filePath,
                item.questionId,
                item.contentHash,
              )))
          )
            throw new ReviewError(
              "Note changed or has not synchronized. Refresh and retry.",
            );
        }
        const result = reviews.act(
          sessionMatch[1]!,
          Number(body.position),
          body.action,
        );
        notifyProgress();
        json(response, result);
        return;
      }
      if (url.pathname === "/api/backup" && request.method === "GET") {
        const directory = await mkdtemp(
          path.join(os.tmpdir(), "recall-backup-"),
        );
        try {
          const destination = path.join(directory, "recall.sqlite");
          database.connection.prepare("VACUUM INTO ?").run(destination);
          const data = await readFile(destination);
          response.writeHead(200, {
            "content-type": "application/vnd.sqlite3",
            "content-disposition":
              'attachment; filename="recall-backup.sqlite"',
            "cache-control": "no-store",
          });
          response.end(data);
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/status") {
        json(response, {
          ...database.status(),
          vaultName,
          vaultPath: options.vaultPath,
          lastSyncEvent,
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/collections") {
        const includeArchived = url.searchParams.get("archived") === "1";
        json(response, {
          collections: database.listCollections(
            new Date().toISOString(),
            includeArchived,
          ),
          revision: database.revision(),
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/questions") {
        const collectionPath = url.searchParams.get("collection") ?? undefined;
        const includeArchived = url.searchParams.get("archived") === "1";
        const filePaths = url.searchParams.getAll("file");
        json(response, {
          questions: database
            .listQuestions({
              collectionPath,
              includeArchived,
              filePaths: filePaths.length ? filePaths : undefined,
            })
            .map((q) => ({
              ...q,
              ...reviews.progress(q.id),
            })),
          revision: database.revision(),
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/rescan") {
        synchronizer.requestFullReconcile();
        json(response, { accepted: true, revision: database.revision() }, 202);
        return;
      }
      const pdfRoute = /^\/api\/questions\/([^/]+)\/source-pdf$/.exec(
        url.pathname,
      );
      if (request.method === "GET" && pdfRoute) {
        const question = database.getQuestion(pdfRoute[1]!);
        try {
          const file =
            question &&
            (await openSourcePdf(
              question.answer,
              url.searchParams.get("source") ?? "",
            ));
          if (file) {
            response.writeHead(200, {
              "content-type": "application/pdf",
              "content-length": (await file.stat()).size,
              "content-disposition": "inline",
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            });
            const stream = file.createReadStream({ start: 0 });
            stream.on("error", () => response.destroy());
            response.on("close", () => stream.destroy());
            stream.pipe(response);
            return;
          }
        } catch {
          // Keep unavailable sources local and avoid exposing filesystem errors.
        }
        json(response, { error: "PDF source unavailable." }, 404);
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname.startsWith("/api/questions/")
      ) {
        const id = decodeURIComponent(
          url.pathname.slice("/api/questions/".length),
        );
        const question = database.getQuestion(id);
        json(
          response,
          question ? { question } : { error: "Question not found." },
          question ? 200 : 404,
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/events") {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        response.write(
          `event: ready\ndata: ${JSON.stringify({ revision: database.revision() })}\n\n`,
        );
        clients.add(response);
        request.on("close", () => clients.delete(response));
        return;
      }

      const staticFile = STATIC_FILES[url.pathname];
      if (request.method === "GET" && staticFile) {
        const filePath = path.join(webRoot, staticFile.file);
        try {
          const details = await stat(filePath);
          response.writeHead(200, {
            "content-type": staticFile.type,
            "content-length": details.size,
            "cache-control": "no-cache",
          });
          createReadStream(filePath).pipe(response);
        } catch {
          json(response, { error: "Inspector assets are unavailable." }, 500);
        }
        return;
      }

      json(response, { error: "Not found." }, 404);
    } catch (error) {
      json(
        response,
        { error: error instanceof Error ? error.message : "Request failed." },
        error instanceof ReviewError
          ? error.status
          : error instanceof StudyConflict
            ? 409
            : 500,
      );
    }
  });
}
