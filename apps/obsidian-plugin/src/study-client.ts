import type { StudyState } from "@recall/database";

export type StudyTransport = (route: string, body?: unknown) => Promise<unknown>;
type FileState = { states: Map<string, StudyState>; error: string | null; loaded: boolean };

/** Shared by every rendered instance of a question, without writing authored notes. */
export class StudyClient {
  private files = new Map<string, FileState>();
  private listeners = new Map<string, Set<() => void>>();
  private loads = new Map<string, Promise<void>>();
  private generations = new Map<string, number>();
  private busy = new Set<string>();

  constructor(private transport: StudyTransport) {}

  snapshot(file: string): FileState {
    return this.files.get(file) ?? { states: new Map(), error: null, loaded: false };
  }

  isBusy(id: string): boolean { return this.busy.has(id); }

  subscribe(file: string, listener: () => void): () => void {
    let listeners = this.listeners.get(file);
    if (!listeners) this.listeners.set(file, listeners = new Set());
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(file);
    };
  }

  private notify(file: string): void {
    for (const listener of this.listeners.get(file) ?? []) listener();
  }

  async refreshVisible(): Promise<void> {
    await Promise.all([...this.listeners.keys()].map(file => this.load(file)));
  }

  load(file: string): Promise<void> {
    const existing = this.loads.get(file);
    if (existing) return existing;
    const generation = this.generations.get(file) ?? 0;
    const task = (async () => {
      try {
        const result = await this.transport(`/api/study?file=${encodeURIComponent(file)}`) as { states: StudyState[] };
        if (!Array.isArray(result.states)) throw new Error("Study service needs updating.");
        if ((this.generations.get(file) ?? 0) !== generation) return;
        this.files.set(file, {
          states: new Map(result.states.map(state => [state.questionId, state])), error: null, loaded: true,
        });
      } catch (error) {
        if ((this.generations.get(file) ?? 0) !== generation) return;
        this.files.set(file, { ...this.snapshot(file), error: error instanceof Error ? error.message : String(error) });
      } finally { this.notify(file); }
    })().finally(() => { this.loads.delete(file); });
    this.loads.set(file, task);
    return task;
  }

  async setStudied(file: string, id: string, contentHash: string, studied: boolean): Promise<boolean> {
    if (this.busy.has(id)) return false;
    const previous = this.snapshot(file).states.get(id);
    if (!previous || previous.contentHash !== contentHash || this.snapshot(file).error) {
      await this.load(file);
      return false;
    }
    this.busy.add(id);
    this.generations.set(file, (this.generations.get(file) ?? 0) + 1);
    this.notify(file);
    try {
      const result = await this.transport("/api/study", {
        questionId: id, filePath: file, contentHash, studied, expectedRevision: previous.revision,
      }) as { state: StudyState };
      if (result.state?.questionId !== id) throw new Error("Could not confirm saved study progress.");
      const current = this.snapshot(file);
      this.files.set(file, { ...current, states: new Map(current.states).set(id, result.state), error: null });
      return true;
    } catch (error) {
      this.files.set(file, { ...this.snapshot(file), error: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      this.generations.set(file, (this.generations.get(file) ?? 0) + 1);
      this.busy.delete(id);
      this.notify(file);
    }
  }

  async toggleStudied(file: string, id: string, contentHash: string): Promise<boolean | null> {
    const previous = this.snapshot(file).states.get(id);
    if (!previous || this.snapshot(file).error || previous.contentHash !== contentHash) {
      await this.load(file);
      return null;
    }
    const studied = !previous.studiedAt;
    return await this.setStudied(file, id, contentHash, studied) ? studied : null;
  }
}

export function loopbackServiceUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Use a loopback address such as http://127.0.0.1:45871.");
  }
  return url.origin;
}
