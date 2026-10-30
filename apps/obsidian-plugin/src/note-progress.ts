import { duplicateQuestionIds, hashQuestionContent, orphanRecallIdentities, parseRecallQuestions } from "@recall/core";
import type { FileState } from "./study-client";

export async function noteQuestionHashes(markdown: string): Promise<Map<string, string> | null> {
  const questions = parseRecallQuestions(markdown);
  if (questions.some(question => !question.id) || duplicateQuestionIds(questions).size ||
      orphanRecallIdentities(markdown, questions).length) return null;
  return new Map(await Promise.all(questions.map(async question =>
    [question.id!, await hashQuestionContent(question.prompt, question.answer)] as const)));
}

export interface NoteProgress {
  label: string;
  description: string;
  tone: "complete" | "incomplete" | "unknown";
  changed: boolean;
  hidden: boolean;
}

export function noteProgress(snapshot: FileState, hashes: Map<string, string> | null | undefined): NoteProgress {
  const unknown = (label: string, description: string): NoteProgress => ({
    label, description, tone: "unknown", changed: false, hidden: false,
  });
  if (hashes?.size === 0) return { ...unknown("", ""), hidden: true };
  if (snapshot.error) return unknown("Unavailable", snapshot.error);
  if (!snapshot.loaded || hashes === undefined) return unknown("Loading…", "Loading question progress.");
  if (!snapshot.synchronized || hashes === null || hashes.size !== snapshot.states.size ||
      [...hashes].some(([id, hash]) => snapshot.states.get(id)?.contentHash !== hash)) {
    return unknown("Syncing…", "The current note is invalid or has not synchronized. Wait for synchronization; check Recall diagnostics if this persists.");
  }
  const states = [...snapshot.states.values()];
  const studied = states.filter(state => state.studiedAt !== null).length;
  const complete = studied === states.length;
  const changed = states.some(state => state.contentChanged);
  return {
    label: complete ? "✓ Completed" : `${studied}/${states.length}`,
    description: `${complete ? "Completed. " : "In progress. "}${studied} of ${states.length} questions reviewed.${changed ? " Content changed since studying." : ""}`,
    tone: complete ? "complete" : "incomplete", changed, hidden: false,
  };
}
