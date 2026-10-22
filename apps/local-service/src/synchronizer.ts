import { EventEmitter } from "node:events";
import { watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { RecallDatabase } from "@recall/database";
import { markerRoot, RECALL_MARKER_FILE } from "@recall/core";
import { scanChangedFiles, scanVault, type ScanDiagnostic } from "./scanner";

export interface SyncEvent {
  type: "reconciled" | "error";
  revision: number;
  full: boolean;
  filePaths: string[];
  diagnostics?: ScanDiagnostic[];
  message?: string;
}

export class RecallSynchronizer extends EventEmitter {
  private markerPaths: string[] = [];
  private watcher: FSWatcher | null = null;
  private dirtyPaths = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private forceFull = false;
  private running = false;
  private queued = false;
  private diagnosticsByFile = new Map<string, ScanDiagnostic[]>();
  private missingFirstSeen = new Map<string, number>();
  private missingTimers = new Map<string, NodeJS.Timeout>();
  private missingMarkerFirstSeen = new Map<string, number>();
  private missingMarkerTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    readonly vaultPath: string,
    readonly database: RecallDatabase,
    readonly debounceMs = 250,
    readonly missingGraceMs = 1_000,
  ) {
    super();
  }

  async start(): Promise<void> {
    try {
      await this.reconcileFull();
    } catch (error) {
      this.emitFailure(error, true, []);
    }
    this.watcher = watch(this.vaultPath, { recursive: true }, (_event, filename) => {
      if (!filename) {
        this.forceFull = true;
      } else {
        const relative = filename.split(path.sep).join("/");
        if (relative.split("/").some((part) =>
          part === ".obsidian" || part === ".git" || part === "node_modules")) return;
        if (this.markerPaths.length === 0 || path.posix.basename(relative) === RECALL_MARKER_FILE) {
          this.forceFull = true;
        } else if (!relative.toLowerCase().endsWith(".md")) {
          if (!path.posix.extname(relative)) this.forceFull = true;
          else return;
        }
        this.dirtyPaths.add(relative);
      }
      this.schedule();
    });
  }

  requestFullReconcile(): void {
    this.forceFull = true;
    this.schedule();
  }

  async canStudy(filePath: string, id: string, contentHash: string): Promise<boolean> {
    if (this.diagnosticsByFile.has(filePath)) return false;
    const question = this.database.getQuestion(id);
    if (!question || question.archivedAt || question.filePath !== filePath) return false;
    const marker = question.collectionPath === "." ? RECALL_MARKER_FILE
      : `${question.collectionPath}/${RECALL_MARKER_FILE}`;
    try {
      if (!(await stat(path.join(this.vaultPath, marker))).isFile()) return false;
      const scan = await scanChangedFiles(this.vaultPath, [filePath], [marker], this.database);
      return !scan.diagnostics.length && scan.records.some(record =>
        record.id === id && record.contentHash === contentHash);
    } catch {
      return false;
    }
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const timer of this.missingTimers.values()) clearTimeout(timer);
    this.missingTimers.clear();
    for (const timer of this.missingMarkerTimers.values()) clearTimeout(timer);
    this.missingMarkerTimers.clear();
  }

  async reconcileFull(): Promise<number> {
    const result = await scanVault(this.vaultPath);
    const observedMarkers = new Set(result.markerPaths);
    for (const markerPath of observedMarkers) this.clearMissingMarker(markerPath);
    const indexedMarkers = this.database.activeCollectionPaths().map((collectionPath) =>
      collectionPath === "."
        ? RECALL_MARKER_FILE
        : `${collectionPath}/${RECALL_MARKER_FILE}`);
    const missingMarkers = this.observeMissingMarkers(
      [...new Set([...this.markerPaths, ...indexedMarkers])]
        .filter((markerPath) => !observedMarkers.has(markerPath)),
    );
    const pendingMarkerRoots = missingMarkers.pending
      .map(markerRoot)
      .filter((root): root is string => root !== null);
    const observedPaths = new Set(result.markdownPaths);
    for (const filePath of observedPaths) this.clearMissing(filePath);
    const previouslyActiveButAbsent = this.database.activeFilePaths()
      .filter((filePath) => !observedPaths.has(filePath));
    const missing = this.observeMissing(previouslyActiveButAbsent);
    const activeFilePaths = this.database.activeFilePaths();
    const filesUnderPendingMarkers = activeFilePaths.filter((filePath) =>
      pendingMarkerRoots.some((root) => {
        return root === "" || filePath.startsWith(`${root}/`);
      }));
    const protectedFilePaths = [...new Set([
      ...result.blockedFilePaths,
      ...missing.pending,
      ...filesUnderPendingMarkers,
    ])];
    const revision = this.database.reconcileFull(
      result.records.filter((record) => !pendingMarkerRoots.some((root) =>
        root === "" || record.filePath.startsWith(`${root}/`))),
      new Date().toISOString(),
      protectedFilePaths,
    );
    this.markerPaths = [...new Set([...result.markerPaths, ...missingMarkers.pending])];
    this.replaceDiagnostics(result.diagnostics);
    this.emitEvent({
      type: "reconciled",
      revision,
      full: true,
      filePaths: result.markdownPaths,
    });
    this.emitCurrentDiagnostics(true);
    return revision;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  private async flush(): Promise<void> {
    this.timer = null;
    if (this.running) {
      this.queued = true;
      return;
    }
    this.running = true;
    const filePaths = [...this.dirtyPaths];
    const full = this.forceFull;
    this.dirtyPaths.clear();
    this.forceFull = false;

    try {
      if (full) {
        await this.reconcileFull();
      } else if (filePaths.length) {
        const result = await scanChangedFiles(
          this.vaultPath,
          filePaths,
          this.markerPaths,
          this.database,
        );
        for (const filePath of [...result.filePaths, ...result.blockedFilePaths]) {
          this.clearMissing(filePath);
        }
        const missing = this.observeMissing(result.missingFilePaths);
        const reconciledPaths = [...new Set([...result.filePaths, ...missing.confirmed])];
        const revision = this.database.reconcileFiles(reconciledPaths, result.records);
        this.updateDiagnostics(
          [...result.filePaths, ...result.blockedFilePaths, ...missing.confirmed],
          result.diagnostics,
        );
        const duplicateNeedsGlobalRecheck = result.diagnostics.some(
          (diagnostic) => diagnostic.kind === "duplicate-identity",
        ) || (reconciledPaths.length > 0 && [...this.diagnosticsByFile.values()]
          .flat()
          .some((diagnostic) => diagnostic.kind === "duplicate-identity"));
        if (duplicateNeedsGlobalRecheck) this.forceFull = true;
        if (reconciledPaths.length) {
          this.emitEvent({
            type: "reconciled",
            revision,
            full: false,
            filePaths: reconciledPaths,
          });
        }
        this.emitCurrentDiagnostics(false);
      }
    } catch (error) {
      this.emitFailure(error, full, filePaths);
    } finally {
      this.running = false;
      if (this.queued || this.dirtyPaths.size || this.forceFull) {
        this.queued = false;
        this.schedule();
      }
    }
  }

  private emitEvent(event: SyncEvent): void {
    this.emit("sync", event);
  }

  private emitFailure(error: unknown, full: boolean, filePaths: string[]): void {
    this.emitEvent({
      type: "error",
      revision: this.database.revision(),
      full,
      filePaths,
      diagnostics: undefined,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  private observeMissing(filePaths: string[]): {
    confirmed: string[];
    pending: string[];
  } {
    const confirmed: string[] = [];
    const pending: string[] = [];
    const now = Date.now();
    for (const filePath of filePaths) {
      const firstSeen = this.missingFirstSeen.get(filePath);
      if (firstSeen !== undefined && now - firstSeen >= this.missingGraceMs) {
        confirmed.push(filePath);
        this.clearMissing(filePath);
        continue;
      }
      if (firstSeen === undefined) this.missingFirstSeen.set(filePath, now);
      pending.push(filePath);
      const remaining = firstSeen === undefined
        ? this.missingGraceMs
        : Math.max(0, this.missingGraceMs - (now - firstSeen));
      this.scheduleMissingRecheck(filePath, remaining);
    }
    return { confirmed, pending };
  }

  private scheduleMissingRecheck(filePath: string, delay: number): void {
    if (this.missingTimers.has(filePath)) return;
    const timer = setTimeout(() => {
      this.missingTimers.delete(filePath);
      this.dirtyPaths.add(filePath);
      this.schedule();
    }, delay);
    this.missingTimers.set(filePath, timer);
  }

  private clearMissing(filePath: string): void {
    this.missingFirstSeen.delete(filePath);
    const timer = this.missingTimers.get(filePath);
    if (timer) clearTimeout(timer);
    this.missingTimers.delete(filePath);
  }

  private observeMissingMarkers(markerPaths: string[]): {
    confirmed: string[];
    pending: string[];
  } {
    const confirmed: string[] = [];
    const pending: string[] = [];
    const now = Date.now();
    for (const markerPath of markerPaths) {
      const firstSeen = this.missingMarkerFirstSeen.get(markerPath);
      if (firstSeen !== undefined && now - firstSeen >= this.missingGraceMs) {
        confirmed.push(markerPath);
        this.clearMissingMarker(markerPath);
        continue;
      }
      if (firstSeen === undefined) this.missingMarkerFirstSeen.set(markerPath, now);
      pending.push(markerPath);
      const remaining = firstSeen === undefined
        ? this.missingGraceMs
        : Math.max(0, this.missingGraceMs - (now - firstSeen));
      this.scheduleMarkerRecheck(markerPath, remaining);
    }
    return { confirmed, pending };
  }

  private scheduleMarkerRecheck(markerPath: string, delay: number): void {
    if (this.missingMarkerTimers.has(markerPath)) return;
    const timer = setTimeout(() => {
      this.missingMarkerTimers.delete(markerPath);
      this.forceFull = true;
      this.schedule();
    }, delay);
    this.missingMarkerTimers.set(markerPath, timer);
  }

  private clearMissingMarker(markerPath: string): void {
    this.missingMarkerFirstSeen.delete(markerPath);
    const timer = this.missingMarkerTimers.get(markerPath);
    if (timer) clearTimeout(timer);
    this.missingMarkerTimers.delete(markerPath);
  }

  private replaceDiagnostics(diagnostics: ScanDiagnostic[]): void {
    this.diagnosticsByFile.clear();
    this.updateDiagnostics([], diagnostics);
  }

  private updateDiagnostics(scannedFilePaths: string[], diagnostics: ScanDiagnostic[]): void {
    for (const filePath of scannedFilePaths) this.diagnosticsByFile.delete(filePath);
    const grouped = new Map<string, ScanDiagnostic[]>();
    for (const diagnostic of diagnostics) {
      const entries = grouped.get(diagnostic.filePath) ?? [];
      entries.push(diagnostic);
      grouped.set(diagnostic.filePath, entries);
    }
    for (const [filePath, entries] of grouped) this.diagnosticsByFile.set(filePath, entries);
  }

  private emitCurrentDiagnostics(full: boolean): void {
    const diagnostics = [...this.diagnosticsByFile.values()].flat();
    if (!diagnostics.length) return;
    this.emitEvent({
      type: "error",
      revision: this.database.revision(),
      full,
      filePaths: [...this.diagnosticsByFile.keys()],
      diagnostics,
      message: diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
    });
  }
}
