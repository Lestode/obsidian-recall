import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { randomUUID } from "node:crypto";

export interface IndexedQuestionRecord {
  id: string;
  collectionPath: string;
  filePath: string;
  topic: string;
  sectionPath: string[];
  questionOrdinal: number;
  prompt: string;
  answer: string;
  contentHash: string;
}

export interface QuestionListItem extends IndexedQuestionRecord {
  archivedAt: string | null;
  dueAt: string | null;
  lastReviewedAt: string | null;
  lastReviewedHash: string | null;
  status: "new" | "reviewed" | "changed" | "due" | "archived";
}

export interface CollectionSummary {
  collectionPath: string;
  questionCount: number;
  changedCount: number;
  dueCount: number;
  newCount: number;
}

export interface DatabaseStatus {
  revision: number;
  activeQuestions: number;
  archivedQuestions: number;
  collections: number;
  lastReconciledAt: string | null;
}

export interface StudyState {
  questionId: string;
  contentHash: string;
  studiedAt: string | null;
  studiedContentHash: string | null;
  revision: string | null;
  contentChanged: boolean;
}

export class StudyConflict extends Error {}

export interface ReviewSessionItem {
  sessionPosition: number;
  questionId: string;
  contentHash: string;
  prompt: string;
  answer: string;
  skippedAt: string | null;
}

export interface ReviewSession {
  id: string;
  createdAt: string;
  completedAt: string | null;
  databaseRevision: number;
  scope: unknown;
  items: ReviewSessionItem[];
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function text(row: Record<string, unknown>, key: string): string {
  return String(row[key] ?? "");
}

function nullableText(row: Record<string, unknown>, key: string): string | null {
  return row[key] === null || row[key] === undefined ? null : String(row[key]);
}

function integer(row: Record<string, unknown>, key: string): number {
  return Number(row[key] ?? 0);
}

export class RecallDatabase {
  readonly connection: DatabaseSync;

  constructor(path: string) {
    this.connection = new DatabaseSync(path);
    this.connection.exec("PRAGMA foreign_keys = ON");
    this.connection.exec("PRAGMA journal_mode = WAL");
    this.connection.exec("PRAGMA busy_timeout = 5000");
    this.migrate();
  }

  close(): void {
    this.connection.close();
  }

  private migrate(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY,
        collection_path TEXT NOT NULL,
        file_path TEXT NOT NULL,
        topic TEXT NOT NULL,
        section_path_json TEXT NOT NULL,
        question_ordinal INTEGER NOT NULL,
        prompt TEXT NOT NULL,
        answer TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_questions_collection_order
        ON questions(collection_path, file_path, question_ordinal);
      CREATE INDEX IF NOT EXISTS idx_questions_file
        ON questions(file_path);
      CREATE INDEX IF NOT EXISTS idx_questions_archive
        ON questions(archived_at);

      CREATE TABLE IF NOT EXISTS question_versions (
        question_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        prompt TEXT NOT NULL,
        answer TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        PRIMARY KEY(question_id, content_hash),
        FOREIGN KEY(question_id) REFERENCES questions(id)
      );

      CREATE TABLE IF NOT EXISTS review_events (
        id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL,
        reviewed_at TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        outcome TEXT NOT NULL,
        previous_due_at TEXT,
        next_due_at TEXT,
        previous_interval_days REAL,
        next_interval_days REAL,
        FOREIGN KEY(question_id) REFERENCES questions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_review_events_question_time
        ON review_events(question_id, reviewed_at);

      CREATE TABLE IF NOT EXISTS review_state (
        question_id TEXT PRIMARY KEY,
        due_at TEXT,
        last_reviewed_at TEXT,
        last_reviewed_hash TEXT,
        interval_days REAL,
        review_count INTEGER NOT NULL DEFAULT 0,
        lapse_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(question_id) REFERENCES questions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_review_state_due
        ON review_state(due_at);

      CREATE TABLE IF NOT EXISTS study_state (
        question_id TEXT PRIMARY KEY,
        studied_at TEXT,
        studied_content_hash TEXT,
        revision TEXT NOT NULL,
        FOREIGN KEY(question_id) REFERENCES questions(id)
      );

      CREATE TABLE IF NOT EXISTS review_sessions (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        database_revision INTEGER NOT NULL,
        scope_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS review_session_items (
        session_id TEXT NOT NULL,
        session_position INTEGER NOT NULL,
        question_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        skipped_at TEXT,
        PRIMARY KEY(session_id, session_position),
        FOREIGN KEY(session_id) REFERENCES review_sessions(id),
        FOREIGN KEY(question_id) REFERENCES questions(id)
      );

      INSERT OR IGNORE INTO metadata(key, value) VALUES ('revision', '0');
    `);
  }

  bindVault(vaultPath: string): void {
    this.transaction(() => {
      const row = this.connection.prepare("SELECT value FROM metadata WHERE key = 'vault_path'").get();
      if (row && row.value !== vaultPath) {
        throw new Error("This database belongs to another vault. Use a separate --database path.");
      }
      this.connection.prepare("INSERT OR IGNORE INTO metadata(key, value) VALUES ('vault_path', ?)").run(vaultPath);
    });
  }

  getStudyState(id: string): StudyState | null {
    const row = this.connection.prepare(`
      SELECT q.id, q.content_hash, s.studied_at, s.studied_content_hash, s.revision
      FROM questions q LEFT JOIN study_state s ON s.question_id = q.id WHERE q.id = ?
    `).get(id);
    if (!row) return null;
    const studiedAt = nullableText(row, "studied_at");
    const studiedContentHash = nullableText(row, "studied_content_hash");
    return {
      questionId: text(row, "id"), contentHash: text(row, "content_hash"),
      studiedAt, studiedContentHash, revision: nullableText(row, "revision"),
      contentChanged: studiedAt !== null && studiedContentHash !== row.content_hash,
    };
  }

  setStudied(options: {
    questionId: string; filePath: string; contentHash: string;
    studied: boolean; expectedRevision: string | null;
  }, at = new Date().toISOString()): StudyState {
    return this.transaction(() => {
      const question = this.getQuestion(options.questionId);
      const previous = this.getStudyState(options.questionId);
      if (!question || question.archivedAt || question.filePath !== options.filePath ||
          question.contentHash !== options.contentHash || !previous ||
          previous.revision !== options.expectedRevision) {
        throw new StudyConflict("Question or progress changed. Wait for synchronization and retry.");
      }
      // A repeated study action does not silently acknowledge edited content.
      if (options.studied && previous.studiedAt) return previous;
      this.connection.prepare(`
        INSERT INTO study_state(question_id, studied_at, studied_content_hash, revision)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(question_id) DO UPDATE SET studied_at = excluded.studied_at,
          studied_content_hash = excluded.studied_content_hash, revision = excluded.revision
      `).run(options.questionId, options.studied ? at : null,
        options.studied ? options.contentHash : null, randomUUID());
      return this.getStudyState(options.questionId)!;
    });
  }

  reconcileFull(
    records: IndexedQuestionRecord[],
    reconciledAt = new Date().toISOString(),
    protectedFilePaths: string[] = [],
  ): number {
    return this.transaction(() => {
      const protection = protectedFilePaths.length
        ? `AND file_path NOT IN (${placeholders(protectedFilePaths.length)})`
        : "";
      this.connection.prepare(`
        UPDATE questions
        SET archived_at = COALESCE(archived_at, ?)
        WHERE archived_at IS NULL
        ${protection}
      `).run(reconciledAt, ...protectedFilePaths);
      this.upsertRecords(records, reconciledAt);
      this.skipArchivedSessionItems(reconciledAt);
      return this.advanceRevision(reconciledAt);
    });
  }

  reconcileFiles(
    filePaths: string[],
    records: IndexedQuestionRecord[],
    reconciledAt = new Date().toISOString(),
  ): number {
    if (filePaths.length === 0) return this.revision();
    return this.transaction(() => {
      this.connection.prepare(`
        UPDATE questions
        SET archived_at = COALESCE(archived_at, ?)
        WHERE file_path IN (${placeholders(filePaths.length)})
      `).run(reconciledAt, ...filePaths);
      this.upsertRecords(records, reconciledAt);
      this.skipArchivedSessionItems(reconciledAt);
      return this.advanceRevision(reconciledAt);
    });
  }

  private upsertRecords(records: IndexedQuestionRecord[], observedAt: string): void {
    const upsertQuestion = this.connection.prepare(`
      INSERT INTO questions (
        id, collection_path, file_path, topic, section_path_json,
        question_ordinal, prompt, answer, content_hash,
        first_seen_at, last_seen_at, archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET
        collection_path = excluded.collection_path,
        file_path = excluded.file_path,
        topic = excluded.topic,
        section_path_json = excluded.section_path_json,
        question_ordinal = excluded.question_ordinal,
        prompt = excluded.prompt,
        answer = excluded.answer,
        content_hash = excluded.content_hash,
        last_seen_at = excluded.last_seen_at,
        archived_at = NULL
    `);
    const insertVersion = this.connection.prepare(`
      INSERT OR IGNORE INTO question_versions (
        question_id, content_hash, prompt, answer, first_seen_at
      ) VALUES (?, ?, ?, ?, ?)
    `);

    for (const record of records) {
      upsertQuestion.run(
        record.id,
        record.collectionPath,
        record.filePath,
        record.topic,
        JSON.stringify(record.sectionPath),
        record.questionOrdinal,
        record.prompt,
        record.answer,
        record.contentHash,
        observedAt,
        observedAt,
      );
      insertVersion.run(
        record.id,
        record.contentHash,
        record.prompt,
        record.answer,
        observedAt,
      );
    }
  }

  private skipArchivedSessionItems(skippedAt: string): void {
    this.connection.prepare(`
      UPDATE review_session_items
      SET skipped_at = ?
      WHERE skipped_at IS NULL
        AND EXISTS (
          SELECT 1 FROM questions q
          WHERE q.id = review_session_items.question_id
            AND q.archived_at IS NOT NULL
        )
    `).run(skippedAt);
  }

  activeIdentityLocationsExcluding(filePaths: string[]): Map<string, string> {
    const where = filePaths.length
      ? `archived_at IS NULL AND file_path NOT IN (${placeholders(filePaths.length)})`
      : "archived_at IS NULL";
    const rows = this.connection.prepare(
      `SELECT id, file_path FROM questions WHERE ${where}`,
    ).all(...filePaths);
    return new Map(rows.map((row) => [text(row, "id"), text(row, "file_path")]));
  }

  activeFilePaths(): string[] {
    return this.connection.prepare(`
      SELECT DISTINCT file_path FROM questions
      WHERE archived_at IS NULL
      ORDER BY file_path
    `).all().map((row) => text(row, "file_path"));
  }

  activeCollectionPaths(): string[] {
    return this.connection.prepare(`
      SELECT DISTINCT collection_path FROM questions
      WHERE archived_at IS NULL
      ORDER BY collection_path
    `).all().map((row) => text(row, "collection_path"));
  }

  revision(): number {
    const row = this.connection.prepare(
      "SELECT value FROM metadata WHERE key = 'revision'",
    ).get();
    return row ? Number(row.value) : 0;
  }

  status(): DatabaseStatus {
    const row = this.connection.prepare(`
      SELECT
        SUM(CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END) AS active_questions,
        SUM(CASE WHEN archived_at IS NOT NULL THEN 1 ELSE 0 END) AS archived_questions,
        COUNT(DISTINCT CASE WHEN archived_at IS NULL THEN collection_path END) AS collections
      FROM questions
    `).get() ?? {};
    const reconciled = this.connection.prepare(
      "SELECT value FROM metadata WHERE key = 'last_reconciled_at'",
    ).get();
    return {
      revision: this.revision(),
      activeQuestions: integer(row, "active_questions"),
      archivedQuestions: integer(row, "archived_questions"),
      collections: integer(row, "collections"),
      lastReconciledAt: reconciled ? String(reconciled.value) : null,
    };
  }

  listCollections(now = new Date().toISOString(), includeArchived = false): CollectionSummary[] {
    return this.connection.prepare(`
      SELECT
        q.collection_path,
        COUNT(*) AS question_count,
        SUM(CASE WHEN q.archived_at IS NULL AND rs.question_id IS NULL THEN 1 ELSE 0 END) AS new_count,
        SUM(CASE WHEN q.archived_at IS NULL AND rs.question_id IS NOT NULL AND rs.last_reviewed_hash <> q.content_hash THEN 1 ELSE 0 END) AS changed_count,
        SUM(CASE WHEN q.archived_at IS NULL AND rs.due_at IS NOT NULL AND rs.due_at <= ? THEN 1 ELSE 0 END) AS due_count
      FROM questions q
      LEFT JOIN review_state rs ON rs.question_id = q.id
      WHERE q.archived_at IS NULL OR ? = 1
      GROUP BY q.collection_path
      ORDER BY q.collection_path
    `).all(now, includeArchived ? 1 : 0).map((row) => ({
      collectionPath: text(row, "collection_path"),
      questionCount: integer(row, "question_count"),
      newCount: integer(row, "new_count"),
      changedCount: integer(row, "changed_count"),
      dueCount: integer(row, "due_count"),
    }));
  }

  listQuestions(options: {
    collectionPath?: string;
    includeArchived?: boolean;
    filePaths?: string[];
  } = {}): QuestionListItem[] {
    const conditions: string[] = [];
    const values: SQLInputValue[] = [];
    if (!options.includeArchived) conditions.push("q.archived_at IS NULL");
    if (options.collectionPath) {
      conditions.push("q.collection_path = ?");
      values.push(options.collectionPath);
    }
    if (options.filePaths) {
      if (options.filePaths.length === 0) return [];
      conditions.push(`q.file_path IN (${placeholders(options.filePaths.length)})`);
      values.push(...options.filePaths);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const now = new Date().toISOString();
    values.unshift(now);
    const rows = this.connection.prepare(`
      SELECT q.*, rs.due_at, rs.last_reviewed_at, rs.last_reviewed_hash,
        CASE
          WHEN q.archived_at IS NOT NULL THEN 'archived'
          WHEN rs.question_id IS NULL THEN 'new'
          WHEN rs.last_reviewed_hash <> q.content_hash THEN 'changed'
          WHEN rs.due_at IS NOT NULL AND rs.due_at <= ? THEN 'due'
          ELSE 'reviewed'
        END AS status
      FROM questions q
      LEFT JOIN review_state rs ON rs.question_id = q.id
      ${where}
      ORDER BY q.collection_path, q.file_path, q.question_ordinal
    `).all(...values);
    return rows.map((row) => this.mapQuestion(row));
  }

  getQuestion(id: string): QuestionListItem | null {
    const now = new Date().toISOString();
    const row = this.connection.prepare(`
      SELECT q.*, rs.due_at, rs.last_reviewed_at, rs.last_reviewed_hash,
        CASE
          WHEN q.archived_at IS NOT NULL THEN 'archived'
          WHEN rs.question_id IS NULL THEN 'new'
          WHEN rs.last_reviewed_hash <> q.content_hash THEN 'changed'
          WHEN rs.due_at IS NOT NULL AND rs.due_at <= ? THEN 'due'
          ELSE 'reviewed'
        END AS status
      FROM questions q
      LEFT JOIN review_state rs ON rs.question_id = q.id
      WHERE q.id = ?
    `).get(now, id);
    return row ? this.mapQuestion(row) : null;
  }

  createSession(
    scope: unknown,
    orderedQuestionIds: string[],
    createdAt = new Date().toISOString(),
    id: string = randomUUID(),
  ): ReviewSession {
    return this.transaction(() => {
      const revision = this.revision();
      const lookup = this.connection.prepare(`
        SELECT id, content_hash FROM questions
        WHERE id = ? AND archived_at IS NULL
      `);
      const items = orderedQuestionIds.map((questionId) => {
        const row = lookup.get(questionId);
        if (!row) throw new Error(`Cannot add missing or archived question ${questionId} to a review session.`);
        return { questionId, contentHash: text(row, "content_hash") };
      });

      this.connection.prepare(`
        INSERT INTO review_sessions(id, created_at, database_revision, scope_json)
        VALUES (?, ?, ?, ?)
      `).run(id, createdAt, revision, JSON.stringify(scope));
      const insertItem = this.connection.prepare(`
        INSERT INTO review_session_items(
          session_id, session_position, question_id, content_hash
        ) VALUES (?, ?, ?, ?)
      `);
      items.forEach((item, position) => {
        insertItem.run(id, position, item.questionId, item.contentHash);
      });
      const session = this.getSession(id);
      if (!session) throw new Error(`Could not read newly created review session ${id}.`);
      return session;
    });
  }

  getSession(id: string): ReviewSession | null {
    const row = this.connection.prepare(`
      SELECT id, created_at, completed_at, database_revision, scope_json
      FROM review_sessions WHERE id = ?
    `).get(id);
    if (!row) return null;
    const items = this.connection.prepare(`
      SELECT rsi.session_position, rsi.question_id, rsi.content_hash,
        rsi.skipped_at, qv.prompt, qv.answer
      FROM review_session_items rsi
      JOIN question_versions qv
        ON qv.question_id = rsi.question_id
       AND qv.content_hash = rsi.content_hash
      WHERE rsi.session_id = ?
      ORDER BY rsi.session_position
    `).all(id).map((item) => ({
      sessionPosition: integer(item, "session_position"),
      questionId: text(item, "question_id"),
      contentHash: text(item, "content_hash"),
      prompt: text(item, "prompt"),
      answer: text(item, "answer"),
      skippedAt: nullableText(item, "skipped_at"),
    }));
    return {
      id: text(row, "id"),
      createdAt: text(row, "created_at"),
      completedAt: nullableText(row, "completed_at"),
      databaseRevision: integer(row, "database_revision"),
      scope: JSON.parse(text(row, "scope_json")) as unknown,
      items,
    };
  }

  private mapQuestion(row: Record<string, unknown>): QuestionListItem {
    return {
      id: text(row, "id"),
      collectionPath: text(row, "collection_path"),
      filePath: text(row, "file_path"),
      topic: text(row, "topic"),
      sectionPath: JSON.parse(text(row, "section_path_json")) as string[],
      questionOrdinal: integer(row, "question_ordinal"),
      prompt: text(row, "prompt"),
      answer: text(row, "answer"),
      contentHash: text(row, "content_hash"),
      archivedAt: nullableText(row, "archived_at"),
      dueAt: nullableText(row, "due_at"),
      lastReviewedAt: nullableText(row, "last_reviewed_at"),
      lastReviewedHash: nullableText(row, "last_reviewed_hash"),
      status: text(row, "status") as QuestionListItem["status"],
    };
  }

  private advanceRevision(reconciledAt: string): number {
    const revision = this.revision() + 1;
    const set = this.connection.prepare(`
      INSERT INTO metadata(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    set.run("revision", String(revision));
    set.run("last_reconciled_at", reconciledAt);
    return revision;
  }

  private transaction<T>(operation: () => T): T {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }
}
