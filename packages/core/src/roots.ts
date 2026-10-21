import { RECALL_MARKER_FILE } from "./grammar";

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

export function markerRoot(markerPath: string): string | null {
  const normalized = normalize(markerPath);
  if (normalized === RECALL_MARKER_FILE) return "";
  if (!normalized.endsWith(`/${RECALL_MARKER_FILE}`)) return null;
  return normalized.slice(0, -(`/${RECALL_MARKER_FILE}`.length));
}

export function nearestRecallRoot(filePath: string, markerPaths: Iterable<string>): string | null {
  const normalizedFile = normalize(filePath);
  const roots = [...markerPaths]
    .map(markerRoot)
    .filter((root): root is string => root !== null)
    .filter((root) => root === "" || normalizedFile.startsWith(`${root}/`))
    .sort((left, right) => right.length - left.length);
  return roots[0] ?? null;
}
