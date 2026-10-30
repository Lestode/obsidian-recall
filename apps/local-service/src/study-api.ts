import { realpath, realpathSync } from "node:fs";
import { promisify } from "node:util";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StudyConflict, type RecallDatabase } from "@recall/database";
import type { RecallSynchronizer } from "./synchronizer";

const resolvePath = promisify(realpath);

export function studyApi(database: RecallDatabase, synchronizer: RecallSynchronizer) {
  const vaultPath = realpathSync(synchronizer.vaultPath);
  database.bindVault(vaultPath);
  return async (request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> => {
    if (url.pathname !== "/api/study") return false;
    const reply = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(body));
    };
    // A browser cannot send these headers cross-origin without a CORS preflight.
    // Checking Host also prevents a re-bound hostname reaching the write API.
    if (!/^127\.0\.0\.1:\d+$/.test(request.headers.host ?? "") ||
        request.headers["x-recall-client"] !== "obsidian") {
      reply(403, { error: "Study controls require the Obsidian plugin." });
      return true;
    }
    try {
      const requestedVault = request.headers["x-recall-vault"];
      if (typeof requestedVault !== "string" ||
          await resolvePath(decodeURIComponent(requestedVault)) !== vaultPath) {
        reply(409, { error: "The service is connected to a different vault. Check Recall settings." });
        return true;
      }
      if (request.method === "GET") {
        const filePath = url.searchParams.get("file");
        if (!filePath) { reply(400, { error: "A note path is required." }); return true; }
        const synchronized = await synchronizer.studyFileSynchronized(filePath);
        reply(200, { states: database.listQuestions({ filePaths: [filePath] })
          .map(question => database.getStudyState(question.id)), synchronized });
        return true;
      }
      if (request.method !== "POST") { reply(405, { error: "Method not allowed." }); return true; }
      if (request.headers["content-type"]?.split(";")[0] !== "application/json") {
        reply(415, { error: "JSON required." }); return true;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const buffer = Buffer.from(chunk);
        size += buffer.length;
        if (size > 8192) { reply(413, { error: "Study request too large." }); return true; }
        chunks.push(buffer);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      if (!body || typeof body.questionId !== "string" || typeof body.filePath !== "string" ||
          typeof body.contentHash !== "string" || typeof body.studied !== "boolean" ||
          !(body.expectedRevision === null || typeof body.expectedRevision === "string")) {
        reply(400, { error: "Invalid study request." }); return true;
      }
      if (!await synchronizer.canStudy(body.filePath, body.questionId, body.contentHash)) {
        reply(409, { error: "Note changed, is invalid, or has not synchronized. Wait and retry." });
        return true;
      }
      const state = database.setStudied({
        questionId: body.questionId, filePath: body.filePath, contentHash: body.contentHash,
        studied: body.studied, expectedRevision: body.expectedRevision,
      });
      reply(200, { state });
    } catch (error) {
      if (error instanceof StudyConflict) reply(409, { error: error.message });
      else if (error instanceof SyntaxError || error instanceof URIError)
        reply(400, { error: "Invalid study request." });
      else reply(503, { error: "Study service unavailable. Check the vault connection and retry." });
    }
    return true;
  };
}
