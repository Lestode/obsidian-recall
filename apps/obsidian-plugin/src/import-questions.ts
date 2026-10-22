import { ANSWER_PREFIX, identityComment } from "./grammar";

export interface QuestionImportResult {
  markdown: string;
  questionCount: number;
}

type ImportToken =
  | { kind: "heading"; text: string }
  | { kind: "question"; text: string; answer: string };

function stripWrappingQuote(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizeImportedText(text: string): string {
  return text
    .replace(/&#x20;|&nbsp;/gi, " ")
    .replace(/\\\[\s*/g, "$")
    .replace(/\s*\\\]/g, "$")
    .replace(/\\\(\s*/g, "$")
    .replace(/\s*\\\)/g, "$")
    .replace(/\\_/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

export function convertNumberedQuestions(
  selection: string,
  createId: () => string = () => crypto.randomUUID(),
): QuestionImportResult | null {
  const lines = stripWrappingQuote(selection).replace(/\r\n?/g, "\n").split("\n");
  const tokens: ImportToken[] = [];
  let currentQuestion: string[] | null = null;
  let currentAnswer: string[] | null = null;
  let sawQuestion = false;

  const finishQuestion = (): void => {
    if (!currentQuestion) return;
    const text = normalizeImportedText(currentQuestion.join(" "));
    const answer = normalizeImportedText((currentAnswer ?? []).join(" "));
    if (text) tokens.push({ kind: "question", text, answer });
    currentQuestion = null;
    currentAnswer = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (numbered?.[1]) {
      finishQuestion();
      currentQuestion = [numbered[1]];
      currentAnswer = null;
      sawQuestion = true;
      continue;
    }

    const markdownHeading = line.match(/^#{1,6}\s+(.+)$/);
    if (markdownHeading?.[1]) {
      finishQuestion();
      tokens.push({
        kind: "heading",
        text: normalizeImportedText(markdownHeading[1]),
      });
      continue;
    }

    if (currentQuestion) {
      const answerMarker = line.match(/^(?:A:|\*\*A:\*\*)\s*(.*)$/i);
      if (answerMarker) {
        currentAnswer = answerMarker[1] ? [answerMarker[1]] : [];
      } else if (currentAnswer !== null) {
        currentAnswer.push(line);
      } else {
        currentQuestion.push(line);
      }
      continue;
    }

    if (!sawQuestion) {
      tokens.push({ kind: "heading", text: normalizeImportedText(line) });
    }
  }

  finishQuestion();
  const questionCount = tokens.filter((token) => token.kind === "question").length;
  if (questionCount === 0) return null;

  const blocks = tokens.map((token) => {
    if (token.kind === "heading") return `## ${token.text}`;
    const answer = token.answer ? `\n\n${token.answer}` : "";
    return `**Q:** ${token.text}\n${identityComment(createId())}\n\n${ANSWER_PREFIX}${answer}`;
  });

  return {
    markdown: `${blocks.join("\n\n")}\n\n`,
    questionCount,
  };
}
