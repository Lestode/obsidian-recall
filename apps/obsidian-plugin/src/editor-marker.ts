import { EditorState, RangeSet, RangeValue, Transaction } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { parseRecallQuestions } from "@recall/core";

interface IdentityLocation {
  id: string;
  from: number;
  to: number;
  questionFrom: number | null;
  questionTo: number | null;
}

class IdentityRange extends RangeValue {}

class RecallBadge extends WidgetType {
  toDOM(): HTMLElement {
    const badge = document.createElement("span");
    badge.className = "recall-identity-badge";
    badge.setAttribute("aria-label", "Protected Recall identity");
    badge.setAttribute("title", "Recall identity is protected in Live Preview");
    badge.textContent = "🔒 Recall";
    return badge;
  }

  eq(): boolean {
    return true;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function identityLocations(state: EditorState): IdentityLocation[] {
  const locations: IdentityLocation[] = [];
  for (const question of parseRecallQuestions(state.doc.toString())) {
    if (!question.id || question.identityLine === null) continue;
    const line = state.doc.line(question.identityLine + 1);
    const questionLine = state.doc.line(question.questionLine + 1);
    locations.push({
      id: question.id,
      from: line.from,
      to: line.to,
      questionFrom: questionLine.from,
      questionTo: questionLine.to,
    });
  }

  return locations;
}

function buildDecorations(state: EditorState): DecorationSet {
  const decorations: { from: number; to?: number; value: Decoration }[] = [];
  for (const location of identityLocations(state)) {
    if (location.questionTo !== null) {
      decorations.push({
        from: location.questionTo,
        value: Decoration.widget({ widget: new RecallBadge(), side: 1 }),
      });
    }
    decorations.push({
      from: location.from,
      value: Decoration.line({ attributes: { class: "recall-identity-line" } }),
    });
  }

  return Decoration.set(
    decorations.map(({ from, to = from, value }) => value.range(from, to)),
    true,
  );
}

function buildAtomicRanges(state: EditorState): RangeSet<IdentityRange> {
  return RangeSet.of(
    identityLocations(state).map(({ from, to }) =>
      new IdentityRange().range(from, to),
    ),
    true,
  );
}

const recallIdentityViewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomicRanges: RangeSet<IdentityRange>;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view.state);
      this.atomicRanges = buildAtomicRanges(view.state);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.startState !== update.state) {
        this.decorations = buildDecorations(update.state);
        this.atomicRanges = buildAtomicRanges(update.state);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const recallIdentityTheme = EditorView.baseTheme({
  ".cm-line.recall-identity-line": {
    display: "none",
  },
  ".recall-identity-badge": {
    display: "inline-flex",
    alignItems: "center",
    marginInlineStart: "0.55em",
    padding: "0.05em 0.45em",
    border: "1px solid var(--background-modifier-border)",
    borderRadius: "999px",
    color: "var(--text-muted)",
    background: "var(--background-secondary)",
    fontSize: "var(--font-smallest)",
    fontWeight: "var(--font-medium)",
    lineHeight: "1.45",
    verticalAlign: "0.08em",
    userSelect: "none",
  },
});

export function protectsIdentity(transaction: Transaction): boolean {
  if (!transaction.docChanged) {
    return true;
  }

  const locations = identityLocations(transaction.startState);
  const removedLocations = new Set<IdentityLocation>();
  let permitted = true;

  transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (!permitted) return;

    for (const location of locations) {
      const removesWholeQuestion =
        location.questionFrom !== null &&
        fromA <= location.questionFrom &&
        toA >= location.to;
      if (removesWholeQuestion) {
        removedLocations.add(location);
        continue;
      }

      const protectedFrom = location.questionTo ?? location.from;
      const insertedText = transaction.newDoc.sliceString(fromB, toB);
      const changesQuestionLineStructure =
        location.questionFrom !== null &&
        location.questionTo !== null &&
        (insertedText.includes("\n") || insertedText.includes("\r")) &&
        fromA <= location.questionTo &&
        toA >= location.questionFrom;
      const joinsQuestionToPreviousLine =
        location.questionFrom !== null &&
        fromA < location.questionFrom &&
        toA >= location.questionFrom;
      if (changesQuestionLineStructure || joinsQuestionToPreviousLine) {
        permitted = false;
        return;
      }
      const appendsPromptText =
        fromA === toA &&
        fromA === protectedFrom &&
        !insertedText.includes("\n") &&
        !insertedText.includes("\r");
      if (appendsPromptText) continue;
      const insertsAtProtectedBoundary =
        fromA === toA && fromA >= protectedFrom && fromA <= location.to;
      const overlapsProtectedBoundary =
        fromA !== toA && fromA <= location.to && toA > protectedFrom;
      if (!insertsAtProtectedBoundary && !overlapsProtectedBoundary) continue;

      permitted = false;
      return;
    }
  });

  if (!permitted) return false;

  const requiredCounts = new Map<string, number>();
  for (const location of locations) {
    if (removedLocations.has(location)) continue;
    requiredCounts.set(location.id, (requiredCounts.get(location.id) ?? 0) + 1);
  }
  const resultingCounts = new Map<string, number>();
  for (const question of parseRecallQuestions(transaction.newDoc.toString())) {
    if (!question.id) continue;
    resultingCounts.set(question.id, (resultingCounts.get(question.id) ?? 0) + 1);
  }
  return [...requiredCounts].every(([id, count]) =>
    (resultingCounts.get(id) ?? 0) >= count);
}

export const recallIdentityTransactionFilter = EditorState.transactionFilter.of((transaction) =>
  protectsIdentity(transaction) ? transaction : [],
);

export const recallIdentityEditorExtension = [
  recallIdentityTheme,
  recallIdentityViewPlugin,
  EditorView.atomicRanges.of(
    (view) => view.plugin(recallIdentityViewPlugin)?.atomicRanges ?? RangeSet.empty,
  ),
  recallIdentityTransactionFilter,
];
