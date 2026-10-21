export const RECALL_MARKER_FILE = "_recall.md";
export const QUESTION_PREFIX = "**Q:**";

const QUESTION_RE = /^\*\*Q:\*\*(?:[ \t]+(.*?))?[ \t]*$/;
const ID_RE = /^\s*<!--\s*recall:id=([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\s*-->\s*$/i;
const HEADING_BOUNDARY_RE = /^ {0,3}#{1,2}(?:\s+|$)/;
const ANY_HEADING_RE = /^ {0,3}#{1,6}(?:\s+|$)/;
const SETEXT_HEADING_RE = /^ {0,3}(=+|-+)[ \t]*$/;
const LIST_ITEM_RE = /^ {0,3}(?:[-+*]|\d+[.)])(?:[ \t]+|$)/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

export interface RecallQuestion {
  id: string | null;
  prompt: string;
  answer: string;
  questionLine: number;
  identityLine: number | null;
  answerStartLine: number;
  endLine: number;
}

export interface OrphanRecallIdentity {
  id: string;
  line: number;
}

interface FenceState {
  character: "`" | "~";
  length: number;
}

function fenceAt(line: string): FenceState | null {
  const match = line.match(FENCE_RE);
  if (!match?.[1]) return null;
  return {
    character: match[1][0] as "`" | "~",
    length: match[1].length,
  };
}

function closesFence(line: string, fence: FenceState): boolean {
  const match = line.match(FENCE_RE);
  if (!match?.[1]) return false;
  return match[1][0] === fence.character && match[1].length >= fence.length;
}

function structuralLines(lines: string[]): {
  question: boolean;
  boundary: boolean;
  identityId: string | null;
}[] {
  const structure: {
    question: boolean;
    boundary: boolean;
    identityId: string | null;
  }[] = [];
  let fence: FenceState | null = null;
  let previousWasFenceClose = false;
  const frontMatterEnd = lines[0]?.trim() === "---"
    ? lines.findIndex((line, index) => index > 0 && line.trim() === "---")
    : -1;

  for (const [index, line] of lines.entries()) {
    if (frontMatterEnd >= 0 && index <= frontMatterEnd) {
      structure.push({ question: false, boundary: false, identityId: null });
      continue;
    }
    if (fence) {
      structure.push({ question: false, boundary: false, identityId: null });
      if (closesFence(line, fence)) {
        fence = null;
        previousWasFenceClose = true;
      } else {
        previousWasFenceClose = false;
      }
      continue;
    }

    const openingFence = fenceAt(line);
    if (openingFence) {
      fence = openingFence;
      structure.push({ question: false, boundary: false, identityId: null });
      previousWasFenceClose = false;
      continue;
    }

    const previousLine = lines[index - 1] ?? "";
    const beginsParagraph = index === 0
      || previousLine.trim() === ""
      || ANY_HEADING_RE.test(previousLine)
      || previousWasFenceClose;
    const setextUnderline = lines[index + 1]?.match(SETEXT_HEADING_RE);
    const isSetextBoundary = line.trim() !== ""
      && !LIST_ITEM_RE.test(line)
      && !ANY_HEADING_RE.test(line)
      && Boolean(setextUnderline);
    structure.push({
      question: beginsParagraph && QUESTION_RE.test(line),
      boundary: HEADING_BOUNDARY_RE.test(line) || isSetextBoundary,
      identityId: line.match(ID_RE)?.[1]?.toLowerCase() ?? null,
    });
    previousWasFenceClose = false;
  }

  return structure;
}

export function orphanRecallIdentities(
  markdown: string,
  questions = parseRecallQuestions(markdown),
): OrphanRecallIdentity[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const attachedLines = new Set(
    questions.flatMap((question) => question.identityLine === null ? [] : [question.identityLine]),
  );
  return structuralLines(lines).flatMap((entry, line) =>
    entry.identityId && !attachedLines.has(line)
      ? [{ id: entry.identityId, line }]
      : []);
}

export function parseRecallQuestions(markdown: string): RecallQuestion[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const structure = structuralLines(lines);
  const starts = structure
    .map((entry, index) => (entry.question ? index : -1))
    .filter((index) => index >= 0);

  return starts.map((questionLine) => {
    const questionMatch = lines[questionLine]?.match(QUESTION_RE);
    if (!questionMatch) {
      throw new Error(`Invalid question marker at line ${questionLine + 1}`);
    }

    let endLine = lines.length;
    for (let index = questionLine + 1; index < lines.length; index += 1) {
      const entry = structure[index];
      if (entry && (entry.question || entry.boundary)) {
        endLine = index;
        break;
      }
    }

    let identityLine: number | null = null;
    let id: string | null = null;
    let cursor = questionLine + 1;
    const identityMatch = lines[cursor]?.match(ID_RE);
    if (identityMatch?.[1]) {
      identityLine = cursor;
      id = identityMatch[1].toLowerCase();
      cursor += 1;
    }
    while (cursor < endLine && lines[cursor]?.trim() === "") cursor += 1;

    return {
      id,
      prompt: (questionMatch[1] ?? "").trim(),
      answer: lines.slice(cursor, endLine).join("\n").trimEnd(),
      questionLine,
      identityLine,
      answerStartLine: cursor,
      endLine,
    };
  });
}

export function duplicateQuestionIds(questions: RecallQuestion[]): Map<string, number[]> {
  const occurrences = new Map<string, number[]>();
  for (const question of questions) {
    if (!question.id) continue;
    const lines = occurrences.get(question.id) ?? [];
    lines.push(question.questionLine);
    occurrences.set(question.id, lines);
  }
  return new Map([...occurrences].filter(([, lines]) => lines.length > 1));
}

export function identityComment(id: string): string {
  return `<!-- recall:id=${id} -->`;
}

export function questionTemplate(id: string): string {
  return `${QUESTION_PREFIX} \n${identityComment(id)}\n\n`;
}
