import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import type { RecallDatabase } from "@recall/database";
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
}): Server {
  const { database, synchronizer, webRoot, vaultName } = options;
  const clients = new Set<ServerResponse>();
  let lastSyncEvent: SyncEvent | null = null;

  synchronizer.on("sync", (event: SyncEvent) => {
    lastSyncEvent = event;
    const payload = `event: sync\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) client.write(payload);
  });

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === "/api/status") {
      json(response, { ...database.status(), vaultName, lastSyncEvent });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/collections") {
      const includeArchived = url.searchParams.get("archived") === "1";
      json(response, {
        collections: database.listCollections(new Date().toISOString(), includeArchived),
        revision: database.revision(),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/questions") {
      const collectionPath = url.searchParams.get("collection") ?? undefined;
      const includeArchived = url.searchParams.get("archived") === "1";
      const filePaths = url.searchParams.getAll("file");
      json(response, {
        questions: database.listQuestions({
          collectionPath,
          includeArchived,
          filePaths: filePaths.length ? filePaths : undefined,
        }),
        revision: database.revision(),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/rescan") {
      synchronizer.requestFullReconcile();
      json(response, { accepted: true, revision: database.revision() }, 202);
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/questions/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/questions/".length));
      const question = database.getQuestion(id);
      json(response, question ? { question } : { error: "Question not found." }, question ? 200 : 404);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/events") {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      response.write(`event: ready\ndata: ${JSON.stringify({ revision: database.revision() })}\n\n`);
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
  });
}
