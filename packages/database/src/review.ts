import { randomUUID } from "node:crypto";
import {
  ENGINE,
  RATINGS,
  preview,
  schedule,
  type Assessment,
} from "@recall/scheduler";
import type { RecallDatabase, QuestionListItem } from "./index";

export class ReviewError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}
export interface Scope {
  collectionPath?: string;
  folderPath?: string;
  includeUnseen: boolean;
}
export interface Progress {
  studiedAt: string | null;
  studyRevision: string | null;
  card: string | null;
  version: number;
}

export class ReviewStore {
  constructor(readonly db: RecallDatabase) {
    db.connection.exec(`
      CREATE TABLE IF NOT EXISTS fsrs_cards (
        question_id TEXT PRIMARY KEY, card_json TEXT NOT NULL, engine TEXT NOT NULL,
        version INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS recall_queue_items (
        session_id TEXT NOT NULL, position INTEGER NOT NULL, mode TEXT NOT NULL,
        expected_version INTEGER NOT NULL, expected_study_revision TEXT, action TEXT, completed_at TEXT,
        PRIMARY KEY(session_id, position),
        FOREIGN KEY(session_id) REFERENCES review_sessions(id)
      );
      CREATE TABLE IF NOT EXISTS fsrs_event_details (
        event_id TEXT PRIMARY KEY, engine TEXT NOT NULL,
        previous_card_json TEXT, next_card_json TEXT NOT NULL
      );
    `);
  }
  private transaction<T>(fn: () => T): T {
    return this.db.transaction(fn);
  }
  progress(id: string): Progress {
    const study = this.db.getStudyState(id);
    const card = this.db.connection
      .prepare(
        "SELECT card_json, version FROM fsrs_cards WHERE question_id = ?",
      )
      .get(id);
    return {
      studiedAt: study?.studiedAt ?? null,
      studyRevision: study?.revision ?? null,
      card: card ? String(card.card_json) : null,
      version: card ? Number(card.version) : 0,
    };
  }
  questions() {
    return this.db
      .listQuestions()
      .map((q) => ({ ...q, ...this.progress(q.id) }));
  }
  markStudied(
    id: string,
    hash: string,
    studied: boolean,
    now = new Date(),
    expectedRevision = this.progress(id).studyRevision,
  ) {
    const q = this.db.getQuestion(id);
    if (!q || q.archivedAt)
      throw new ReviewError("Question is unavailable.", 404);
    if (q.contentHash !== hash)
      throw new ReviewError(
        "This question changed. Refresh before marking it studied.",
      );
    this.db.setStudied(
      {
        questionId: id,
        filePath: q.filePath,
        contentHash: hash,
        studied,
        expectedRevision,
      },
      now.toISOString(),
    );
    return this.progress(id);
  }
  private eligible(q: QuestionListItem, now: Date) {
    const p = this.progress(q.id);
    return p.studiedAt ? !q.dueAt || q.dueAt <= now.toISOString() : false;
  }
  projects(now = new Date()) {
    const questions = this.db.connection.prepare(`
      SELECT q.collection_path, q.file_path, s.studied_at, r.due_at, r.last_reviewed_at
      FROM questions q LEFT JOIN study_state s ON s.question_id=q.id
      LEFT JOIN review_state r ON r.question_id=q.id WHERE q.archived_at IS NULL
    `).all().map(row => ({
      collectionPath: String(row.collection_path), filePath: String(row.file_path),
      studied: !!row.studied_at, lastReviewedAt: row.last_reviewed_at,
      eligible: !!row.studied_at && (!row.due_at || String(row.due_at) <= now.toISOString()),
    }));
    const scopes = new Map<
      string,
      { collectionPath: string; folderPath: string; label: string }
    >();
    for (const q of questions) {
      scopes.set(q.collectionPath, {
        collectionPath: q.collectionPath,
        folderPath: q.collectionPath,
        label: q.collectionPath,
      });
      let folder = q.filePath.slice(0, q.filePath.lastIndexOf("/")) || ".";
      while (folder !== q.collectionPath && folder !== ".") {
        scopes.set(`${q.collectionPath}:${folder}`, {
          collectionPath: q.collectionPath,
          folderPath: folder,
          label: folder,
        });
        folder = folder.includes("/")
          ? folder.slice(0, folder.lastIndexOf("/"))
          : ".";
      }
    }
    return [...scopes.values()]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((scope) => {
        const items = questions.filter((q) => this.inScope(q, scope));
        return {
          ...scope,
          total: items.length,
          unseen: items.filter((q) => !q.studied).length,
          ready: items.filter((q) => q.eligible && !q.lastReviewedAt)
            .length,
          due: items.filter((q) => q.eligible && !!q.lastReviewedAt)
            .length,
        };
      });
  }
  private inScope(q: Pick<QuestionListItem, "collectionPath" | "filePath">, scope: Partial<Scope>) {
    return (
      (!scope.collectionPath || q.collectionPath === scope.collectionPath) &&
      (!scope.folderPath ||
        scope.folderPath === "." ||
        q.filePath.startsWith(scope.folderPath + "/"))
    );
  }
  start(scope: Scope, now = new Date()) {
    const all = this.db
      .listQuestions()
      .filter((q) => this.inScope(q, scope) && q.prompt.trim());
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const band = (q: QuestionListItem) =>
      !q.lastReviewedAt ? 2 : q.dueAt && q.dueAt < today.toISOString() ? 0 : 1;
    const recall = all
      .filter((q) => this.eligible(q, now))
      .sort(
        (a, b) =>
          band(a) - band(b) ||
          a.filePath.localeCompare(b.filePath) ||
          a.questionOrdinal - b.questionOrdinal,
      );
    const unseen = scope.includeUnseen
      ? all.filter((q) => !this.progress(q.id).studiedAt)
      : [];
    const queue: { q: QuestionListItem; mode: string }[] = [];
    for (let i = 0; i < Math.max(recall.length, unseen.length); i++) {
      if (recall[i]) queue.push({ q: recall[i]!, mode: "recall" });
      if (unseen[i]) queue.push({ q: unseen[i]!, mode: "study" });
    }
    const session = this.db.createSession(
      scope,
      queue.map((x) => x.q.id),
      now.toISOString(),
      randomUUID(),
      (id) => {
        const insert = this.db.connection
          .prepare(`INSERT INTO recall_queue_items
        (session_id, position, mode, expected_version, expected_study_revision) VALUES (?, ?, ?, ?, ?)`);
        queue.forEach((item, i) =>
          insert.run(
            id,
            i,
            item.mode,
            this.progress(item.q.id).version,
            this.progress(item.q.id).studyRevision,
          ),
        );
      },
    );
    return this.session(session.id, now);
  }
  sessions() {
    return this.db.connection
      .prepare(
        `SELECT DISTINCT s.id, s.created_at, s.scope_json FROM review_sessions s
      JOIN recall_queue_items i ON i.session_id=s.id
      JOIN review_session_items r ON r.session_id=i.session_id AND r.session_position=i.position
      WHERE s.completed_at IS NULL AND i.completed_at IS NULL AND r.skipped_at IS NULL
      ORDER BY s.created_at DESC LIMIT 20`,
      )
      .all()
      .map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        scope: JSON.parse(String(r.scope_json)),
      }));
  }
  session(id: string, now = new Date()) {
    const session = this.db.getSession(id);
    if (!session) throw new ReviewError("Session not found.", 404);
    const metadata = this.db.connection
      .prepare(
        "SELECT * FROM recall_queue_items WHERE session_id=? ORDER BY position",
      )
      .all(id);
    const items = session.items.map((item, i) => {
      const meta = metadata[i];
      const question = this.db.getQuestion(item.questionId);
      const progress = this.progress(item.questionId);
      return {
        ...item,
        mode: String(meta?.mode ?? "recall"),
        completedAt: meta?.completed_at ?? null,
        action: meta?.action ?? null,
        topic: question?.topic,
        filePath: question?.filePath,
        sectionPath: question?.sectionPath ?? [],
        changed:
          question?.contentHash !== item.contentHash ||
          (!!question?.lastReviewedHash &&
            question.lastReviewedHash !== item.contentHash),
        studiedAt: progress.studiedAt,
        preview: null as ReturnType<typeof preview> | null,
      };
    });
    const current =
      items.find((item) => !item.skippedAt && !item.completedAt) ?? null;
    if (current?.mode === "recall") {
      current.preview = preview(this.progress(current.questionId).card, now);
    }
    return {
      ...session,
      items,
      current,
      done: items.filter((i) => i.completedAt || i.skippedAt).length,
    };
  }
  act(id: string, position: number, action: string, now = new Date()) {
    return this.transaction(() => {
      const session = this.session(id, now);
      const item = session.items[position];
      if (!item) throw new ReviewError("Question is not in this session.", 404);
      if (item.completedAt) {
        if (item.action !== action)
          throw new ReviewError("This attempt has already been saved.");
        return this.session(id, now);
      }
      if (session.current?.sessionPosition !== position || item.skippedAt)
        throw new ReviewError(
          "This question is no longer current. Refresh the session.",
        );
      if (action !== "skip") {
        if (item.mode === "study") {
          if (action !== "studied")
            throw new ReviewError(
              "Study must be confirmed before recall.",
              400,
            );
          const captured = this.db.connection
            .prepare(
              "SELECT expected_study_revision FROM recall_queue_items WHERE session_id=? AND position=?",
            )
            .get(id, position)!;
          this.markStudied(
            item.questionId,
            item.contentHash,
            true,
            now,
            captured.expected_study_revision as string | null,
          );
        } else {
          if (!(RATINGS as readonly string[]).includes(action))
            throw new ReviewError("Unknown assessment.", 400);
          const p = this.progress(item.questionId);
          const row = this.db.connection
            .prepare(
              "SELECT expected_version FROM recall_queue_items WHERE session_id=? AND position=?",
            )
            .get(id, position)!;
          if (!p.studiedAt || p.version !== Number(row.expected_version))
            throw new ReviewError(
              "Progress changed in another session. Skip this item and start a fresh queue.",
            );
          if (
            p.card &&
            new Date(JSON.parse(p.card).last_review).getTime() > now.getTime()
          )
            throw new ReviewError(
              "The clock is earlier than the last review. Check your system time.",
            );
          const next = schedule(p.card, action as Assessment, now);
          const q = this.db.getQuestion(item.questionId)!;
          const eventId = randomUUID();
          this.db.connection
            .prepare(
              `INSERT INTO review_events(id,question_id,reviewed_at,content_hash,outcome,
            previous_due_at,next_due_at,previous_interval_days,next_interval_days) VALUES (?,?,?,?,?,?,?,?,?)`,
            )
            .run(
              eventId,
              item.questionId,
              now.toISOString(),
              item.contentHash,
              action,
              q.dueAt,
              next.due.toISOString(),
              p.card ? JSON.parse(p.card).scheduled_days : null,
              next.scheduled_days,
            );
          this.db.connection
            .prepare(`INSERT INTO fsrs_event_details VALUES (?,?,?,?)`)
            .run(eventId, ENGINE, p.card, JSON.stringify(next));
          this.db.connection
            .prepare(
              `INSERT INTO fsrs_cards VALUES (?,?,?,?) ON CONFLICT(question_id) DO UPDATE SET
            card_json=excluded.card_json,engine=excluded.engine,version=excluded.version`,
            )
            .run(item.questionId, JSON.stringify(next), ENGINE, p.version + 1);
          this.db.connection
            .prepare(
              `INSERT INTO review_state(question_id,due_at,last_reviewed_at,last_reviewed_hash,
            interval_days,review_count,lapse_count) VALUES (?,?,?,?,?,?,?) ON CONFLICT(question_id) DO UPDATE SET
            due_at=excluded.due_at,last_reviewed_at=excluded.last_reviewed_at,last_reviewed_hash=excluded.last_reviewed_hash,
            interval_days=excluded.interval_days,review_count=review_state.review_count+1,lapse_count=review_state.lapse_count+?`,
            )
            .run(
              item.questionId,
              next.due.toISOString(),
              now.toISOString(),
              item.contentHash,
              next.scheduled_days,
              1,
              action === "Again" ? 1 : 0,
              action === "Again" ? 1 : 0,
            );
        }
      }
      this.db.connection
        .prepare(
          "UPDATE recall_queue_items SET action=?, completed_at=? WHERE session_id=? AND position=?",
        )
        .run(action, now.toISOString(), id, position);
      const result = this.session(id, now);
      if (!result.current) {
        this.db.connection
          .prepare("UPDATE review_sessions SET completed_at=? WHERE id=?")
          .run(now.toISOString(), id);
        result.completedAt = now.toISOString();
      }
      return result;
    });
  }
}
