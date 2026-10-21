export function questionPrefixForBlankLine(previousLine: string): string {
  return previousLine.trim() === "" ? "" : "\n";
}

export function importPrefixForContext(
  textBeforeSelection: string,
  previousLine: string,
): string {
  if (textBeforeSelection.trim() !== "") return "\n\n";
  return previousLine.trim() === "" ? "" : "\n";
}
