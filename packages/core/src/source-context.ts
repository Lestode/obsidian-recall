import type { RecallQuestion } from "./grammar";

export interface QuestionSourceContext {
  sectionPath: string[];
  questionOrdinal: number;
}

const HEADING_RE = /^ {0,3}(#{1,2})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const SETEXT_HEADING_RE = /^ {0,3}(=+|-+)[ \t]*$/;
const LIST_ITEM_RE = /^ {0,3}(?:[-+*]|\d+[.)])(?:[ \t]+|$)/;

export function sourceContexts(
  markdown: string,
  questions: RecallQuestion[],
): QuestionSourceContext[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const headings: string[] = [];
  const result: QuestionSourceContext[] = [];
  let nextQuestion = 0;
  let fence: { character: string; length: number } | null = null;
  const frontMatterEnd = lines[0]?.trim() === "---"
    ? lines.findIndex((line, index) => index > 0 && line.trim() === "---")
    : -1;

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    while (questions[nextQuestion]?.questionLine === lineNumber) {
      result.push({
        sectionPath: headings.filter((heading): heading is string => Boolean(heading)),
        questionOrdinal: nextQuestion,
      });
      nextQuestion += 1;
    }

    if (frontMatterEnd >= 0 && lineNumber <= frontMatterEnd) continue;

    const line = lines[lineNumber] ?? "";
    const fenceMatch = line.match(FENCE_RE)?.[1];
    if (fence) {
      if (fenceMatch?.[0] === fence.character && fenceMatch.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fenceMatch) {
      fence = { character: fenceMatch[0] ?? "", length: fenceMatch.length };
      continue;
    }

    const match = line.match(HEADING_RE);
    if (match?.[1] && match[2]) {
      const level = match[1].length;
      headings.splice(level - 1);
      headings[level - 1] = match[2].trim();
      continue;
    }
    const setext = lines[lineNumber + 1]?.match(SETEXT_HEADING_RE);
    if (line.trim() !== "" && !LIST_ITEM_RE.test(line) && setext?.[1]) {
      const level = setext[1][0] === "=" ? 1 : 2;
      headings.splice(level - 1);
      headings[level - 1] = line.trim();
    }
  }

  return result;
}

export function canonicalQuestionContent(prompt: string, answer: string): string {
  return `${prompt.trim()}\u0000${answer.replace(/\r\n?/g, "\n").trimEnd()}`;
}
